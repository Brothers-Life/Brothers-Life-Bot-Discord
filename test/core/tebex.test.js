import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createTebex, normalizePayment, statusKind, TEBEX_API } from '../../src/core/tebex.js';
import { createFivemData } from '../../src/core/fivemData.js';
import { ALICE, BOB, MAIN, withNetwork } from './../helpers.js';

const SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const ROLE_VIP = '800000000000000001';
const ROLE_GOLD = '800000000000000002';
const CHANNEL = '810000000000000001';

const payment = (id, { status = 'Complete', uuid = '123', name = 'Pedro', packages = [{ id: 10, name: 'VIP' }], amount = '9.99' } = {}) => ({
	id, amount, date: '2026-10-01T15:40:19+0000', status, currency: { iso_4217: 'EUR', symbol: '€' },
	player: { id: 1, name, uuid }, packages,
});

// Tebex Plugin API stand-in: payments served from `store.payments`, every call recorded
function fakeTebex(store) {
	return async (url, options) => {
		store.calls.push({ url, secret: options?.headers?.['X-Tebex-Secret'] });
		if (store.status) return new Response('{}', { status: store.status });
		const path = url.replace(TEBEX_API, '');
		if (path.startsWith('/payments')) return Response.json(store.payments);
		if (path === '/information') return Response.json({ account: { id: 1, name: 'Brothers Life', domain: 'https://brl.tebex.io', currency: { iso_4217: 'EUR' }, game_type: 'FiveM' }, server: { id: 2, name: 'BRL' } });
		if (path === '/packages') return Response.json([{ id: 10, name: 'VIP', price: '9.99', category: { id: 1, name: 'Grades' } }]);
		return new Response(null, { status: 404 });
	};
}

async function setup({ links = { 123: ALICE } } = {}) {
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	const store = { payments: [], calls: [], status: null };
	const logged = [];
	const logs = { registerCategory: () => undefined, log: (guildId, category, message, type) => logged.push({ guildId, category, message, type }) };
	const lookups = [];
	const fivemData = {
		async findByTebexPlayer({ uuid, name }) {
			lookups.push(uuid);
			return links[uuid] ? { userId: 7, username: name, discordId: links[uuid], method: 'fivem' } : null;
		},
	};
	executor.roles.set(MAIN, [{ id: ROLE_VIP, name: 'VIP', editable: true }, { id: ROLE_GOLD, name: 'Gold', editable: true }]);
	executor.channels.set(CHANNEL, { guildId: MAIN, name: 'boutique' });
	const tebex = createTebex({ db: core.db, network: core.network, audit: core.audit, executor, settings: core.settings, logs, variables: core.variables, fivemData, fetchImpl: fakeTebex(store), logger: { warn: () => undefined } });
	tebex.setSecret(ctx.owner, SECRET);
	return { ...ctx, tebex, store, logged, lookups };
}

const roleCalls = executor => executor.calls.filter(c => c[0] === 'addRole' || c[0] === 'removeRole');

test('Tebex payloads are read defensively', () => {
	const p = normalizePayment(payment(5));
	assert.equal(p.id, 5);
	assert.equal(p.currency, 'EUR');
	assert.equal(p.playerUuid, '123');
	assert.deepEqual(p.packages, [{ id: '10', name: 'VIP' }]);
	assert.equal(p.paidAt, Date.parse('2026-10-01T15:40:19+00:00'));
	assert.equal(normalizePayment({ id: 'x' }), null);
	assert.equal(normalizePayment({ id: 3 }).packages.length, 0);
	assert.equal(statusKind('Complete'), 'complete');
	assert.equal(statusKind('Refund'), 'revoked');
	assert.equal(statusKind('Chargeback'), 'revoked');
	assert.equal(statusKind('Pending Checkout'), 'pending');
});

test('the secret is stored but never handed back to the panel', async () => {
	const { tebex, owner, core, store } = await setup();
	const view = tebex.view(owner);
	assert.equal(view.hasSecret, true);
	assert.ok(!JSON.stringify(view).includes(SECRET));
	assert.equal(core.settings.get('tebex.secret'), SECRET);
	// The key goes to Tebex in the header, nowhere else
	const info = await tebex.test(owner);
	assert.equal(info.store, 'Brothers Life');
	assert.equal(store.calls[0].secret, SECRET);
	assert.throws(() => tebex.setSecret(owner, 'short'), ValidationError);
	assert.deepEqual(tebex.setSecret(owner, null), { hasSecret: false });
	assert.equal(tebex.view(owner).hasSecret, false);
});

test('only people with the Tebex permissions see or change the store', async () => {
	const { tebex } = await setup();
	const nobody = { id: BOB, can: () => false };
	assert.throws(() => tebex.view(nobody), ForbiddenError);
	assert.throws(() => tebex.payments(nobody), ForbiddenError);
	assert.throws(() => tebex.setSecret(nobody, SECRET), ForbiddenError);
	await assert.rejects(tebex.link(nobody, 1, { discordId: ALICE }), ForbiddenError);
});

