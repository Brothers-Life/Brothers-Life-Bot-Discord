import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { openTestDb } from '../db.js';
import { createSettings } from '../../src/db/index.js';
import { createPrincipal } from '../../src/core/permissions.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createTelemetry, tokenFromHeader, parsePerf } from '../../src/core/telemetry/index.js';
import { scrub, isSensitiveKey } from '../../src/core/telemetry/privacy.js';
import { registerTelemetryIngestRoutes } from '../../src/web/routes/telemetry.js';

const LICENSE = 'license:0123456789abcdef0123456789abcdef01234567';
const IP = '82.64.12.34';
const CID = 'ABC12345';
const OTHER_CID = 'XYZ98765';

const ALL = ['panel.access', 'telemetry.view', 'telemetry.economy', 'telemetry.logs', 'telemetry.announce', 'telemetry.manage'];
const admin = { ...createPrincipal({ id: '100000000000000001', permissions: ALL }), source: 'panel' };
const viewer = { ...createPrincipal({ id: '100000000000000002', permissions: ['panel.access', 'telemetry.view'] }), source: 'panel' };

const services = [];
after(() => {
	for (const s of services) s.close();
});

async function setup({ config = {}, fetchImpl } = {}) {
	const db = await openTestDb();
	const settings = createSettings(db);
	const calls = { logs: [], categories: [], notifications: [], types: [], audit: [], warnings: [] };
	const logs = {
		registerCategory: (key, label, types) => calls.categories.push({ key, label, types }),
		log: async (guildId, category, message, type) => {
			calls.logs.push({ guildId, category, message, type });
			return ['700000000000000001'];
		},
	};
	const notifications = {
		registerType: (key, def) => calls.types.push({ key, ...def }),
		push: async n => {
			calls.notifications.push(n);
		},
	};
	const audit = { record: async entry => calls.audit.push(entry) };
	const logger = { warn: (...args) => calls.warnings.push(args.join(' ')), error: () => undefined, info: () => undefined };
	const telemetry = createTelemetry({ db, settings, logs, notifications, audit, config, logger, fetchImpl: fetchImpl ?? (async () => new Response(null, { status: 404 })) });
	services.push(telemetry);
	return { db, settings, telemetry, calls };
}

const ago = minutes => Date.now() - minutes * 60_000;

