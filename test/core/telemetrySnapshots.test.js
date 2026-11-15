import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../db.js';
import { createSnapshots } from '../../src/core/telemetry/snapshots.js';
import { createIngest } from '../../src/core/telemetry/ingest.js';
import { createFivemMirror } from '../../src/core/fivem/mirror.js';

const MIN = 60_000;
const T0 = Date.now();

// The real queries, without the "log and give no rows" of the service: an SQL error fails the test
async function setup() {
	const db = await openTestDb();
	const q = (text, values) => db.raw(text, values);
	const snapshots = createSnapshots({ q, now: () => T0 });
	const ingest = createIngest({ q, snapshots, perf: { ingest: async () => false }, raiseAlert: async () => null, now: () => T0 });
	return { db, snapshots, ingest, views: snapshots.views };
}

const business = (ts, rows, totals = {}) => ({ type: 'business_snapshot', ts, data: { totals, rows } });

test('business readings: the last one is the live list, the history keeps them all', async () => {
	const { db, ingest, views } = await setup();
	await ingest.batch({ events: [
		business(T0 - 10 * MIN, [
			{ job: 'police', label: 'LSPD', type: 'leo', open: true, online: 8, on_duty: 6, employees: 34, balance: 1_250_000, level: 4, xp: 1820, week_duty_s: 412_300 },
			{ job: 'taxi', label: 'Taxi', online: 1, on_duty: 1, employees: 3 },
		], { jobs: 2, open: 1, on_duty: 7, online: 9, safes: 1_250_000, duty_by_type: { leo: 6, autre: 1 } }),
		business(T0 - 5 * MIN, [
			{ job: 'police', label: 'LSPD', type: 'leo', open: false, online: 2, on_duty: 0, employees: 34, balance: 1_300_000 },
		], { jobs: 1, open: 0, on_duty: 0, online: 2, safes: 1_300_000 }),
	] });
	assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM tel_events'))[0].n, 0, 'readings are not copied into the events');

	const list = await views.businesses();
	assert.equal(list.live, true);
	assert.deepEqual(list.rows.map(r => [r.job, r.open, r.online, r.on_duty]), [['police', false, 2, 0]], 'the taxi left the reading');
	assert.equal(Number(list.rows[0].balance), 1_300_000);
	assert.equal(list.totals.on_duty, 0);

	// A reading replayed late does not replace the newer one
	await ingest.batch({ events: [business(T0 - 8 * MIN, [{ job: 'police', online: 9, on_duty: 9, employees: 34 }])] });
	assert.equal((await views.businesses()).rows[0].on_duty, 0);

	const one = await views.business({ job: 'police', days: 1 });
	assert.equal(one.latest.label, 'LSPD');
	assert.ok(one.history.length >= 1);
	assert.equal(one.history.reduce((n, h) => Math.max(n, h.on_duty), 0), 9);
	assert.equal((await views.business({ job: 'x"; DROP' })).job, null);
});

test('a reading that is too old is no longer live', async () => {
	const { ingest, views } = await setup();
	await ingest.batch({ events: [business(T0 - 60 * MIN, [{ job: 'police', online: 3, on_duty: 3, employees: 5 }])] });
	const list = await views.businesses();
	assert.equal(list.live, false);
	assert.equal(list.rows.length, 1);
});

test('duty and opening events build the hours of a company', async () => {
	const { ingest, views } = await setup();
	const duty = (ts, cid, data) => ({ type: 'event', subtype: 'duty', ts, citizenid: cid, player_name: `Agent ${cid}`, data: { job: 'police', job_label: 'LSPD', ...data } });
	await ingest.batch({ events: [
		duty(T0 - 120 * MIN, 'AAA', { on: true }),
		duty(T0 - 60 * MIN, 'AAA', { on: false, duration_s: 3600 }),
		duty(T0 - 50 * MIN, 'AAA', { on: true }),
		duty(T0 - 20 * MIN, 'AAA', { on: false, duration_s: 1800, dropped: true }),
		duty(T0 - 30 * MIN, 'BBB', { on: false, duration_s: 600 }),
		{ type: 'event', subtype: 'duty', ts: T0, citizenid: 'CCC', data: { job: 'ems', on: false, duration_s: 99 } },
		{ type: 'event', subtype: 'business_open', ts: T0 - 90 * MIN, data: { job: 'police', open: true, on_duty: 2 } },
		{ type: 'event', subtype: 'business_open', ts: T0 - 10 * MIN, data: { job: 'police', open: false, on_duty: 0 } },
	] });
	const one = await views.business({ job: 'police' });
	assert.deepEqual(one.duty.map(d => [d.citizenid, d.shifts, Number(d.seconds), d.dropped]), [['AAA', 2, 5400, 1], ['BBB', 1, 600, 0]]);
	assert.deepEqual(one.openings.map(o => [o.open, o.on_duty]), [[false, 0], [true, 2]]);
});

