import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../db.js';
import { createFivemMirror } from '../../src/core/fivem/mirror.js';
import { createFivemData } from '../../src/core/fivemData.js';
import { ForbiddenError, NotFoundError } from '../../src/core/errors.js';
import { detailPayload, playerPayload } from '../../src/bot/fivemDataUi.js';
import { peaks } from '../../src/core/fivem/serverReport.js';

const ALICE = '100000000000000002';
const T = Date.parse('2026-10-20T20:00:00Z');
const HOUR = 3_600_000;
const recent = Date.now() - 2 * HOUR;

// MariaDB tables as the resource describes them: [name, DATA_TYPE] per column, rows as objects
const TABLES = {
	users: { pk: ['userid'], cols: [['userid', 'int'], ['username', 'varchar'], ['license', 'varchar'], ['license2', 'varchar'], ['fivem', 'varchar'], ['discord', 'varchar']], rows: [
		{ userid: 1, username: 'Pedro', license: 'license:aaa', license2: null, fivem: 'fivem:123', discord: `discord:${ALICE}` },
		{ userid: 2, username: 'Solo', license: 'license:bbb', license2: 'license2:bbb', fivem: null, discord: null },
		{ userid: 3, username: 'Twin', license: 'license:ccc', license2: null, fivem: null, discord: null },
		{ userid: 4, username: 'Twin', license: 'license:ddd', license2: null, fivem: null, discord: null },
	] },
	players: { pk: ['citizenid'], cols: [['citizenid', 'varchar'], ['cid', 'int'], ['userId', 'int'], ['name', 'varchar'], ['phone_number', 'varchar'], ['charinfo', 'longtext'], ['money', 'longtext'], ['job', 'longtext'], ['gang', 'longtext'], ['metadata', 'longtext'], ['inventory', 'longtext'], ['last_updated', 'timestamp'], ['last_logged_out', 'timestamp']], rows: [
		{ citizenid: 'ABC123', cid: 1, userId: 1, name: 'Tony', phone_number: '5551234', charinfo: '{"firstname":"Tony","lastname":"Moretti","gender":0}', money: '{"cash":100,"bank":900}', job: '{"name":"police","grade":{"level":2},"onduty":true}', gang: '{"name":"none"}', metadata: '{"isdead":false}', inventory: '[{"name":"phone","count":1,"slot":1}]', last_updated: recent, last_logged_out: null },
		{ citizenid: 'DEF456', cid: 2, userId: 1, name: 'Lia', phone_number: null, charinfo: '{"firstname":"Lia"', money: '{"cash":5}', job: '{"name":"unemployed"}', gang: '{"name":"ballas","grade":1}', metadata: '{}', inventory: '[]', last_updated: T, last_logged_out: T },
		{ citizenid: 'GHI789', cid: 1, userId: 2, name: 'Solo', phone_number: null, charinfo: '{"firstname":"Han","lastname":"Solo"}', money: '{}', job: '{"name":"ems","grade":0}', gang: '{}', metadata: '{}', inventory: '[]', last_updated: T - HOUR, last_logged_out: null },
	] },
	management_groups: { pk: ['name'], cols: [['name', 'varchar'], ['type', 'varchar'], ['label', 'varchar'], ['grades', 'longtext']], rows: [
		{ name: 'police', type: 'job', label: 'LSPD', grades: '{"2":{"name":"Sergent"}}' },
		{ name: 'ballas', type: 'gang', label: 'Ballas', grades: '{"1":{"name":"Membre"}}' },
	] },
	bl_mc_sessions: { pk: ['id'], cols: [['id', 'int'], ['user_id', 'int'], ['name', 'varchar'], ['joined_at', 'datetime'], ['left_at', 'datetime'], ['drop_reason', 'varchar'], ['ip', 'varchar']], rows: [
		{ id: 1, user_id: 1, name: 'Pedro', joined_at: recent - 3 * HOUR, left_at: recent - HOUR, drop_reason: 'quit', ip: '1.2.3.4' },
		{ id: 2, user_id: 1, name: 'Pedro', joined_at: Date.now() - 30 * 60_000, left_at: null, drop_reason: null, ip: '1.2.3.4' },
		{ id: 3, user_id: 2, name: 'Solo', joined_at: recent - 5 * HOUR, left_at: recent - 4 * HOUR, drop_reason: 'crash', ip: null },
	] },
	bl_mc_session_chars: { pk: ['session_id', 'citizenid'], cols: [['session_id', 'int'], ['citizenid', 'varchar']], rows: [{ session_id: 1, citizenid: 'ABC123' }] },
	player_vehicles: { pk: ['id'], cols: [['id', 'int'], ['citizenid', 'varchar'], ['license', 'varchar'], ['vehicle', 'varchar'], ['plate', 'varchar'], ['fakeplate', 'varchar'], ['garage', 'varchar'], ['fuel', 'int'], ['engine', 'float'], ['body', 'float'], ['state', 'int'], ['depotprice', 'int'], ['drivingdistance', 'int'], ['nickname', 'varchar'], ['favorite', 'tinyint'], ['last_out_at', 'int'], ['owner_job', 'varchar'], ['owner_gang', 'varchar'], ['glovebox', 'longtext'], ['trunk', 'longtext']], rows: [
		{ id: 1, citizenid: 'ABC123', license: 'license:aaa', vehicle: 'sultan', plate: 'BRL 01', fakeplate: null, garage: 'pillbox', fuel: 80, engine: 950, body: 1000, state: 1, depotprice: 0, drivingdistance: 120, nickname: null, favorite: true, last_out_at: 1_760_000_000, owner_job: null, owner_gang: null, glovebox: '[{"name":"water","count":2}]', trunk: '[{"name":"weapon","count":1}]' },
	] },
	player_groups: { pk: ['citizenid', 'group'], cols: [['citizenid', 'varchar'], ['group', 'varchar'], ['type', 'varchar'], ['grade', 'int'], ['hired_at', 'datetime']], rows: [{ citizenid: 'GHI789', group: 'police', type: 'job', grade: 2, hired_at: T }] },
	admindash_sanctions: { pk: ['id'], cols: [['id', 'int'], ['target_dbid', 'int'], ['target_name', 'varchar'], ['type', 'varchar'], ['reason', 'varchar'], ['duration_minutes', 'int'], ['issued_by_name', 'varchar'], ['created_at', 'datetime']], rows: [
		{ id: 1, target_dbid: 1, target_name: 'Pedro', type: 'warn', reason: 'RP', duration_minutes: null, issued_by_name: 'Kenzo', created_at: recent },
		{ id: 2, target_dbid: 1, target_name: 'Pedro', type: 'jail', reason: 'Fuite', duration_minutes: 30, issued_by_name: 'Kenzo', created_at: Date.now() - 40 * 24 * HOUR },
	] },
	bans: { pk: ['id'], cols: [['id', 'int'], ['license', 'varchar'], ['discord', 'varchar'], ['reason', 'varchar'], ['expire', 'int'], ['bannedby', 'varchar']], rows: [{ id: 1, license: 'license:aaa', discord: null, reason: 'Cheat', expire: 1_800_000_000, bannedby: 'Admin' }] },
	admindash_staff_sessions: { pk: ['id'], cols: [['id', 'int'], ['license', 'varchar'], ['staff_name', 'varchar'], ['role_name', 'varchar'], ['started_at', 'datetime'], ['ended_at', 'datetime'], ['last_seen_at', 'datetime']], rows: [
		{ id: 1, license: 'license:aaa', staff_name: 'Pedro', role_name: 'admin', started_at: recent - HOUR, ended_at: recent, last_seen_at: recent },
		{ id: 2, license: 'aaa', staff_name: 'Pedro', role_name: 'superadmin', started_at: Date.now() - 20 * 60_000, ended_at: null, last_seen_at: Date.now() - 60_000 },
	] },
	admindash_audit_log: { pk: ['id'], cols: [['id', 'int'], ['issued_by_license', 'varchar'], ['issued_by_name', 'varchar'], ['action', 'varchar'], ['target_name', 'varchar'], ['details', 'text'], ['created_at', 'datetime']], rows: [
		{ id: 1, issued_by_license: 'license:aaa', issued_by_name: 'Pedro', action: 'kick', target_name: 'Bob', details: 'AFK', created_at: recent + 10 * 60_000 },
	] },
	// A log whose date is unix seconds in an INT column: still in the merged feed
	carplay_logs: { pk: ['id'], cols: [['id', 'int'], ['identifier', 'varchar'], ['player_name', 'varchar'], ['verdict', 'varchar'], ['label', 'varchar'], ['vehicle', 'varchar'], ['url', 'varchar'], ['created_at', 'int']], rows: [
		{ id: 1, identifier: 'license:aaa', player_name: 'Pedro', verdict: 'ok', label: null, vehicle: 'sultan', url: 'https://x', created_at: Math.floor((recent - HOUR) / 1000) },
	] },
	mdt_audit: { pk: ['id'], cols: [['id', 'int'], ['target_cid', 'varchar'], ['target_name', 'varchar'], ['actor_name', 'varchar'], ['actor_role', 'varchar'], ['field', 'varchar'], ['effect', 'varchar'], ['reason', 'varchar'], ['at', 'bigint']], rows: [
		{ id: 1, target_cid: 'ABC123', target_name: 'Tony', actor_name: 'Off. Doe', actor_role: 'police', field: 'casier', effect: 'lu', reason: 'contrôle', at: recent + 5 * 60_000 },
	] },
	bank_flows: { pk: ['id'], cols: [['id', 'int'], ['created_at', 'datetime'], ['kind', 'varchar'], ['from_cid', 'varchar'], ['to_cid', 'varchar'], ['from_license', 'varchar'], ['to_license', 'varchar'], ['amount', 'bigint'], ['note', 'varchar']], rows: [
		{ id: 1, created_at: recent, kind: 'transfer', from_cid: 'ABC123', to_cid: 'GHI789', from_license: 'license:aaa', to_license: 'license:bbb', amount: 500, note: 'loyer' },
	] },
	bank_audit_log: { pk: ['id'], cols: [['id', 'int'], ['admin_name', 'varchar'], ['action', 'varchar'], ['target', 'varchar'], ['amount_before', 'bigint'], ['amount_after', 'bigint'], ['details', 'varchar'], ['created_at', 'datetime']], rows: [
		{ id: 1, admin_name: 'Pedro', action: 'set', target: 'ABC123', amount_before: 10, amount_after: 900, details: null, created_at: recent - 3 * HOUR },
	] },
	admindash_roles: { pk: ['name'], cols: [['name', 'varchar'], ['label', 'varchar']], rows: [{ name: 'admin', label: 'Administrateur' }] },
};