// What bl_telemetry sends in a few minutes of play
function realisticBatch() {
	return {
		events: [
			{ type: 'session_start', src: 5, player_name: 'Jean_Dupont', ts: ago(30), data: { license: LICENSE } },
			{ type: 'event', subtype: 'character_loaded', src: 5, citizenid: CID, player_name: 'Jean Dupont', ts: ago(29), data: { license: LICENSE } },
			{ type: 'player_snapshot', citizenid: CID, player_name: 'Jean Dupont', src: 5, ts: ago(25), data: { job: 'police', job_grade: 2, gang: 'none', cash: 1200, bank: 50000, crypto: 1.5, online: true, extra: { inventory: [{ n: 'water', c: 3 }, { n: 'bread', c: 1 }] } } },
			{ type: 'economy_snapshot', ts: ago(25), data: { player_count: 12, chars_total: 340, total_cash: 1_500_000, total_bank: 42_000_000, total_crypto: 12.5, society_total: 3_000_000 } },
			{ type: 'purchase', citizenid: CID, player_name: 'Jean Dupont', ts: ago(20), data: { shop: '24/7 Grove', item: 'water', label: 'Eau', qty: 2, unit_price: 5, total: 10, currency: 'cash' } },
			{ type: 'death', src: 5, citizenid: CID, player_name: 'Jean Dupont', ts: ago(15), data: { cause: 'balle', weapon: 'WEAPON_PISTOL', killer_cid: OTHER_CID, killer_name: 'Marc Martin', x: 100.5, y: -200.25, z: 30, screenshot_url: 'https://cdn.example.com/shots/0123456789abcdef0123456789abcdef.jpg' } },
			{ type: 'event', subtype: 'chat', src: 5, citizenid: CID, player_name: 'Jean Dupont', ts: ago(14), data: { message: 'Bonjour à tous' } },
			{ type: 'event', subtype: 'command', src: 5, citizenid: CID, player_name: 'Jean Dupont', ts: ago(13), data: { message: '/me sourit' } },
			{ type: 'event', subtype: 'bank_flow', citizenid: CID, ts: ago(12), data: { kind: 'transfer', from_cid: CID, to_cid: OTHER_CID, amount: 1500, note: 'loyer' } },
			{ type: 'vehicle_snapshot', citizenid: CID, ts: ago(11), data: { plate: 'AB123CD', model: 'sultan', garage: 'pillbox', state: 1 } },
			{ type: 'admin_action', ts: ago(10), data: { action: 'kick', admin_name: 'Modo', target_cid: OTHER_CID, target_name: 'Marc Martin', reason: 'HRP', extra: {} } },
			{ type: 'game_log', subtype: 'admindash_sanctions', citizenid: OTHER_CID, player_name: 'Marc Martin', ts: ago(9), data: { action: 'ban', admin: 'Modo', reason: 'cheat', target_ip: IP } },
			{ type: 'event', subtype: 'explosion', src: 5, citizenid: CID, player_name: 'Jean Dupont', ts: ago(8), data: { explosion_type: 7, x: 1, y: 2, z: 3 } },
			{ type: 'anticheat', src: 5, citizenid: CID, player_name: 'Jean Dupont', ts: ago(7), data: { reason: 'noclip', details: { vitesse: 42, ip: IP } } },
			{ type: 'perf_snapshot', data: { window_s: 300, players_online: 12, global: { n: 40, fps: 58.5, min: 22, worst: 80, hist: [1, 2, 10, 20, 7] }, entities: { vehicles: { total: 150, top: [{ model: 123, n: 4 }] } }, zones: [{ key: '1:2', n: 10, fps: 40, min: 20, worst: 90, obj: 300, peds: 20, veh: 10, x: 250, y: 500 }], interiors: [{ key: '9876', n: 6, fps: 30, min: 15, worst: 120, obj: 900, peds: 4, veh: 0, x: 10, y: 20, z: 30, players: 2 }], players: [{ cid: CID, name: 'Jean Dupont', n: 5, fps: 25.5, min: 12, worst: 100, obj: 400, ping: 180 }] } },
			{ type: 'profiler_snapshot', data: { span_ms: 10000, total_ms: 800, frames: 300, resources: [{ name: 'qbx_core', ms: 600, n: 1200 }, { name: 'ox_inventory', ms: 100, n: 50 }], top: [] } },
			{ type: 'db_snapshot', data: { name: '_tables', label: 'Tables', kind: 'tables', columns: ['table', 'lignes', 'octets'], rows: [['players', 340, 1048576], ['player_vehicles', 900, 524288]] } },
			{ type: 'db_snapshot', data: { name: '_resources', label: 'Ressources', kind: 'internal', columns: ['name', 'state', 'version', 'x', 'map', 'data', 'client', 'server', 'files'], rows: [['qbx_core', 'started', '1.0', '', 0, 0, 3, 5, 10], ['my_mlo', 'started', '1.0', '', 1, 2, 0, 0, 80]] } },
			{ type: 'db_snapshot', data: { name: 'license_map', label: 'Empreintes', kind: 'hidden', columns: ['cid', 'license', 'name'], rows: [[CID, 'h1', 'Jean Dupont'], [OTHER_CID, 'h2', 'Marc Martin'], ['ALT00001', 'h1', 'Jean Alt']] } },
			{ type: 'db_snapshot', data: { name: 'last_bans', label: 'Derniers bans', kind: 'table', pos: 3, columns: ['name', 'license', 'reason'], rows: [['Marc Martin', LICENSE, 'cheat']] } },
		],
		logs: [
			{ ts: ago(6), line: `[qbx_core] Player Jean_Dupont connecting from ${IP} (${LICENSE})`, labels: { channel: 'qbx_core', level: 'info', source: 'console' } },
			{ ts: ago(5), line: 'SCRIPT ERROR: @bl_shops/server.lua:12: attempt to index a nil value', labels: { channel: 'bl_shops', level: 'error', source: 'console' } },
			{ ts: ago(4), line: 'server thread hitch warning: timer interval of 312 milliseconds', labels: { channel: 'citizen-server-impl', level: 'warn', source: 'console' } },
		],
	};
}

