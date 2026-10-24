import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../db.js';
import { mirrorQuery } from '../../src/core/fivem/sql.js';
import { insightsReport } from '../../src/core/fivem/insights.js';
import { serverReport } from '../../src/core/fivem/serverReport.js';
import { dayOf } from '../../src/core/stats.js';

const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.now();
const ago = ms => new Date(T0 - ms);
const isoDay = at => new Date(at).toISOString().slice(0, 10);
const json = value => JSON.stringify(value);

// Mirror tables as mirror.js creates them (MariaDB types mapped to PostgreSQL), with a few rows each
const COUNT_TABLES = ['admindash_blips', 'ox_doorlock', 'shops', 'market_markets', 'mapeditor_objects', 'bl_crafting_tables', 'bl_crafting_recipes', 'tv_screens',
	'billboards', 'dj_venues', 'qbx_teleport_overrides', 'bl_hotels', 'sky_phone_company_profiles', 'ox_inventory', 'playerskins'];
const FIXTURES = {
	users: ['userid bigint, username text, discord text, license text', [
		[1, 'alice', 'discord:111', 'license:a'], [2, 'bob', 'discord:222', 'license:b'], [3, 'carl', null, 'license:c'],
	]],
	players: ['citizenid text, "userId" bigint, name text, charinfo text, job text, gang text, money text', [
		['AAA', 1, 'Alice', json({ firstname: 'Alice', lastname: 'Martin' }), json({ name: 'police', onduty: true }), json({ name: 'none' }), json({ cash: 1000, bank: 9000 })],
		['BBB', 2, 'Bob', json({ firstname: 'Bob', lastname: 'Durand' }), json({ name: 'unemployed', onduty: false }), json({ name: 'ballas' }), json({ cash: 500, bank: '250' })],
		['CCC', 3, 'Carl', 'pas du json', json({ name: 'police', onduty: false }), json({ name: 'none' }), json({ cash: 50_000, bank: 150_000 })],
	]],
	bl_mc_sessions: ['user_id bigint, joined_at timestamptz, left_at timestamptz, drop_reason text', [
		[1, ago(2 * H), ago(H), 'Exiting'],
		[1, ago(3 * DAY), ago(3 * DAY - 2 * H), 'Exiting'],
		[2, ago(20 * MIN), null, null],
		[3, ago(40 * DAY), ago(40 * DAY - H), 'timeout'],
	]],
	admindash_staff_sessions: ['staff_name text, role_name text, license text, started_at timestamptz, ended_at timestamptz, last_seen_at timestamptz', [
		['Max', 'admin', 'license:m', ago(3 * H), ago(30 * MIN), ago(30 * MIN)],
		['Max', 'admin', 'license:m', ago(5 * MIN), null, ago(MIN)],
		['Léa', 'modo', 'license:l', ago(2 * DAY), ago(2 * DAY - H), ago(2 * DAY - H)],
	]],
	admindash_reports: ['id bigint, sender_name text, message text, status text, priority text, category text, claimed_by_name text, resolved_by_name text, created_at timestamptz, claimed_at timestamptz, resolved_at timestamptz', [
		[1, 'Bob', 'aide', 'resolved', 'high', 'bug', 'Max', 'Max', ago(2 * H), ago(2 * H - 10 * MIN), ago(2 * H - 30 * MIN)],
		[2, 'Alice', 'question', 'open', 'low', 'rp', null, null, ago(H), null, null],
	]],
	admindash_sanctions: ['id bigint, target_dbid bigint, target_name text, type text, reason text, duration_minutes bigint, issued_by_name text, created_at timestamptz', [
		[1, 2, 'Bob', 'warn', 'HRP', null, 'Max', ago(DAY)],
		[2, 2, 'Bob', 'jail', 'Braquage', 30, 'Max', ago(2 * DAY)],
		[3, 3, 'Carl', 'ban', 'Triche', null, 'Léa', ago(40 * DAY)],
	]],
	admindash_audit_log: ['issued_by_name text, action text, created_at timestamptz', [['Max', 'kick', ago(H)], ['Max', 'tp', ago(2 * H)]]],
	admindash_staffmsg_history: ['issued_by_name text, line text, target_label text, created_at timestamptz', [['Max', 'Restart dans 5 min', 'Tous', ago(H)]]],
	admindash_roles: ['id bigint, name text, label text, protected bigint', [[1, 'admin', 'Admin', 1], [2, 'modo', 'Modo', 0]]],
	admindash_role_actions: ['role_id bigint, action_key text', [[1, 'kick'], [1, 'ban'], [2, 'kick']]],
	player_vehicles: ['citizenid text, vehicle text, fuel double precision, engine double precision, body double precision, state bigint, owner_job text, garage text, fakeplate text', [
		['AAA', 'sultan', 80, 1000, 1000, 1, 'police', 'pillbox', null],
		['AAA', 'police2', 60, 400, 1000, 0, 'police', null, ''],
		['BBB', 'sultan', 40, 900, 300, 2, null, null, 'FAKE1'],
	]],
	sky_phone_calls: ['status text, started_at timestamptz, answered_at timestamptz, duration_seconds bigint', [['ended', ago(H), ago(H - 5000), 60], ['missed', ago(2 * H), null, 0]]],
	sky_phone_health_daily: ['owner_identifier text, activity_date date, steps bigint, distance_meters double precision', [
		['AAA', isoDay(T0 - 2 * DAY), 1000, 800], ['BBB', isoDay(T0 - 2 * DAY), 3000, 2200],
	]],
	job_week_stats: ['job_name text, week_start bigint, stats text, xp_gained bigint, level_after bigint', [['police', Math.floor((T0 - 7 * DAY) / 1000), json({ arrests: 4 }), 120, 3]]],
	player_jobs_activity: ['job text, last_checkin bigint', [['police', Math.floor((T0 - H) / 1000)], ['police', T0 - 2 * H], ['taxi', null]]],
	sky_phone_crypto_market_ticks: ['market_id text, price numeric, created_at timestamptz', [['BTC', 5_000_000, ago(3 * H)], ['BTC', 5_100_000, ago(H)]]],
	sky_phone_crypto_markets: ['id text, price numeric, price_scale numeric, issued_supply numeric, status text', [['BTC', 5_100_000, 100, 21, 'open']]],
	sky_phone_crypto_balances: ['asset_id text, account_id bigint, available numeric, locked numeric', [['BTC', 1, 1, 0], ['BTC', 2, 0, 2], ['BTC', 3, 0, 0]]],
	player_groups: ['citizenid text, "group" text, type text, grade bigint', [['AAA', 'police', 'job', 0], ['CCC', 'police', 'job', 1], ['BBB', 'ballas', 'gang', 0]]],
	job_duty_time: ['job_name text, citizenid text, seconds bigint', [['police', 'AAA', 3600], ['police', 'CCC', 1800]]],
	job_week_duty: ['job_name text, citizenid text, week_start bigint, seconds bigint', [['police', 'AAA', 1, 100], ['police', 'AAA', 2, 200], ['police', 'CCC', 2, 300]]],
	job_level_state: ['job_name text, level bigint, xp bigint, title text', [['police', 3, 1200, 'Brigade']]],
	job_open_state: ['job_name text, is_open bigint, changed_by text, changed_at timestamptz', [['police', 1, 'Max', ago(H)]]],
	job_payroll_runs: ['job_name text, total_amount numeric, employee_count bigint, run_by_name text, created_at timestamptz', [['police', 5000, 2, 'Max', ago(DAY)]]],
	selfmenu_invoices: ['job_name text, amount numeric, settled bigint', [['police', 100, 1], ['police', 250, 0]]],
	job_safe_log: ['job_name text, created_at timestamptz', [['police', ago(H)], ['police', ago(40 * DAY)]]],
	qbx_gang_meta: ['gang_name text, category text, max_members bigint, xp bigint', [['ballas', 'gang', 10, 500]]],
	qbx_custom_garages: ['id bigint', [[1]]],
	xt_prison: ['identifier text, jailtime bigint', [['BBB', 30], ['AAA', 0]]],
	bans: ['id bigint, name text, reason text, expire bigint, bannedby text', [[1, 'Carl', 'Triche', Math.floor((T0 + DAY) / 1000), 'Léa']]],
	mdt_calls: ['id bigint, code text, title text, place text, priority text, state text, caller_name text, closed_by text, created_at bigint, closed_at bigint', [
		[1, '10-31', 'Vol', 'Vinewood', 'high', 'closed', 'Alice', 'Max', T0 - H, Math.floor((T0 - 30 * MIN) / 1000)],
	]],
	bl_safezones_zones: ['name text, is_active bigint', [['Hôpital', 1], ['Mairie', 0]]],
	bl_safezones_visits: ['zone_name text, seconds bigint', [['Hôpital', 120], ['Hôpital', 60]]],
	harvest_zones: ['id bigint, label text, item text, amount bigint, enabled bigint, stock_enabled bigint, current_stock bigint, max_stock bigint, access text, access_value text', [
		[1, 'Pommes', 'apple', 2, 1, 1, 5, 10, 'job', 'police'],
	]],
	harvest_zone_player_stats: ['player_name text, total_harvested bigint', [['Alice', 40], ['Bob', 12]]],
	bank_accounts_new: ['id text, amount numeric, creator text, isfrozen bigint, is_savings bigint', [['police', 100_000, 'Max', 0, 0], ['epargne', null, 'Bob', 1, 1]]],
	bank_flows: ['kind text, amount numeric, created_at timestamptz', [['deposit', 100, ago(H)], ['deposit', 50, ago(2 * H)], ['withdraw', 30, ago(H)]]],
	premium_points: ['balance bigint', [[100], [50]]],
	premium_loyalty: ['balance bigint', [[7]]],
	premium_shop_items: ['id bigint, label text, price bigint', [[1, 'Casquette', 300]]],
	premium_shop_item_purchases: ['item_id bigint, created_at timestamptz', [[1, ago(H)], [1, ago(40 * DAY)], [9, ago(H)]]],
	premium_bundle_purchases: ['created_at timestamptz', [[ago(H)]]],
	premium_crate_openings: ['rarity text', [['rare'], ['common'], ['common']]],
	premium_gifts: ['status text', [['opened'], ['pending']]],
	premium_promo_redemptions: ['id bigint', [[1]]],
	sky_phone_bank_transactions: ['kind text, amount numeric', [['transfer', 200], ['transfer', 300]]],
	...Object.fromEntries(COUNT_TABLES.map(t => [t, ['id bigint', t === 'shops' ? [[1], [2]] : []]])),
};