async function seed(mirror, names = Object.keys(TABLES)) {
	const out = await mirror.apply({ tables: names.map((name) => {
		const t = TABLES[name];
		const fields = t.cols.map(c => c[0]);
		return {
			name, mode: 'hash', schemaHash: name, from: null,
			schema: { pk: t.pk, columns: t.cols.map(([n, type]) => ({ name: n, type, columnType: type })) },
			fields, rows: t.rows.map(r => fields.map(f => r[f] ?? null)),
		};
	}) });
	for (const [name, result] of Object.entries(out.tables)) assert.ok(result.ok, `${name}: ${JSON.stringify(result)}`);
}

async function setup({ tables } = {}) {
	const db = await openTestDb();
	const mirror = createFivemMirror({ db, logger: { warn: () => undefined } });
	const audits = [];
	const warnings = [];
	const data = createFivemData({ db, mirror, audit: { record: e => audits.push(e) }, logger: { warn: (...a) => warnings.push(a.join(' ')) } });
	if (tables !== false) await seed(mirror, tables);
	const actor = (list = ['fivemdata.view']) => ({ id: '100000000000000001', can: p => list.includes(p) });
	return { db, mirror, data, audits, warnings, actor };
}

test('fivem data: nothing mirrored yet gives a clear message, the bot features stay quiet', async () => {
	const { data, actor } = await setup({ tables: false });
	await assert.rejects(data.search(actor(), ''), /bl_telemetry/);
	assert.equal(await data.findByDiscord(ALICE), null);
	assert.equal(await data.discordVars(ALICE), null);
	assert.equal(await data.findByTebexPlayer({ uuid: '123' }), null);
	assert.equal((await data.settingsView()).enabled, false);
});

