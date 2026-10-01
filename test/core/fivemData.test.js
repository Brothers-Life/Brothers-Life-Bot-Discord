import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/core/errors.js';
import { createFivemData, normalizeDbConfig } from '../../src/core/fivemData.js';
import { detailPayload, playerPayload } from '../../src/bot/fivemDataUi.js';

const DISCORD = '300000000000000081';
const TABLES = ['users', 'players', 'bl_mc_sessions', 'player_vehicles', 'management_groups', 'admindash_sanctions', 'bank_flows', 'admindash_audit_log'];

// A fake MariaDB pool: answers by the shape of the SQL, records every query
function fakePool(log) {
	const answers = [
		[/information_schema/, () => TABLES.map(t => ({ t }))],
		[/^SELECT userid FROM users WHERE discord/, ([d]) => (d === `discord:${DISCORD}` ? [{ userid: 7 }] : [])],
		[/SELECT DISTINCT u.userid/, () => [{ userid: 7 }]],
		[/FROM users WHERE userid IN/, () => [{ userid: 7, username: 'Pedro', discord: `discord:${DISCORD}`, license: 'license:abc', license2: null }]],
		[/FROM users WHERE userid = \?/, ([id]) => (id === 7 ? [{ userid: 7, username: 'Pedro', discord: `discord:${DISCORD}`, license: 'license:abc', license2: null, fivem: 'fivem:12' }] : [])],
		[/FROM players WHERE userId IN/, () => [{ userId: 7, citizenid: 'ABC123', charinfo: '{"firstname":"John","lastname":"Doe"}', job: '{"name":"police","grade":{"level":2},"onduty":true}', gang: '{"name":"none"}', last_updated: '2026-10-01T10:00:00Z' }]],
		[/SELECT \* FROM players/, () => [{
			userId: 7, cid: 1, citizenid: 'ABC123', charinfo: '{"firstname":"John","lastname":"Doe","gender":0,"phone":"555"}', job: '{"name":"police","grade":{"level":2},"onduty":true}', gang: '{"name":"none"}',
			money: '{"cash":120,"bank":5000}', metadata: '{"health":200,"hunger":80}', inventory: '[{"name":"phone","count":1,"slot":1},null]', last_updated: '2026-10-01T10:00:00Z',
		}]],
		[/FROM management_groups/, () => [{ name: 'police', type: 'job', label: 'LSPD', grades: '{"2":{"name":"Sergent"}}' }]],
		[/SUM\(left_at IS NULL[\s\S]*GROUP BY user_id/, () => [{ user_id: 7, count: 3, lastJoin: '2026-10-01T09:00:00Z', seconds: 7200, online: 1 }]],
		[/COUNT\(\*\) AS count, MIN\(joined_at\)/, () => [{ count: 3, first: '2026-09-01T09:00:00Z', seconds: 7200, week: 3600, online: 1 }]],
		[/FROM bl_mc_sessions WHERE user_id = \? ORDER BY/, () => [{ id: 1, joined_at: '2026-10-01T09:00:00Z', left_at: null, drop_reason: null, name: 'Pedro' }]],
		[/FROM player_vehicles/, (_, sql) => [{ citizenid: 'ABC123', vehicle: 'sultan', plate: 'BRL 001', state: 1, engine: 900, body: 1000, fuel: 70, ...(sql.includes('trunk') ? { trunk: '[{"name":"weapon","count":1}]', glovebox: '[]' } : {}) }]],
		[/FROM admindash_sanctions/, () => [{ id: 1, type: 'warn', reason: 'HRP', issued_by_name: 'Modo', created_at: '2026-09-20T10:00:00Z' }]],
		[/FROM bank_flows/, () => [{ created_at: '2026-09-30T10:00:00Z', kind: 'transfer', from_cid: 'ABC123', to_cid: 'XYZ', amount: '250', note: null }]],
		[/FROM admindash_audit_log/, () => [{ id: 9, issued_by_name: 'Modo', action: 'teleport', target_name: 'Pedro', details: null, created_at: '2026-10-01T08:00:00Z' }]],
	];
	return {
		ended: false,
		async query({ sql }, params) {
			log.push(sql);
			if (!/^\s*SELECT/i.test(sql)) throw new Error('écriture interdite');
			const hit = answers.find(([re]) => re.test(sql.trim()));
			return [hit ? hit[1](params, sql) : []];
		},
		async end() { this.ended = true; },
	};
}

function setup(perms = ['fivemdata.view']) {
	const store = new Map([['fivemdb.config', { enabled: true, host: 'db', port: 3306, database: 's10_qbox', user: 'bot', password: 'secret' }]]);
	const settings = { get: (k, d) => store.get(k) ?? d, set: (k, v) => store.set(k, v) };
	const audits = [];
	const log = [];
	const pools = [];
	const createPool = (opts) => {
		const pool = { ...fakePool(log), opts };
		pools.push(pool);
		return pool;
	};
	const data = createFivemData({ audit: { record: e => audits.push(e) }, settings, logger: { warn: () => undefined }, createPool });
	const actor = list => ({ id: '100000000000000001', can: p => list.includes(p) });
	return { data, settings, store, audits, log, pools, staff: actor(perms), actor };
}

test('fivem data: config validation keeps the saved password and never shows it', async () => {
	assert.throws(() => normalizeDbConfig({ enabled: true, host: '', database: 'x', user: 'u' }), ValidationError);
	assert.throws(() => normalizeDbConfig({ host: 'h', database: 'x; DROP', user: 'u' }), /Nom de base/);
	assert.throws(() => normalizeDbConfig({ host: 'h', database: 'x', user: 'u', port: 70000 }), /Port/);
	assert.equal(normalizeDbConfig({ host: 'h', database: 'x', user: 'u', password: '' }, { password: 'old' }).password, 'old');

	const { data, actor } = setup();
	const view = data.settingsView();
	assert.equal(view.password, undefined);
	assert.equal(view.hasPassword, true);
	await assert.rejects(data.setConfig(actor(['fivemdata.view']), { enabled: false }), ForbiddenError);
});

test('fivem data: search, summaries and Discord link', async () => {
	const { data, staff, actor, log } = setup();
	const list = await data.search(staff, 'John');
	assert.equal(list.length, 1);
	assert.equal(list[0].username, 'Pedro');
	assert.equal(list[0].discordId, DISCORD);
	assert.equal(list[0].online, true);
	assert.equal(list[0].playSeconds, 7200);
	assert.equal(list[0].characters[0].job.label, 'LSPD');
	assert.equal(list[0].characters[0].job.gradeLabel, 'Sergent');
	assert.equal(list[0].characters[0].gang, null);
	assert.equal(await data.findByDiscord(DISCORD), 7);
	assert.equal(await data.findByDiscord('nope'), null);
	await assert.rejects(data.search(actor([]), 'x'), ForbiddenError);
	assert.ok(log.every(sql => /^\s*SELECT/i.test(sql)));
});

test('fivem data: the sheet hides money and inventory without their permissions and is audited', async () => {
	const { data, staff, actor, audits } = setup();
	const basic = await data.player(staff, 7);
	assert.equal(basic.characters[0].name, 'John Doe');
	assert.equal(basic.characters[0].money, undefined);
	assert.equal(basic.characters[0].inventory, undefined);
	assert.equal(basic.economy, null);
	assert.equal(basic.vehicles[0].trunk, undefined);
	assert.equal(basic.vehicles[0].engine, 90);
	assert.equal(basic.sanctions[0].type, 'warn');
	assert.equal(basic.account.fivemId, '12');
	assert.deepEqual(basic.permissions, { economy: false, inventory: false, logs: false });
	assert.equal(audits.at(-1).action, 'fivemdata.view');
	assert.equal(audits.at(-1).target, '7');

	const full = await data.player(actor(['fivemdata.view', 'fivemdata.economy', 'fivemdata.inventory']), 7);
	assert.equal(full.economy.total, 5120);
	assert.equal(full.economy.flows[0].from, 'John Doe');
	assert.deepEqual(full.characters[0].inventory, [{ name: 'phone', count: 1, slot: 1 }]);
	assert.equal(full.vehicles[0].trunk[0].name, 'weapon');

	await assert.rejects(data.player(staff, 99), NotFoundError);

	// The Discord embeds hold up with this sheet
	const main = playerPayload(full);
	assert.equal(main.components[0].components.length, 5);
	for (const part of ['veh', 'sanc', 'sess', 'inv', 'eco']) assert.ok(detailPayload(full, part).embeds[0].toJSON().title);
});

test('fivem data: admin logs need their permission; disabled base and new config reset the pool', async () => {
	const { data, staff, actor, store, pools } = setup();
	await assert.rejects(data.adminLogs(staff), ForbiddenError);
	const logs = await data.adminLogs(actor(['fivemdata.logs']), { search: 'tele' });
	assert.equal(logs[0].action, 'teleport');

	const manager = actor(['fivemdata.manage']);
	await data.setConfig(manager, { enabled: true, host: 'db2', port: 3306, database: 's10_qbox', user: 'bot', password: '' });
	assert.equal(store.get('fivemdb.config').password, 'secret');
	assert.equal(pools[0].ended, true);
	await data.search(staff, '');
	assert.equal(pools.at(-1).opts.host, 'db2');

	await data.setConfig(manager, { enabled: false });
	await assert.rejects(data.search(staff, ''), /pas configurée/);
	await data.close();
});