test('privacy helpers: sensitive keys, masked identifiers, screenshot links kept', () => {
	for (const key of ['license', 'license2', 'ip', 'target_ip', 'steam_id', 'hwid', 'discord', 'tokens', 'identifier', 'xbl', 'live']) assert.ok(isSensitiveKey(key), key);
	for (const key of ['online', 'ping', 'players', 'ts', 'citizenid', 'shipping', 'delivered']) assert.ok(!isSensitiveKey(key), key);
	const out = scrub({ line: `from ${IP}:30120 ${LICENSE} steam:110000112345678`, nested: [{ license: 'x', ok: 1 }], screenshot_url: 'https://x/0123456789abcdef0123456789abcdef.jpg', at: new Date(0) });
	assert.ok(!out.line.includes(IP) && !out.line.includes('license:') && !out.line.includes('steam:'));
	assert.deepEqual(out.nested, [{ ok: 1 }]);
	assert.equal(out.screenshot_url, 'https://x/0123456789abcdef0123456789abcdef.jpg');
	assert.ok(out.at instanceof Date);
});

test('ingest token: Bearer and Basic accepted, anything else refused, never returned in clear', async () => {
	const { telemetry, calls } = await setup();
	assert.equal(await telemetry.checkIngest('Bearer anything'), false, 'no token configured: everything refused');
	assert.equal(tokenFromHeader(undefined), null);
	await assert.rejects(telemetry.generateIngestToken(viewer), ForbiddenError);
	const { token } = await telemetry.generateIngestToken(admin);
	assert.ok(token.length >= 40);
	assert.equal(await telemetry.checkIngest(`Bearer ${token}`), true);
	assert.equal(await telemetry.checkIngest(`Basic ${Buffer.from(`fivem:${token}`).toString('base64')}`), true);
	assert.equal(await telemetry.checkIngest(`Bearer ${token}x`), false);
	assert.equal(await telemetry.checkIngest(token), false);
	assert.equal(await telemetry.checkIngest('Basic !!!'), false);
	const cfg = await telemetry.config(admin);
	assert.equal(cfg.hasIngestToken, true);
	assert.equal(cfg.ingestTokenEnd, token.slice(-4));
	assert.ok(!JSON.stringify(cfg).includes(token));
	assert.ok(calls.audit.some(a => a.action === 'telemetry.token'));

	// Environment fallback (TELEMETRY_INGEST_TOKEN), until a token is set from the panel
	const env = await setup({ config: { TELEMETRY_INGEST_TOKEN: 'env-token-0123456789' } });
	assert.equal(await env.telemetry.checkIngest('Bearer env-token-0123456789'), true);
});

test('config: validated, partial updates, audit', async () => {
	const { telemetry, calls } = await setup();
	await assert.rejects(telemetry.config(viewer), ForbiddenError);
	await assert.rejects(telemetry.setConfig(admin, { fivemBase: 'ftp://x' }), ValidationError);
	await assert.rejects(telemetry.setConfig(admin, { fivemBase: 'http://169.254.169.254' }), ValidationError);
	await assert.rejects(telemetry.setConfig(admin, { timezone: 'Mars/Olympus' }), ValidationError);
	await assert.rejects(telemetry.setConfig(admin, { retention: { nope: 3 } }), ValidationError);
	await assert.rejects(telemetry.setConfig(admin, { ingestToken: 'short' }), ValidationError);
	const cfg = await telemetry.setConfig(admin, { fivemBase: 'http://192.168.1.10:30120/', alerts: { moneyJump: 500000 }, retention: { server_logs: 7 }, timezone: 'America/Montreal', ingestToken: 'my-own-token-1234567890' });
	assert.equal(cfg.fivemBase, 'http://192.168.1.10:30120');
	assert.equal(cfg.alerts.moneyJump, 500000);
	assert.equal(cfg.alerts.errors5min, 25);
	assert.equal(cfg.retention.server_logs, 7);
	assert.equal(cfg.retention.events, 365);
	assert.equal(cfg.timezone, 'America/Montreal');
	assert.equal(cfg.ingestToken, undefined);
	assert.equal(await telemetry.checkIngest('Bearer my-own-token-1234567890'), true);
	const again = await telemetry.setConfig(admin, { alerts: { errors5min: 10 } });
	assert.equal(again.alerts.moneyJump, 500000, 'other settings kept');
	assert.equal(again.hasIngestToken, true);
	assert.ok(calls.audit.filter(a => a.action === 'telemetry.config').length === 2);
	assert.ok(calls.categories.some(c => c.key === 'telemetry' && c.types.anticheat));
	assert.ok(calls.types.some(t => t.key === 'telemetry_alert' && t.permission === 'telemetry.view'));
});