test('fivem data: search by name, character, plate, Discord, license; summaries with playtime', async () => {
	const { data, actor, warnings } = await setup();
	const ids = async q => (await data.search(actor(), q)).map(s => s.userId);
	assert.deepEqual(await ids('pedr'), [1]);
	assert.deepEqual(await ids('moretti'), [1]);
	assert.deepEqual(await ids('brl 01'), [1]);
	assert.deepEqual(await ids(ALICE), [1]);
	assert.deepEqual(await ids('license:bbb'), [2]);
	assert.deepEqual(await ids('ghi789'), [2]);
	assert.deepEqual(await ids('100%'), []);
	const [latest] = await data.search(actor(), '');
	assert.equal(latest.userId, 1);
	assert.equal(latest.online, true);
	assert.equal(latest.sessions, 2);
	assert.ok(latest.playSeconds >= 2 * 3600);
	assert.deepEqual(latest.characters.map(c => c.name).sort(), ['Lia', 'Tony Moretti']);
	assert.equal(latest.characters.find(c => c.citizenId === 'ABC123').job.label, 'LSPD');
	assert.equal(latest.discordId, ALICE);
	await assert.rejects(data.search({ id: 'x', can: () => false }, ''), ForbiddenError);
	assert.deepEqual(warnings, []);
});

