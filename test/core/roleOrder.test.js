import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { roleArrangement } from '../../src/core/staffSync.js';

const role = (id, extra = {}) => ({ id, name: id, editable: true, ...extra });
const names = list => list.map(r => r.name);

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	await core.network.activate(owner, OTHER);
	executor.roles.set(MAIN, [role('800000000000000001', { name: 'Admin' }), role('800000000000000002', { name: 'Modo' }), role('800000000000000003', { name: 'Helper' }), role('800000000000000004', { name: 'Joueur' })]);
	const ranks = {};
	for (const [name, level, id] of [['Admin', 80, '800000000000000001'], ['Modo', 50, '800000000000000002'], ['Helper', 30, '800000000000000003']]) {
		ranks[name] = await core.ranks.create(owner, { name, level, permissions: [] });
		await core.ranks.setRoleLinks(owner, ranks[name].id, [id]);
	}
	return { ...ctx, ranks };
}

test('arrangement: network roles on top in the given order, others keep their order, other bots and roles above the bot do not move', () => {
	const all = [
		{ id: 'a', position: 1, belowBot: true },
		{ id: 'helper', position: 2, belowBot: true },
		{ id: 'other-bot', position: 3, belowBot: true, managed: true },
		{ id: 'admin', position: 4, belowBot: true },
		{ id: 'b', position: 5, belowBot: true },
		{ id: 'bot', position: 6, managed: true },
		{ id: 'owner', position: 7, aboveBot: true },
	];
	assert.deepEqual(roleArrangement(all, ['admin', 'helper', 'unknown', 'owner']), [
		{ role: 'a', position: 1 },
		{ role: 'b', position: 2 },
		{ role: 'helper', position: 4 },
		{ role: 'admin', position: 5 },
	]);
	assert.deepEqual(roleArrangement(all, ['b', 'admin']), [], 'already in place');
});

test('sync: linked and same-name roles follow the order of the main server, above the roles of the server', async () => {
	const { core, owner, executor, ranks } = await setup();
	executor.roles.set(OTHER, [
		role('810000000000000001', { name: 'Local haut' }),
		role('810000000000000002', { name: 'Helper' }),
		role('810000000000000003', { name: 'Local milieu' }),
		role('810000000000000004', { name: 'Admin' }),
		role('810000000000000009', { name: 'MEE6', managed: true, editable: false, belowBot: true }),
		role('810000000000000005', { name: 'Modérateur' }),
		role('810000000000000006', { name: 'Local bas' }),
		role('810000000000000007', { name: 'Joueur' }),
	]);
	// Helper and Admin by name, Modo by a link under another name; Joueur is on no rank
	await core.staffSync.setLinks(owner, ranks.Modo.id, OTHER, ['810000000000000005']);

	const { order } = await core.staffSync.syncAll();
	assert.deepEqual(order, [{ guildId: OTHER, name: order[0].name, moved: true, stuck: [] }]);
	// MEE6, another bot's role, stays at its own place in the list
	assert.deepEqual(names(executor.roles.get(OTHER)), ['Admin', 'Modérateur', 'Helper', 'Local haut', 'MEE6', 'Local milieu', 'Local bas', 'Joueur']);
	assert.equal((await core.audit.query({ action: 'staff_sync.order' })).length, 1);

	// Nothing to do the second time, so no Discord call: a role event cannot loop
	executor.roleMoves.length = 0;
	assert.equal((await core.staffSync.syncAll()).order[0].moved, false);
	assert.equal(executor.roleMoves.length, 0);

	// The main server changes its order: the others follow
	const [admin, modo, helper, joueur] = executor.roles.get(MAIN);
	executor.roles.set(MAIN, [admin, helper, modo, joueur]);
	await core.staffSync.syncAll();
	assert.deepEqual(names(executor.roles.get(OTHER)).slice(0, 3), ['Admin', 'Helper', 'Modérateur']);
});

test('the main server is never reordered', async () => {
	const { core, executor } = await setup();
	await core.staffSync.syncAll();
	assert.equal(executor.roleMoves.filter(m => m.guildId === MAIN).length, 0);
});

test('a role above the bot is reported, the rest still goes as high as the bot can', async () => {
	const { core, executor } = await setup();
	executor.roles.set(OTHER, [
		role('810000000000000001', { name: 'Fondateur', editable: false }),
		role('810000000000000002', { name: 'Local' }),
		role('810000000000000003', { name: 'Helper' }),
		role('810000000000000004', { name: 'Admin' }),
	]);
	const { order } = await core.staffSync.syncAll();
	assert.deepEqual(order[0].stuck, ['Fondateur']);
	assert.deepEqual(names(executor.roles.get(OTHER)), ['Fondateur', 'Admin', 'Helper', 'Local']);
});

test('a refused move is reported and does not stop the member sync', async () => {
	const { core, executor } = await setup();
	executor.roles.set(OTHER, [role('810000000000000002', { name: 'Local' }), role('810000000000000003', { name: 'Admin' })]);
	executor.failOn.add(`move:${OTHER}`);
	executor.memberRoles.set(`${MAIN}:${ALICE}`, ['800000000000000001']);
	executor.memberRoles.set(`${OTHER}:${ALICE}`, []);
	const { order, changed } = await core.staffSync.syncAll();
	assert.equal(order[0].error, 'Missing Permissions');
	assert.equal(order[0].moved, false);
	assert.equal(changed, 1);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${ALICE}`), ['810000000000000003']);
});

test('copied roles join the block in the order of the main server, and stay there at the next sync', async () => {
	const { core, owner, executor } = await setup();
	const local = role('810000000000000001', { name: 'Local' });
	executor.roles.set(OTHER, [local]);
	// A created role lands at the bottom of the server
	let next = 2;
	executor.createRole = async (guildId, data) => {
		const id = `81000000000000000${next++}`;
		executor.roles.set(guildId, [...executor.roles.get(guildId), role(id, { name: data.name })]);
		return id;
	};

	const { results, order } = await core.staffSync.copyRoles(owner, { from: MAIN, to: OTHER, roleIds: ['800000000000000004', '800000000000000002'] });
	assert.deepEqual(results.map(r => r.status), ['created', 'created']);
	assert.equal(order.moved, true);
	assert.deepEqual(names(executor.roles.get(OTHER)), ['Modo', 'Joueur', 'Local']);

	// Joueur has no rank: only the copy keeps it with the network roles
	await core.staffSync.syncAll();
	assert.deepEqual(names(executor.roles.get(OTHER)), ['Modo', 'Joueur', 'Local']);

	const back = await core.staffSync.copyRoles(owner, { from: OTHER, to: MAIN, roleIds: [executor.roles.get(OTHER)[2].id] });
	assert.equal(back.order, null, 'nothing is moved on the main server');
});