test('first poll only marks existing payments, later polls handle each new one once', async () => {
	const { tebex, owner, store, executor, logged } = await setup();
	tebex.setConfig(owner, { mappings: [{ packageId: '10', guildId: MAIN, roleId: ROLE_VIP }] });
	store.payments = [payment(2), payment(1)];
	const first = await tebex.poll();
	assert.equal(first.firstRun, true);
	assert.equal(roleCalls(executor).length, 0);
	assert.equal(logged.length, 0);
	assert.ok(tebex.payments(owner, { filter: 'baseline' }).every(p => p.baseline));

	store.payments = [payment(3), payment(2), payment(1)];
	const second = await tebex.poll();
	assert.equal(second.fresh, 1);
	assert.deepEqual(roleCalls(executor), [['addRole', MAIN, ALICE, ROLE_VIP]]);
	assert.equal(logged.length, 1);
	assert.equal(logged[0].category, 'tebex');
	assert.equal(logged[0].type, 'purchase');

	// Same list again: nothing twice
	await tebex.poll();
	assert.equal(roleCalls(executor).length, 1);
	assert.equal(logged.length, 1);
	assert.equal(tebex.view(owner).state.lastId, 3);
});

test('the price stays out of the Discord log unless asked', async () => {
	const { tebex, owner, store, logged } = await setup();
	store.payments = [];
	await tebex.poll();
	store.payments = [payment(1)];
	await tebex.poll();
	assert.ok(!logged[0].message.fields.some(f => f.name === 'Montant'));
	tebex.setConfig(owner, { showPrice: true });
	store.payments = [payment(2), payment(1)];
	await tebex.poll();
	assert.equal(logged[1].message.fields.find(f => f.name === 'Montant').value, '9.99 EUR');
	// The panel always shows it
	assert.equal(tebex.payments(owner)[0].amount, '9.99');
});

test('an unknown buyer stays unlinked until linked by hand, then the link is remembered', async () => {
	const { tebex, owner, store, executor, logged, lookups } = await setup();
	tebex.setConfig(owner, { mappings: [{ packageId: '10', guildId: MAIN, roleId: ROLE_VIP }] });
	await tebex.poll();
	store.payments = [payment(1, { uuid: '999', name: 'Inconnu' })];
	await tebex.poll();
	assert.deepEqual(lookups, ['999']);
	assert.equal(roleCalls(executor).length, 0);
	assert.equal(logged[0].message.fields.find(f => f.name === 'Discord').value, 'non lié');
	assert.equal(tebex.payments(owner, { filter: 'unlinked' }).length, 1);
	// The FiveM database is not asked again on every poll
	await tebex.poll();
	assert.equal(lookups.length, 1);

	const linked = await tebex.link(owner, 1, { discordId: BOB });
	assert.equal(linked.discordId, BOB);
	assert.equal(linked.linkMethod, 'manual');
	assert.deepEqual(roleCalls(executor), [['addRole', MAIN, BOB, ROLE_VIP]]);
	assert.equal(tebex.payments(owner, { filter: 'unlinked' }).length, 0);

	// Next purchase of the same buyer: linked alone
	store.payments = [payment(2, { uuid: '999', name: 'Inconnu' }), payment(1, { uuid: '999', name: 'Inconnu' })];
	await tebex.poll();
	const second = tebex.payments(owner).find(p => p.id === 2);
	assert.equal(second.discordId, BOB);
	assert.equal(second.linkMethod, 'known');
});

test('roles of the articles: several mappings, limited durations in the temporary roles', async () => {
	const { tebex, owner, store, executor, db } = await setup();
	tebex.setConfig(owner, { mappings: [
		{ packageId: '10', guildId: MAIN, roleId: ROLE_VIP },
		{ packageId: '11', guildId: MAIN, roleId: ROLE_GOLD, days: 30 },
	] });
	assert.throws(() => tebex.setConfig(owner, { mappings: [{ packageId: '10', guildId: MAIN, roleId: ROLE_VIP, days: 999 }] }), ValidationError);
	await tebex.poll();
	store.payments = [payment(1, { packages: [{ id: 11, name: 'Gold 30 j' }] })];
	await tebex.poll();
	assert.deepEqual(roleCalls(executor), [['addRole', MAIN, ALICE, ROLE_GOLD]]);
	const temp = db.prepare('SELECT * FROM temp_roles WHERE user_id = ? AND removed_at IS NULL').get(ALICE);
	assert.equal(temp.role_id, ROLE_GOLD);
	assert.ok(temp.expires_at > Date.now() + 29 * 86_400_000);
	// A second month adds up
	store.payments = [payment(2, { packages: [{ id: 11, name: 'Gold 30 j' }] }), payment(1, { packages: [{ id: 11, name: 'Gold 30 j' }] })];
	await tebex.poll();
	const extended = db.prepare('SELECT * FROM temp_roles WHERE id = ?').get(temp.id);
	assert.ok(extended.expires_at > Date.now() + 59 * 86_400_000);
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM temp_roles WHERE removed_at IS NULL').get().n, 1);
});