test('fivem data: the full sheet follows the permissions, is audited and fits the Discord embeds', async () => {
	const { data, actor, audits, warnings } = await setup();
	const limited = await data.player(actor(), 1);
	assert.equal(limited.account.username, 'Pedro');
	assert.equal(limited.account.fivemId, '123');
	assert.equal(limited.economy, null);
	assert.equal(limited.characters[0].money, undefined);
	assert.equal(limited.vehicles[0].glovebox, undefined);
	assert.equal(limited.vehicles[0].engine, 95);
	assert.equal(limited.playtime.sessions, 2);
	assert.equal(limited.playtime.online, true);
	assert.deepEqual(limited.playtime.lastSessions.at(-1).characters, ['Tony Moretti']);
	assert.equal(limited.vehicles[0].state, 'garage');
	assert.equal(limited.vehicles[0].lastOut, 1_760_000_000_000);
	assert.deepEqual(limited.sanctions.map(s => s.type), ['warn', 'jail']);
	assert.equal(limited.bans[0].expire, 1_800_000_000_000);
	assert.equal(limited.staff.active, true);
	assert.deepEqual(limited.staff.roles.sort(), ['admin', 'superadmin']);
	assert.equal(limited.police.lookups[0].by, 'Off. Doe');
	assert.match(limited.activity[0].day, /^\d{4}-\d{2}-\d{2}$/);
	assert.deepEqual(limited.permissions, { economy: false, inventory: false, logs: false });
	assert.equal(audits.at(-1).action, 'fivemdata.view');
	assert.equal(audits.at(-1).target, '1');

	const full = await data.player(actor(['fivemdata.view', 'fivemdata.economy', 'fivemdata.inventory']), 1);
	assert.equal(full.economy.total, 1005);
	assert.equal(full.economy.flows[0].from, 'Tony Moretti');
	assert.deepEqual(full.vehicles[0].glovebox, [{ name: 'water', count: 2 }]);
	assert.equal(full.vehicles[0].trunk[0].name, 'weapon');
	assert.deepEqual(full.characters.find(c => c.citizenId === 'ABC123').inventory, [{ name: 'phone', count: 1, slot: 1 }]);
	await assert.rejects(data.player(actor(), 99), NotFoundError);

	// The Discord embeds hold up with this sheet
	const main = playerPayload(full);
	assert.equal(main.components[0].components.length, 5);
	for (const part of ['veh', 'sanc', 'sess', 'inv', 'eco']) assert.ok(detailPayload(full, part).embeds[0].toJSON().title);
	assert.deepEqual(warnings, []);
});

test('fivem data: game logs merge datetime and unix sources, newest first, money logs only with their permission', async () => {
	const { data, actor, warnings } = await setup();
	await assert.rejects(data.gameLogs(actor(), {}), ForbiddenError);
	const logs = await data.gameLogs(actor(['fivemdata.logs']), {});
	assert.deepEqual(logs.map(l => l.source), ['admin', 'mdt', 'sanctions', 'carplay', 'sanctions']);
	assert.equal(logs[2].details, 'RP');
	assert.equal(logs[4].details, 'Fuite · 30 min');
	assert.deepEqual((await data.gameLogs(actor(['fivemdata.logs']), { search: 'sultan' })).map(l => l.source), ['carplay']);
	assert.deepEqual((await data.gameLogs(actor(['fivemdata.logs']), { source: 'sanctions' })).map(l => l.details), ['RP', 'Fuite · 30 min']);
	const older = await data.gameLogs(actor(['fivemdata.logs']), { before: logs[1].at });
	assert.equal(older[0].source, 'sanctions');
	const money = await data.gameLogs(actor(['fivemdata.logs', 'fivemdata.economy']), { source: 'bank' });
	assert.equal(money[0].details, '10 → 900');
	const sources = await data.logSources(actor(['fivemdata.logs']));
	assert.deepEqual(sources.find(s => s.key === 'sanctions'), { key: 'sanctions', label: 'Sanctions', total: 2, recent: 1 });
	assert.equal(sources.find(s => s.key === 'carplay').recent, 1);
	assert.equal(sources.some(s => s.key === 'bank'), false);
	assert.deepEqual(warnings, []);
});

