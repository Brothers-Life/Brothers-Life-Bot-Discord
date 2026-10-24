import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, BOB, MAIN, OTHER } from '../helpers.js';
import { ValidationError } from '../../src/core/errors.js';

const role = (id, name, extra = {}) => ({ id, name, color: '#e67e22', position: 1, editable: true, dangerous: false, permissions: '0', hoist: false, mentionable: false, ...extra });

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	await core.network.activate(owner, OTHER);
	executor.roles.set(MAIN, [
		role('800000000000000003', 'Admin', { position: 5, dangerous: true, permissions: '8' }),
		role('800000000000000002', 'Modérateur', { position: 4, hoist: true, permissions: '2048' }),
		role('800000000000000001', 'Joueur', { position: 2, color: '#000000', mentionable: true }),
	]);
	// "joueur" already exists on the other server (name compared without case)
	const existing = role('810000000000000001', 'joueur', { color: '#ffffff', permissions: '1024' });
	executor.roles.set(OTHER, [existing]);
	executor.guildModels.set(OTHER, { id: OTHER, name: 'Other', roles: [{ ...existing }], channels: [], settings: {}, botRolePosition: 10 });
	return ctx;
}

test('chosen roles are created on the other server in the same order, a role of the same name is updated, rank links follow', async () => {
	const { core, owner, executor } = await setup();
	const mod = await core.ranks.create(owner, { name: 'Modo', level: 30, permissions: ['panel.access'] });
	await core.ranks.setRoleLinks(owner, mod.id, ['800000000000000002']);

	const preview = await core.staffSync.copyRolesPreview(MAIN, OTHER);
	assert.deepEqual(preview.servers.map(s => s.id).sort(), [MAIN, OTHER]);
	assert.deepEqual(preview.roles.map(r => [r.name, r.target?.id ?? null, r.ranks]), [['Admin', null, []], ['Modérateur', null, ['Modo']], ['Joueur', '810000000000000001', []]]);

	const results = await core.staffSync.copyRoles(owner, { from: MAIN, to: OTHER, roleIds: ['800000000000000001', '800000000000000002', '800000000000000003'] });
	assert.deepEqual(results.map(r => [r.name, r.status]), [['Admin', 'created'], ['Modérateur', 'created'], ['Joueur', 'updated']]);
	const model = executor.model(OTHER).roles;
	// Highest created first: each new role lands at the bottom, Admin ends up above Modérateur
	assert.deepEqual(model.filter(r => r.reason === 'Copie de rôles' && r.name !== 'joueur').map(r => r.name), ['Admin', 'Modérateur']);
	const modCopy = model.find(r => r.name === 'Modérateur');
	assert.deepEqual([modCopy.hoist, modCopy.permissions, modCopy.color], [true, '2048', '#e67e22']);
	// The existing role keeps its name, takes the rest
	const joueur = model.find(r => r.id === '810000000000000001');
	assert.deepEqual([joueur.name, joueur.permissions, joueur.color, joueur.mentionable], ['joueur', '0', 0, true]);
	assert.deepEqual((await core.staffSync.linksOf(OTHER)).get(mod.id), [results[1].targetId]);
	assert.equal(results[1].ranks[0], 'Modo');
});

test('below the chief: roles with admin permissions and links of higher ranks are not copied', async () => {
	const { core, owner } = await setup();
	const manager = await core.ranks.create(owner, { name: 'Gestion', level: 50, permissions: ['panel.access', 'ranks.manage'] });
	const high = await core.ranks.create(owner, { name: 'Direction', level: 80, permissions: ['panel.access'] });
	await core.ranks.setRoleLinks(owner, high.id, ['800000000000000002']);
	await core.ranks.assignDirect(owner, BOB, manager.id);
	const bob = await core.ranks.resolve(BOB);

	const results = await core.staffSync.copyRoles(bob, { from: MAIN, to: OTHER, roleIds: ['800000000000000003', '800000000000000002'] });
	assert.equal(results[0].status, 'error');
	assert.match(results[0].error, /chef du réseau/);
	assert.deepEqual([results[1].status, results[1].ranks], ['created', []]);
	assert.equal((await core.staffSync.linksOf(OTHER)).get(high.id), undefined);
});

test('same server or a server outside the network is refused', async () => {
	const { core, owner } = await setup();
	await assert.rejects(core.staffSync.copyRoles(owner, { from: MAIN, to: MAIN, roleIds: ['800000000000000001'] }), ValidationError);
	await assert.rejects(core.staffSync.copyRoles(owner, { from: MAIN, to: '900000000000000099', roleIds: ['800000000000000001'] }), ValidationError);
	await assert.rejects(core.staffSync.copyRoles(owner, { from: MAIN, to: OTHER, roleIds: ['800000000000000099'] }), ValidationError);
});