async function load(db, only) {
	for (const [table, [columns, rows]] of Object.entries(FIXTURES)) {
		if (only && !only.includes(table)) continue;
		await db.exec(`CREATE TABLE fivem."${table}" (${columns})`);
		for (const row of rows) await db.raw(`INSERT INTO fivem."${table}" VALUES (${row.map((_, i) => `$${i + 1}`).join(', ')})`, row);
	}
}

// The real query on the mirror; `when` skips a missing table like fivemData.js but never hides an SQL error
function harness(db) {
	const run = mirrorQuery(db);
	const executed = [];
	const skipped = new Set();
	const query = async (sql, params) => {
		executed.push(sql);
		return run(sql, params);
	};
	const when = async (table, fn, fallback = []) => {
		const [hit] = await run('SELECT 1 FROM pg_tables WHERE schemaname = \'fivem\' AND tablename = ?', [table]);
		if (!hit) {
			skipped.add(table);
			return fallback;
		}
		return fn();
	};
	const groups = new Map([
		['police', { label: 'Police', type: 'job', grades: { 0: { name: 'Recrue', payment: 100 }, 1: { name: 'Chef', payment: 300, isboss: true } } }],
		['ballas', { label: 'Ballas', type: 'gang', grades: {} }],
	]);
	return { query, when, groupsMap: async () => groups, executed, skipped };
}