test('gangs, money by reason, big movements and server health', async () => {
	const { ingest, views } = await setup();
	await ingest.batch({ events: [
		{ type: 'gang_snapshot', ts: T0 - 5 * MIN, data: { rows: [{ gang: 'ballas', label: 'Ballas', online: 5, members: 18, xp: 4200, category: 'street', max_members: 25, territories: 3 }] } },
		{ type: 'money_flow', ts: T0 - 10 * MIN, data: { window_s: 300, in_total: 320_000, out_total: 88_000, flows: [
			{ type: 'bank', action: 'add', reason: 'paycheck', total: 320_000, n: 41, max: 12_000 },
			{ type: 'cash', action: 'remove', reason: 'bl_store #', total: 88_000, n: 130, max: 4500 },
		] } },
		{ type: 'money_flow', ts: T0 - 5 * MIN, data: { window_s: 300, flows: [{ type: 'bank', action: 'add', reason: 'paycheck', total: 80_000, n: 9, max: 15_000 }, { type: 'bank', action: 'set', total: 5 }] } },
		{ type: 'health_snapshot', ts: T0 - 5 * MIN, data: {
			window_s: 300, server_uptime_s: 41_200, players: 64, max_players: 128, staff_on_duty: 3, ping_avg: 48, ping_max: 210,
			resources: { total: 331, started: 318, stopped: 13 }, hitches: { n: 4, max_ms: 380, total_ms: 900 },
			slow_queries: [{ resource: 'ox_inventory', n: 12, max_ms: 640, avg_ms: 210 }], errors: [{ resource: 'bl_store', n: 3, sample: 'SCRIPT ERROR' }],
			drops: { quit: 9, crash: 2 }, connects: { attempts: 14, joined: 12, loaded: 11 }, queue: 18, item_moves_suppressed: 0,
		} },
		{ type: 'health_snapshot', ts: T0 - 10 * MIN, data: { window_s: 300, players: 60, errors: [{ resource: 'bl_store', n: 2, sample: 'older' }], drops: { quit: 1 } } },
		{ type: 'event', subtype: 'money_move', ts: T0 - MIN, citizenid: 'AAA', player_name: 'Alice', data: { money: 'bank', action: 'add', amount: 500_000, reason: 'Vente' } },
		{ type: 'event', subtype: 'item_move', ts: T0 - 2 * MIN, citizenid: 'AAA', data: { item: 'weapon_pistol', count: 1, from: '12', from_type: 'player', to: 'trunk1', to_type: 'trunk', weapon: true } },
	] });

	const gangs = await views.gangs();
	assert.deepEqual(gangs.rows.map(g => [g.gang, g.online, g.territories]), [['ballas', 5, 3]]);

	const flows = await views.flows({ hours: 1 });
	assert.deepEqual([flows.in, flows.out], [400_000, 88_000], '"set" is neither in nor out');
	assert.deepEqual(flows.reasons.map(r => [r.reason, Number(r.total), r.n, Number(r.max)])[0], ['paycheck', 400_000, 50, 15_000]);
	assert.equal(flows.reasons.find(r => r.action === 'set').reason, 'inconnu');
	assert.equal(flows.curve.reduce((n, c) => n + Number(c.in), 0), 400_000);

	assert.deepEqual((await views.moves({ hours: 1 })).rows.map(r => r.subtype), ['money_move', 'item_move']);
	assert.deepEqual((await views.moves({ hours: 1, kind: 'item' })).rows.map(r => r.data.item), ['weapon_pistol']);

	const health = await views.health({ hours: 1 });
	assert.equal(health.live, true);
	assert.deepEqual([health.latest.players, health.latest.hitches, health.latest.hitch_max_ms, health.latest.queue], [64, 4, 380, 18]);
	assert.deepEqual(health.errors, [{ resource: 'bl_store', n: 5, sample: 'SCRIPT ERROR' }]);
	assert.deepEqual(health.slowQueries, [{ resource: 'ox_inventory', n: 12, max_ms: 640 }]);
	assert.deepEqual(health.drops, { quit: 10, crash: 2 });
	assert.equal(health.connects.loaded, 11);
});

test('a company: payroll runs and sales per day come from the mirror, only when money is asked', async () => {
	const { db, ingest, views } = await setup();
	const mirror = createFivemMirror({ db, logger: { warn: () => undefined } });
	const id = { name: 'id', type: 'int' };
	const out = await mirror.apply({ tables: [
		{ name: 'job_payroll_runs', mode: 'append', schemaHash: 'p', from: null, cursor: '2', fields: ['id', 'job_name', 'total_amount', 'employee_count', 'run_by_name', 'created_at'],
			schema: { pk: ['id'], columns: [id, { name: 'job_name', type: 'varchar' }, { name: 'total_amount', type: 'int' }, { name: 'employee_count', type: 'int' }, { name: 'run_by_name', type: 'varchar' }, { name: 'created_at', type: 'timestamp' }] },
			rows: [[1, 'police', 5000, 2, 'Max', T0 - 60 * MIN], [2, 'ems', 900, 1, 'Léa', T0 - 60 * MIN]] },
		{ name: 'store_sales', mode: 'append', schemaHash: 's', from: null, cursor: '3', fields: ['id', 'job_name', 'total', 'created_at'],
			schema: { pk: ['id'], columns: [id, { name: 'job_name', type: 'varchar' }, { name: 'total', type: 'int' }, { name: 'created_at', type: 'timestamp' }] },
			rows: [[1, 'police', 100, T0 - 30 * MIN], [2, 'police', 250, T0 - 20 * MIN], [3, 'ems', 40, T0 - 20 * MIN]] },
	] });
	assert.deepEqual([out.tables.job_payroll_runs.ok, out.tables.store_sales.ok], [true, true]);
	await ingest.batch({ events: [business(T0 - MIN, [{ job: 'police', online: 1, on_duty: 1, employees: 2 }])] });

	const plain = await views.business({ job: 'police', days: 7 });
	assert.deepEqual([plain.payroll, plain.sales], [null, null]);
	const full = await views.business({ job: 'police', days: 7, money: true });
	assert.deepEqual(full.payroll.map(p => [Number(p.total), Number(p.employees), p.by]), [[5000, 2, 'Max']]);
	assert.deepEqual([full.sales.reduce((n, s) => n + s.n, 0), full.sales.reduce((n, s) => n + Number(s.total), 0)], [2, 350]);
	// A company without these tables' rows, or a server without the tables: empty lists, no error
	assert.deepEqual((await views.business({ job: 'taxi', days: 7, money: true })).sales, []);
});