test('a realistic batch fills every table; sessions join the character; identifiers stay out of the views', async () => {
	const { db, telemetry, calls } = await setup();
	const out = await telemetry.ingestBatch(realisticBatch());
	assert.deepEqual(out, { ok: true, events: 20, logs: 3 });
	const count = async table => Number((await db.raw(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
	assert.equal(await count('tel_economy_snapshots'), 1);
	assert.equal(await count('tel_player_snapshots'), 1);
	assert.equal(await count('tel_purchases'), 1);
	assert.equal(await count('tel_deaths'), 1);
	assert.equal(await count('tel_vehicles_owned'), 1);
	assert.equal(await count('tel_admin_actions'), 1);
	assert.equal(await count('tel_server_logs'), 3);
	assert.equal(await count('tel_perf_windows'), 1);
	assert.equal(await count('tel_perf_buckets'), 3);
	assert.equal(await count('tel_profiler_runs'), 1);
	assert.equal(await count('tel_db_snapshots'), 4);
	assert.equal(await count('tel_db_table_stats'), 2);
	// db_snapshot, perf_snapshot and profiler_snapshot are not copied into tel_events
	assert.equal(await count('tel_events'), 14);
	assert.deepEqual(calls.warnings, [], 'no query failed');

	// The session opened at connection is now the character's; the license stays in tel_sessions only
	const session = (await db.raw('SELECT * FROM tel_sessions')).rows[0];
	assert.equal(session.citizenid, CID);
	assert.equal(session.player_name, 'Jean Dupont');
	assert.equal(session.license, LICENSE);
	const stored = (await db.raw('SELECT data::text AS d FROM tel_events')).rows.map(r => r.d).join('\n');
	assert.ok(!stored.includes(LICENSE) && !stored.includes(IP), 'event data stored without license nor IP');

	await telemetry.ingestBatch({ events: [{ type: 'session_end', src: 5, citizenid: CID, ts: ago(1), data: { reason: 'Exiting', license: LICENSE } }] });
	const ended = (await db.raw('SELECT * FROM tel_sessions')).rows[0];
	assert.equal(ended.drop_reason, 'Exiting');
	assert.ok(ended.end_ts instanceof Date);
	assert.ok(Math.abs(ended.duration_min - 29) < 0.5);

	// Every view: nothing sensitive in what the panel gets
	const results = {
		overview: await telemetry.overview(admin, { hours: 24 }),
		economy: await telemetry.economy(admin, {}),
		players: await telemetry.players(admin, { q: 'jean' }),
		player: await telemetry.player(admin, { cid: CID }),
		logs: await telemetry.logs(admin, {}),
		admin: await telemetry.admin(admin),
		db: await telemetry.db(admin),
		deathmap: await telemetry.deathmap(admin, {}),
		insights: await telemetry.insights(admin, { days: 7 }),
		timeline: await telemetry.timeline(admin, { cid: CID }),
		linked: await telemetry.linked(admin, { cid: CID }),
		search: await telemetry.search(admin, { q: 'Grove' }),
		trace: await telemetry.trace(admin, { cid: CID, ts: new Date(ago(12)).toISOString() }),
		inflation: await telemetry.inflation(admin, {}),
		scripts: await telemetry.scripts(admin),
		staff: await telemetry.staff(admin, {}),
		perf: await telemetry.perf(admin, {}),
		alerts: await telemetry.alerts(admin),
		anomalies: await telemetry.anomalies(admin, {}),
	};
	assert.deepEqual(calls.warnings, [], 'no view query failed');
	const text = JSON.stringify(results);
	assert.ok(!text.includes(LICENSE) && !text.includes('license:'), 'no license returned');
	assert.ok(!text.includes(IP), 'no IP returned');
	assert.ok(!/"license"/.test(text) && !/"ip"/.test(text) && !/"target_ip"/.test(text));

	// A few shapes
	assert.equal(results.economy.latest.total_bank, 42_000_000);
	assert.equal(results.economy.purchases[0].article, 'Eau');
	assert.equal(results.economy.flows[0].amount, 1500);
	assert.equal(results.players.players[0].citizenid, CID);
	assert.deepEqual(results.player.inventory.map(i => i.name), ['water', 'bread']);
	assert.equal(results.player.ident.job, 'police');
	assert.equal(results.player.deaths[0].screenshot_url, 'https://cdn.example.com/shots/0123456789abcdef0123456789abcdef.jpg');
	assert.equal(results.player.sessions.length, 1);
	assert.ok(results.logs.logs.length === 3 && results.logs.chat.length === 2);
	assert.equal(results.admin.actions[0].action, 'kick');
	assert.deepEqual(results.db.tables.map(t => t.name), ['players', 'player_vehicles']);
	assert.deepEqual(results.db.snapshots.map(s => s.name), ['last_bans'], 'hidden, internal and _ snapshots left out');
	assert.deepEqual(results.db.snapshots[0].columns, ['name', 'reason'], 'license column dropped');
	assert.deepEqual(results.db.snapshots[0].rows, [['Marc Martin', 'cheat']]);
	assert.equal(results.deathmap.points.length, 1);
	assert.equal(results.insights.tz, 'Europe/Paris');
	const kinds = results.timeline.items.map(i => i.kind);
	for (const kind of ['session_start', 'session_end', 'death', 'purchase', 'bank_flow', 'chat', 'command', 'explosion', 'character_loaded', 'alert']) assert.ok(kinds.includes(kind), kind);
	assert.ok(!kinds.includes('player_snapshot'));
	assert.deepEqual(results.linked.players.map(p => p.citizenid), ['ALT00001']);
	assert.equal(results.linked.players[0].via, 'même licence');
	assert.equal(results.search.events.length, 0);
	assert.equal(results.search.logs.length, 0);
	assert.equal((await telemetry.search(admin, { q: 'bl_shops' })).logs.length, 1);
	assert.equal((await telemetry.search(admin, { q: 'Bonjour' })).chat.length, 1);
	assert.equal(results.trace.flows.length, 1);
	assert.equal(results.trace.before.cash, 1200);
	assert.equal(results.scripts.resources[0].channel, 'bl_shops');
	assert.equal(results.scripts.hitches.count, 1);
	assert.equal(results.scripts.hitches.worst, 312);
	assert.ok(results.staff.items.some(i => i.source === 'txAdmin' && i.category === 'kick'));
	assert.ok(results.staff.items.some(i => i.source === 'admindash_sanctions' && i.category === 'ban' && i.actor === 'Modo'));
	assert.equal(results.perf.clients.fps, 58.5);
	assert.equal(results.perf.profiler.resources[0].name, 'qbx_core');
	assert.equal(results.perf.installed.total, 2);
	assert.ok(results.perf.recommendations.some(r => r.title.includes('qbx_core')));
	assert.ok(results.perf.recommendations.some(r => r.title.includes('Intérieur')));
	assert.equal(results.alerts.alerts[0].kind, 'anticheat');
	assert.equal(results.alerts.config.moneyJump, 1_000_000);
});

test('permissions: each view checks its permission; search hides console and chat without telemetry.logs', async () => {
	const { telemetry } = await setup();
	await telemetry.ingestBatch(realisticBatch());
	await assert.rejects(telemetry.overview(null), ForbiddenError);
	await assert.rejects(telemetry.overview({ id: '1', can: () => false }), ForbiddenError);
	for (const method of ['economy', 'anomalies', 'inflation']) await assert.rejects(telemetry[method](viewer, {}), ForbiddenError, method);
	await assert.rejects(telemetry.trace(viewer, { cid: CID }), ForbiddenError);
	await assert.rejects(telemetry.logs(viewer, {}), ForbiddenError);
	await assert.rejects(telemetry.createCommand(viewer, { message: 'x' }), ForbiddenError);
	await assert.rejects(telemetry.setConfig(viewer, {}), ForbiddenError);
	assert.throws(() => telemetry.subscribe(null, () => undefined), ForbiddenError);
	const found = await telemetry.search(viewer, { q: 'Jean' });
	assert.ok(found.players.length === 1);
	assert.deepEqual(found.logs, []);
	assert.deepEqual(found.chat, []);
	await assert.rejects(telemetry.search(viewer, { q: 'J' }), ValidationError);
	await assert.rejects(telemetry.player(viewer, {}), ValidationError);
	await assert.rejects(telemetry.timeline(viewer, { cid: CID, before: 'pas une date' }), ValidationError);
});

test('anticheat event: alert stored, sent as a telemetry log and a panel notification, 2 min cooldown', async () => {
	const { db, telemetry, calls } = await setup();
	const event = { type: 'anticheat', src: 7, citizenid: CID, player_name: 'Jean Dupont', data: { reason: 'noclip', details: { vitesse: 42, ip: IP } } };
	await telemetry.ingestBatch({ events: [event] });
	await telemetry.ingestBatch({ events: [event] });
	const alerts = (await db.raw('SELECT * FROM tel_alerts')).rows;
	assert.equal(alerts.length, 1);
	assert.equal(alerts[0].kind, 'anticheat');
	assert.equal(alerts[0].severity, 'critical');
	assert.equal(alerts[0].notified, true);
	assert.equal(alerts[0].title, 'Anticheat : Jean Dupont — noclip');
	assert.ok(alerts[0].detail.includes('vitesse : 42'));
	assert.ok(!JSON.stringify(alerts[0]).includes(IP));
	assert.equal(calls.logs.length, 1);
	assert.equal(calls.logs[0].guildId, null);
	assert.equal(calls.logs[0].category, 'telemetry');
	assert.equal(calls.logs[0].type, 'anticheat');
	assert.equal(calls.logs[0].message.color, 'danger');
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls.notifications.length, 1);
	assert.deepEqual({ ...calls.notifications[0], body: undefined }, { type: 'telemetry_alert', permission: 'telemetry.view', title: alerts[0].title, body: undefined, url: '/telemetry/alerts' });
});

test('alert engine: anticheat console lines, error burst, money jump, server down and back', async () => {
	let serverUp = true;
	const fetchImpl = async (url) => {
		if (!serverUp) throw new Error('ECONNREFUSED');
		if (url.endsWith('/perf/')) return new Response('tickTime_count{name="svMain"} 100\ntickTime_sum{name="svMain"} 1.5\ntickTime_bucket{name="svMain",le="0.005"} 80\ntickTime_bucket{name="svMain",le="+Inf"} 100\n');
		return Response.json({ clients: 12, sv_maxclients: 64 });
	};
	const { db, telemetry, calls } = await setup({ fetchImpl });
	await telemetry.setConfig(admin, { fivemBase: 'http://127.0.0.1:30120', alerts: { errors5min: 3, moneyJump: 1_000_000 } });

	// The scraper reads /perf/ and /dynamic.json
	assert.equal(await telemetry.scrapeTick(), true);
	await telemetry.scrapeTick();
	const metrics = (await db.raw('SELECT metric, thread, le, value FROM tel_perf_metrics ORDER BY metric, le')).rows;
	assert.ok(metrics.some(m => m.metric === 'players_online' && m.value === 12));
	assert.ok(metrics.some(m => m.metric === 'tick_bucket' && m.thread === 'svMain' && m.le === 0.005));
	assert.ok(metrics.some(m => m.metric === 'server_up' && m.value === 1));
	assert.ok(telemetry.health().lastScrapeOk);

	// First pass: sets the cursors, nothing raised
	await telemetry.alertsTick();
	assert.equal(calls.logs.length, 0);

	// Two anticheat lines, a burst of errors, a money jump of 2 M
	await telemetry.ingestBatch({
		logs: [
			{ line: '^1[anticheat] Jean detected: godmode', labels: { channel: 'bl_anticheat', level: 'warn' } },
			{ line: '[anticheat] Marc flagged: speedhack', labels: { channel: 'bl_anticheat', level: 'error' } },
			{ line: 'ok', labels: { channel: 'bl_anticheat', level: 'info' } },
			...[1, 2, 3].map(i => ({ line: `SCRIPT ERROR ${i}`, labels: { channel: 'bl_shops', level: 'error' } })),
		],
		events: [
			{ type: 'player_snapshot', citizenid: CID, player_name: 'Jean Dupont', ts: ago(10), data: { cash: 1000, bank: 10000, online: true } },
			{ type: 'player_snapshot', citizenid: CID, player_name: 'Jean Dupont', ts: Date.now() - 1000, data: { cash: 1000, bank: 2_010_000, online: true } },
		],
	});
	await telemetry.alertsTick();
	const kinds = (await db.raw('SELECT kind, title FROM tel_alerts ORDER BY id')).rows;
	assert.deepEqual(kinds.map(k => k.kind).sort(), ['anticheat', 'error_burst', 'money_jump']);
	assert.equal(kinds.find(k => k.kind === 'anticheat').title, 'Anticheat : 2 détections');
	assert.equal(kinds.find(k => k.kind === 'error_burst').title, '4 erreurs console en 5 minutes');
	assert.ok(kinds.find(k => k.kind === 'money_jump').title.startsWith('Saut d’argent : Jean Dupont +2'));
	assert.deepEqual(calls.logs.map(l => l.type).sort(), ['anticheat', 'error_burst', 'money_jump']);

	// The anomalies view finds the same jump
	const anomalies = await telemetry.anomalies(admin, { hours: 1 });
	assert.equal(anomalies.players[0].citizenid, CID);
	assert.equal(anomalies.players[0].jump, 2_000_000);

	// Nothing new: nothing raised (cooldowns, cursors)
	await telemetry.alertsTick();
	assert.equal(calls.logs.length, 3);

	// Server down (two failed readings), then back
	serverUp = false;
	await telemetry.scrapeTick();
	await telemetry.scrapeTick();
	await telemetry.alertsTick();
	serverUp = true;
	await telemetry.scrapeTick();
	await telemetry.alertsTick();
	assert.deepEqual(calls.logs.slice(3).map(l => [l.type, l.message.color]), [['server_down', 'danger'], ['server_up', 'success']]);
	assert.deepEqual(calls.warnings, []);
});

test('announcements: created from the panel, picked up by FiveM, acknowledged', async () => {
	const { telemetry, calls } = await setup();
	await assert.rejects(telemetry.createCommand(admin, { payload: { message: '   ' } }), ValidationError);
	await assert.rejects(telemetry.createCommand(admin, { type: 'kick', payload: { message: 'x' } }), ValidationError);
	const { ok, id } = await telemetry.createCommand(admin, { type: 'announce', payload: { message: 'Redémarrage dans 10 min', title: 'Info', mode: 'weird', duration: 999999 } }, { authorName: 'Pedro' });
	assert.equal(ok, true);
	assert.ok(calls.audit.some(a => a.action === 'telemetry.announce' && a.details.message === 'Redémarrage dans 10 min'));

	const pulled = await telemetry.ingestBatch({ events: [], logs: [] }, { withCommands: true });
	assert.equal(pulled.commands.length, 1);
	assert.equal(pulled.commands[0].id, id);
	assert.deepEqual(pulled.commands[0].payload, { message: 'Redémarrage dans 10 min', title: 'Info', mode: 'both', type: 'inform', duration: 60000 });
	assert.deepEqual(await telemetry.pullCommands(), [], 'sent once');

	await telemetry.ingestBatch({ acks: [{ id, ok: true, result: 'envoyee a 12 joueur(s)' }] });
	const { commands } = await telemetry.listCommands(viewer);
	assert.equal(commands[0].status, 'done');
	assert.equal(commands[0].result, 'envoyee a 12 joueur(s)');
	assert.equal(commands[0].author, 'Pedro');

	// The older way: GET /v1/commands then POST /v1/commands/:id/ack
	const second = await telemetry.createCommand(admin, { message: 'Second' });
	const [cmd] = await telemetry.pullCommands();
	assert.equal(cmd.id, second.id);
	await telemetry.ackCommand(String(second.id), false, 'ordre inconnu');
	await telemetry.ackCommand('abc', true, 'ignored');
	assert.equal((await telemetry.listCommands(viewer)).commands[0].status, 'failed');
	const staff = await telemetry.staff(viewer, {});
	assert.ok(staff.items.some(i => i.source === 'panel' && i.actor === 'Pedro'));
});

test('purge: rows older than their retention go, by table', async () => {
	const { db, telemetry } = await setup();
	await telemetry.setConfig(admin, { retention: { server_logs: 7 } });
	await telemetry.ingestBatch({
		logs: [{ ts: ago(8 * 24 * 60), line: 'old' }, { ts: ago(6 * 24 * 60), line: 'recent' }],
		events: [{ type: 'event', subtype: 'chat', ts: ago(400 * 24 * 60), data: { message: 'very old' } }, { type: 'event', subtype: 'chat', data: { message: 'new' } }],
	});
	const removed = await telemetry.purgeTick();
	assert.equal(removed.server_logs, 1);
	assert.equal(removed.events, 1);
	assert.deepEqual((await db.raw('SELECT line FROM tel_server_logs')).rows.map(r => r.line), ['recent']);
	assert.deepEqual((await db.raw('SELECT data->>\'message\' AS m FROM tel_events')).rows.map(r => r.m), ['new']);
});

test('live feed: new lines reach the subscribers, console and chat only with telemetry.logs', async () => {
	const { telemetry } = await setup();
	const full = [];
	const limited = [];
	const stopFull = telemetry.subscribe(admin, p => full.push(p));
	const stopLimited = telemetry.subscribe(viewer, p => limited.push(p));
	// The first tick only sets the cursors
	for (let i = 0; i < 50 && !full.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
	full.length = 0;
	limited.length = 0;
	await telemetry.ingestBatch(realisticBatch());
	await telemetry.streamTick();
	assert.equal(full.length, 1);
	assert.equal(full[0].logs.length, 3);
	assert.equal(full[0].chat.length, 2);
	assert.equal(full[0].sessions.length, 1);
	assert.equal(full[0].deaths.length, 1);
	assert.equal(full[0].alerts.length, 1);
	assert.ok(!JSON.stringify(full[0]).includes(IP) && !JSON.stringify(full[0]).includes(LICENSE));
	assert.deepEqual(limited[0].logs, []);
	assert.deepEqual(limited[0].chat, []);
	assert.equal(limited[0].sessions.length, 1);
	// Nothing new: empty lists
	await telemetry.streamTick();
	assert.equal(full[1].logs.length, 0);
	stopFull();
	stopLimited();
});

test('ingest routes answer as bl-panel-api: 401, batch with commands, acks', async () => {
	const { telemetry } = await setup();
	await telemetry.setConfig(admin, { ingestToken: 'route-token-0123456789' });
	const app = Fastify();
	registerTelemetryIngestRoutes(app, { core: { telemetry }, logger: { error: () => undefined } });
	await app.ready();
	try {
		const auth = { authorization: 'Bearer route-token-0123456789', 'content-type': 'application/json' };
		let res = await app.inject({ method: 'POST', url: '/v1/batch', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, payload: '{}' });
		assert.equal(res.statusCode, 401);
		assert.deepEqual(res.json(), { error: 'unauthorized' });

		const { id } = await telemetry.createCommand(admin, { message: 'Salut' });
		res = await app.inject({ method: 'POST', url: '/v1/batch?commands=1', headers: auth, payload: JSON.stringify({ events: [{ type: 'event', subtype: 'chat', data: { message: 'yo' } }], logs: [] }) });
		assert.equal(res.statusCode, 200);
		const body = res.json();
		assert.equal(body.ok, true);
		assert.equal(body.events, 1);
		assert.equal(body.commands[0].id, id);

		res = await app.inject({ method: 'POST', url: '/v1/batch', headers: auth, payload: JSON.stringify({ events: [] }) });
		assert.deepEqual(res.json(), { ok: true, events: 0, logs: 0 });
		res = await app.inject({ method: 'POST', url: '/v1/batch', headers: auth, payload: '{broken' });
		assert.equal(res.statusCode, 400);

		const basic = `Basic ${Buffer.from('x:route-token-0123456789').toString('base64')}`;
		res = await app.inject({ method: 'GET', url: '/v1/commands', headers: { authorization: basic } });
		assert.deepEqual(res.json(), { commands: [] });
		res = await app.inject({ method: 'POST', url: `/v1/commands/${id}/ack`, headers: auth, payload: JSON.stringify({ ok: true, result: 'fait' }) });
		assert.deepEqual(res.json(), { ok: true });
		res = await app.inject({ method: 'POST', url: `/v1/commands/${id}/ack`, headers: { authorization: 'Bearer route-token-0123456789' } });
		assert.deepEqual(res.json(), { ok: true }, 'an ack without body is accepted');
		res = await app.inject({ method: 'GET', url: '/v1/commands', headers: { authorization: 'Bearer nope' } });
		assert.equal(res.statusCode, 401);
		assert.equal((await telemetry.listCommands(viewer)).commands[0].status, 'done');
	}
	finally {
		await app.close();
	}
});

test('perf text of FiveM is parsed into tick metrics', () => {
	const metrics = parsePerf('tickTime_count{name="svNetwork"} 50\ntickTime_sum{name="svNetwork"} 0.2\ntickTime_bucket{name="svNetwork",le="0.01"} 45\ntickTime_bucket{name="svNetwork",le="+Inf"} 50\n# comment\n');
	assert.deepEqual(metrics, [
		{ metric: 'tick_count', thread: 'svNetwork', value: 50 },
		{ metric: 'tick_sum_sec', thread: 'svNetwork', value: 0.2 },
		{ metric: 'tick_bucket', thread: 'svNetwork', le: 0.01, value: 45 },
	]);
});