test('fivem data: memberships, catalog, overview and Discord variables', async () => {
	const { data, actor, warnings } = await setup();
	const members = await data.memberships();
	const pedro = members.find(m => m.userId === 1);
	assert.deepEqual(pedro.groups.map(g => `${g.type}:${g.name}:${g.grade}`).sort(), ['gang:ballas:1', 'job:police:2']);
	assert.equal(pedro.staff.name, 'superadmin');
	assert.deepEqual(members.find(m => m.userId === 2).groups.map(g => g.name).sort(), ['ems', 'police']);

	const catalog = await data.catalog(actor());
	assert.deepEqual(catalog.jobs.map(j => j.label), ['LSPD']);
	assert.deepEqual(catalog.gangs[0].grades, [{ grade: 1, name: 'Membre' }]);
	assert.deepEqual(catalog.staff, [{ name: 'admin', label: 'Administrateur' }]);

	const overview = await data.overview(actor());
	assert.equal(overview.accounts, 4);
	assert.equal(overview.characters, 3);
	assert.equal(overview.online, 1);
	assert.equal(overview.week.players, 2);
	assert.deepEqual(overview.staff.map(s => `${s.role}:${s.active}`), ['admin:false', 'superadmin:true']);
	assert.equal(overview.topPlaytime[0].username, 'Pedro');

	const vars = await data.discordVars(ALICE);
	assert.equal(vars['fivem.linked'], 'Oui');
	assert.equal(vars['fivem.character'], 'Tony Moretti');
	assert.equal(vars['fivem.job.grade'], 'Sergent');
	assert.equal(vars['fivem.sanctions'], 2);
	assert.equal(vars['fivem.online'], 'Oui');
	assert.equal(Object.values(vars).some(v => String(v).includes('1.2.3.4')), false);
	assert.equal((await data.discordVars('100000000000000009'))['fivem.linked'], 'Non');
	assert.deepEqual(warnings, []);
});

test('fivem data: Tebex buyers by CFX id, license, then a unique exact name', async () => {
	const { data } = await setup({ tables: ['users'] });
	assert.deepEqual(await data.findByTebexPlayer({ uuid: '123', name: 'X' }), { userId: 1, username: 'Pedro', discordId: ALICE, method: 'fivem' });
	assert.equal(await data.findByTebexPlayer({ uuid: 'a'.repeat(40) }), null);
	assert.equal((await data.findByTebexPlayer({ uuid: '555', name: 'Solo' })).method, 'name');
	assert.equal(await data.findByTebexPlayer({ uuid: '555', name: 'Twin' }), null);
});

test('fivem data: mirror state for the panel', async () => {
	const { data, actor } = await setup({ tables: ['users', 'players'] });
	const view = await data.settingsView();
	assert.equal(view.enabled, true);
	assert.equal(view.source, 'mirror');
	assert.equal(view.tables, 2);
	const state = await data.test(actor(['fivemdata.manage']));
	assert.equal(state.features.users, true);
	assert.equal(state.features.bans, false);
	await assert.rejects(data.test(actor()), ForbiddenError);
});

test('fivem data: most players at once per day', () => {
	const day = Date.UTC(2026, 9, 1);
	const at = h => new Date(day + h * 3_600_000).toISOString();
	const byDay = peaks([
		{ joined_at: at(10), left_at: at(12) },
		{ joined_at: at(11), left_at: at(13) },
		{ joined_at: at(11.5), left_at: null },
		{ joined_at: at(14), left_at: at(15) },
	], day + 16 * 3_600_000);
	assert.equal(byDay.get('2026-10-01'), 3);
});