test('a refund or chargeback takes the roles back, unless another purchase still gives them', async () => {
	const { tebex, owner, store, executor, logged } = await setup();
	tebex.setConfig(owner, { mappings: [{ packageId: '10', guildId: MAIN, roleId: ROLE_VIP }] });
	await tebex.poll();
	store.payments = [payment(2), payment(1)];
	await tebex.poll();
	assert.equal(roleCalls(executor).filter(c => c[0] === 'addRole').length, 2);

	// One of two VIP purchases refunded: the role stays
	store.payments = [payment(2, { status: 'Refund' }), payment(1)];
	await tebex.poll();
	assert.equal(roleCalls(executor).filter(c => c[0] === 'removeRole').length, 0);
	assert.equal(logged.at(-1).type, 'refund');

	// The other one charged back: now it goes
	store.payments = [payment(2, { status: 'Refund' }), payment(1, { status: 'Chargeback' })];
	await tebex.poll();
	assert.deepEqual(roleCalls(executor).filter(c => c[0] === 'removeRole'), [['removeRole', MAIN, ALICE, ROLE_VIP]]);
	assert.equal(logged.at(-1).message.title, 'Paiement contesté (chargeback)');
	assert.equal(tebex.view(owner).stats.revoked, 2);
	// Nothing more on the next poll
	await tebex.poll();
	assert.equal(roleCalls(executor).filter(c => c[0] === 'removeRole').length, 1);
	await assert.rejects(tebex.reapply(owner, 1), ValidationError);
});

test('the thank-you message fills member and purchase variables', async () => {
	const { tebex, owner, store, executor } = await setup();
	tebex.setConfig(owner, { thanks: { enabled: true, guildId: MAIN, channelId: CHANNEL, template: 'Merci {user} ({achat.joueur}) pour {achat.articles} - {achat.montant}' } });
	await tebex.poll();
	store.payments = [payment(1)];
	await tebex.poll();
	assert.equal(executor.messages.length, 1);
	assert.equal(executor.messages[0].channelId, CHANNEL);
	assert.equal(executor.messages[0].payload.content, `Merci <@${ALICE}> (Pedro) pour VIP - 9.99 EUR`);
	assert.deepEqual(executor.messages[0].mentionUserIds, [ALICE]);
	// FiveM account data in a public message needs the right to see it
	const manager = { id: BOB, can: p => p === 'tebex.manage' };
	assert.throws(() => tebex.setConfig(manager, { thanks: { enabled: true, guildId: MAIN, channelId: CHANNEL, template: 'Merci {fivem.license}' } }), ForbiddenError);
});

test('a refused key is reported and kept as the last error', async () => {
	const { tebex, owner, store } = await setup();
	store.status = 403;
	await assert.rejects(tebex.poll(), /Clé secrète refusée/);
	assert.match(tebex.view(owner).state.lastError, /Clé secrète refusée/);
	store.status = null;
	await tebex.poll();
	assert.equal(tebex.view(owner).state.lastError, null);
});

test('packages come from Tebex and from the payments already seen', async () => {
	const { tebex, owner, store } = await setup();
	await tebex.poll();
	store.payments = [payment(1, { packages: [{ id: 42, name: 'Voiture unique' }] })];
	await tebex.poll();
	const { packages } = await tebex.packages(owner);
	assert.deepEqual(packages.map(p => p.id).sort(), ['10', '42']);
});

test('FiveM buyers are found by their CFX account id, then by an exact unique name (read only)', async () => {
	const queries = [];
	const pool = {
		async query({ sql }, params) {
			queries.push(sql);
			if (!/^\s*SELECT/i.test(sql)) throw new Error('écriture interdite');
			if (/WHERE fivem = \?/.test(sql)) return [params[0] === 'fivem:123' ? [{ userid: 7, username: 'Pedro', discord: `discord:${ALICE}` }] : []];
			if (/WHERE username = \?/.test(sql)) return [params[0] === 'Solo' ? [{ userid: 8, username: 'Solo', discord: `discord:${BOB}` }] : params[0] === 'Twin' ? [{ userid: 9 }, { userid: 10 }] : []];
			return [[]];
		},
		async end() { this.ended = true; },
	};
	const store = new Map([['fivemdb.config', { enabled: true, host: 'db', port: 3306, database: 'qbox', user: 'bot', password: 'x' }]]);
	const data = createFivemData({ audit: { record: () => undefined }, settings: { get: (k, d) => store.get(k) ?? d, set: (k, v) => store.set(k, v) }, logger: { warn: () => undefined }, createPool: () => pool });
	assert.deepEqual(await data.findByTebexPlayer({ uuid: '123', name: 'X' }), { userId: 7, username: 'Pedro', discordId: ALICE, method: 'fivem' });
	assert.equal((await data.findByTebexPlayer({ uuid: '555', name: 'Solo' })).method, 'name');
	assert.equal(await data.findByTebexPlayer({ uuid: '555', name: 'Twin' }), null);
	assert.ok(queries.every(sql => /^\s*SELECT/i.test(sql)));
	assert.ok(!queries.some(sql => /bl_mc_sessions|sky_phone/.test(sql)));
});