test('fivem reports: insights run on the PostgreSQL mirror', async () => {
	const db = await openTestDb();
	await load(db);
	const h = harness(db);
	const report = await insightsReport({
		...h, canMoney: true,
		discordActivity: async () => [{ user_id: '111', day: dayOf(T0), messages: 30, voice_seconds: 7200 }],
		discordMembers: async () => new Set(['111', '999']),
	});
	assert.deepEqual([...h.skipped], []);
	assert.equal(h.executed.length, 14, 'every query ran');

	assert.equal(report.attendance.dau, 2);
	assert.equal(report.attendance.mau, 2);
	assert.equal(report.attendance.churn.away30, 1);
	assert.equal(report.staff.reports.count, 2);
	assert.equal(report.staff.reports.claimMedian, 10);
	assert.equal(report.staff.reports.resolveMedian, 30);
	assert.equal(report.staff.reports.unclaimed, 1);
	assert.deepEqual(report.justice.repeat.map(o => [o.name, o.count]), [['Bob', 2]]);
	assert.equal(report.justice.grid.flat().reduce((a, b) => a + b, 0), 3);
	assert.equal(report.jobs.checkinGrid.flat().reduce((a, b) => a + b, 0), 2);
	assert.equal(report.jobs.weekly[0].job, 'Police');
	assert.equal(report.jobs.weekly[0].stats.arrests, 4);
	assert.equal(report.jobs.jobless, 1);
	assert.equal(report.jobs.multi, 0);
	assert.equal(report.vehicles.perPlayer, 1);
	assert.equal(report.vehicles.avgFuel, 60);
	assert.deepEqual(report.vehicles.jobFleet, [{ job: 'Police', count: 2 }]);
	assert.equal(report.phone.calls, 2);
	assert.equal(report.phone.answered, 50);
	assert.deepEqual(report.phone.health, [{ day: isoDay(T0 - 2 * DAY), steps: 4000, km: 3, people: 2 }]);
	assert.equal(report.discord.linked, 2);
	assert.equal(report.discord.membersLinked, 1);
	assert.equal(report.discord.crossed.find(c => c.username === 'alice').kind, 'both');

	assert.equal(report.economy.percentiles.p99, 200_000);
	assert.equal(report.economy.byJob.find(j => j.job === 'Police').count, 2);
	assert.deepEqual(report.economy.crypto.assets, ['BTC']);
	assert.ok(report.economy.crypto.points.length >= 1 && report.economy.crypto.points.length <= 3);
	assert.ok(report.economy.crypto.points.every(p => p.BTC >= 50_000 && p.BTC <= 51_000));
	assert.deepEqual(report.economy.crypto.holders, [{ asset: 'BTC', holders: 2 }]);
});

test('fivem reports: server report runs on the PostgreSQL mirror', async () => {
	const db = await openTestDb();
	await load(db);
	const h = harness(db);
	const report = await serverReport({ ...h, canMoney: true });
	assert.deepEqual([...h.skipped], []);
	assert.equal(h.executed.length, 65, 'every query ran');

	const { activity, vehicles, justice, world, staff, economy } = report;
	assert.deepEqual({ ...activity.totals, peak: undefined }, { sessions: 3, players: 2, hours: 3, avgMinutes: 90, peak: undefined });
	assert.ok(activity.totals.peak >= 1);
	assert.equal(activity.heatmap.flat().reduce((a, b) => a + b, 0), 4, '60 days: the old session counts');
	assert.deepEqual(activity.drops, [{ reason: 'Exiting', count: 2 }]);
	assert.deepEqual(activity.online.map(o => o.username), ['bob']);
	const newPlayers = activity.days.reduce((n, d) => n + d.newPlayers, 0);
	assert.ok(newPlayers >= 1 && newPlayers <= 2);

	const police = report.jobs.find(j => j.name === 'police');
	assert.equal(police.members, 2);
	assert.equal(police.onDuty, 1);
	assert.equal(police.dutySeconds, 5400);
	assert.deepEqual([police.weekDutySeconds, police.weekPeople], [500, 2]);
	assert.deepEqual(police.level, { level: 3, xp: 1200, title: 'Brigade' });
	assert.deepEqual(police.open, { isOpen: true, by: 'Max' });
	assert.equal(police.payroll.total, 5000);
	assert.deepEqual(police.invoices, { count: 2, total: 350, unpaid: 250 });
	assert.equal(police.safeMoves, 1);
	assert.equal(police.grades[1].isBoss, true);
	assert.deepEqual(report.jobs.find(j => j.name === 'ballas').gang, { category: 'gang', maxMembers: 10, xp: 500 });

	assert.deepEqual({ ...vehicles, models: undefined, garages: undefined }, { total: 3, out: 1, garage: 1, impound: 1, damaged: 2, fakePlates: 1, customGarages: 1, models: undefined, garages: undefined });
	assert.deepEqual(vehicles.models[0], { model: 'sultan', count: 2 });
	assert.deepEqual(vehicles.garages, [{ garage: 'pillbox', count: 1 }]);

	assert.deepEqual(justice.jailed, [{ citizenId: 'BBB', name: 'Bob Durand', months: 30 }]);
	assert.deepEqual(justice.sanctions30, { warn: 1, jail: 1 });
	assert.deepEqual(justice.sanctions.map(s => s.id), [1, 2, 3]);
	assert.equal(justice.bans[0].expire, Math.floor((T0 + DAY) / 1000) * 1000);
	assert.equal(justice.reports.length, 2);
	assert.equal(justice.calls[0].at, T0 - H);
	assert.equal(justice.calls[0].closedAt, Math.floor((T0 - 30 * MIN) / 1000) * 1000);

	assert.equal(world.counts.shops, 2);
	assert.equal(world.counts.doors, 0);
	assert.deepEqual(world.safezones, [{ name: 'Hôpital', active: true, visits: 2, seconds: 180 }, { name: 'Mairie', active: false, visits: 0, seconds: 0 }]);
	assert.equal(world.harvest[0].access, 'job : Police');
	assert.deepEqual(world.harvesters[0], { name: 'Alice', total: 40 });

	assert.deepEqual(staff.roles.map(r => [r.name, r.actions]), [['admin', 2], ['modo', 1]]);
	const max = staff.members.find(m => m.name === 'Max');
	assert.equal(max.sessions, 2);
	assert.ok(Math.abs(max.seconds - 9240) < 5);
	assert.equal(max.active, true);
	assert.deepEqual([max.actions, max.sanctions, max.reports], [2, 2, 1]);
	assert.equal(staff.members.find(m => m.name === 'Léa').active, false);
	assert.equal(staff.messages.length, 1);

	assert.deepEqual([economy.cash, economy.bank, economy.crypto], [51_500, 159_250, 0]);
	assert.equal(economy.fortunes[0].citizenId, 'CCC');
	assert.equal(economy.fortunes[0].name, 'CCC');
	assert.deepEqual(economy.accounts, { total: 100_000, list: [
		{ id: 'police', amount: 100_000, creator: 'Max', frozen: false, savings: false },
		{ id: 'epargne', amount: 0, creator: 'Bob', frozen: true, savings: true },
	] });
	assert.deepEqual(economy.flows, [{ kind: 'deposit', count: 2, total: 150 }, { kind: 'withdraw', count: 1, total: 30 }]);
	assert.deepEqual(economy.phone, [{ kind: 'transfer', count: 2, total: 500 }]);
	assert.deepEqual({ ...economy.premium, crates: undefined, topItems: undefined }, { points: 150, loyalty: 7, purchases30: 3, gifts: { sent: 2, opened: 1 }, promos: 1, crates: undefined, topItems: undefined });
	assert.deepEqual(economy.premium.crates[0], { rarity: 'common', count: 2 });
	assert.deepEqual(economy.premium.topItems, [{ label: 'Casquette', count: 2, price: 300 }, { label: '?', count: 1, price: 0 }]);
	assert.deepEqual(economy.cryptoMarkets, [{ id: 'BTC', price: 51_000, supply: 21, status: 'open' }]);
});

test('fivem reports: only the core tables mirrored, no money: empty parts', async () => {
	const db = await openTestDb();
	await load(db, ['users', 'players']);
	const h = harness(db);
	const insights = await insightsReport({ ...h, canMoney: false });
	assert.equal(insights.attendance.mau, 0);
	assert.equal(insights.economy, null);
	assert.equal(insights.discord.accounts, 3);
	const server = await serverReport({ ...h, canMoney: false });
	assert.equal(server.economy, null);
	assert.equal(server.activity.totals.sessions, 0);
	assert.equal(server.jobs.find(j => j.name === 'police').onDuty, 1);
	assert.equal(server.world.counts.shops, 0);
});
