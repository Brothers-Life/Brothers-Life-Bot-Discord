import { ValidationError } from '../errors.js';
import { clampInt } from './util.js';
import { isSensitiveKey } from './privacy.js';

// Read views of the telemetry, port of the `api` object of bl-panel-api/server.js and of features.js.
// Each view takes plain parameters and returns rows as PostgreSQL gives them (the service scrubs them).

// Events left out of the journals (snapshots, and the kinds shown from their own tables)
const NOISE = '(\'player_snapshot\',\'vehicle_snapshot\',\'economy_snapshot\',\'db_snapshot\',\'death\',\'purchase\',\'session_start\',\'session_end\')';

// Tables of the game that log staff actions (followed by bl_telemetry/live.lua)
const STAFF_TABLES = ['admindash_audit_log', 'admindash_sanctions', 'admindash_role_actions', 'admindash_staff_sessions',
	'admindash_blip_logs', 'admindash_staff_loans', 'teleport_admin_logs', 'garage_admin_logs', 'job_admin_logs', 'shop_admin_logs',
	'shop_admin', 'mapeditor_audit', 'dj_audit', 'tv_admin_logs', 'qbx_vehicle_admin_probe', 'bl_safezones_audit', 'mdt_audit'];
const ACTOR_KEYS = ['admin_name', 'admin', 'staff', 'staff_name', 'author', 'by', 'executor', 'moderator', 'bannedby', 'banned_by',
	'created_by', 'actor', 'admin_label', 'officer', 'officer_name', 'user', 'username'];
const ACTION_KEYS = ['action', 'type', 'event', 'command', 'category', 'kind', 'log_type', 'what'];
const TARGET_KEYS = ['target_name', 'target', 'target_label', 'player_name', 'player', 'charname', 'name'];
const CATEGORIES = [
	['unban', /unban|revok|annul/i], ['ban', /ban(?!k)/i], ['kick', /kick|expuls/i], ['warn', /warn|avert/i],
	['tp', /\btp|teleport|goto|bring|tpm|tp_|_tp/i], ['soin', /heal|revive|soin|reanim/i], ['spectate', /spectat|\bspec/i],
	['noclip', /noclip|invis/i], ['freeze', /freeze|gel/i], ['prison', /jail|prison/i],
	['argent / objets', /give|additem|add_item|setmoney|money|bank_|cash|item/i], ['véhicule', /vehic|car\b|garage|spawn|plate|plaque/i],
	['annonce', /announce|annonce|direct_message|message/i], ['service', /duty|session|service|login|logout/i],
	['serveur', /shutdown|restart|whitelist/i], ['accès panel', /panel_access/i],
];
const HITCH = /(\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/i;

// Bucket size (s) giving ~600 points per curve instead of thousands
const bucketSec = (hours, min = 15) => Math.max(min, Math.round(hours * 3600 / 600));
const hoursOf = (hours, def) => clampInt(hours, def, 1, 24 * 90);
// LIKE pattern matching the text as typed
const like = term => `%${String(term).replace(/[\\%_]/g, c => `\\${c}`)}%`;

function cidOf(value) {
	const cid = String(value ?? '').trim().slice(0, 60);
	if (!cid) throw new ValidationError('Indique le citizenid du joueur.');
	return cid;
}

function dateOf(value) {
	const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
	if (Number.isNaN(date.getTime())) throw new ValidationError('Date invalide.');
	return date;
}

// A game database snapshot without the columns that hold identifiers (rows are positional)
function withoutSensitiveColumns(snapshot) {
	const columns = Array.isArray(snapshot.columns) ? snapshot.columns : [];
	const keep = columns.map((c, i) => (isSensitiveKey(c) ? -1 : i)).filter(i => i >= 0);
	if (keep.length === columns.length) return snapshot;
	const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
	return { ...snapshot, columns: keep.map(i => columns[i]), rows: rows.map(r => (Array.isArray(r) ? keep.map(i => r[i]) : r)) };
}

export function createViews({ q, getConfig, timezone, now }) {
	const pick = (d, keys) => {
		for (const k of keys) {
			const v = d?.[k];
			if (v != null && v !== '' && typeof v !== 'object') return String(v);
		}
		return null;
	};
	const categorize = (text) => (CATEGORIES.find(([, re]) => re.test(text)) || ['autre'])[0];

	async function overview({ hours } = {}) {
		const h = hoursOf(hours, 24);
		const b = bucketSec(h);
		const [online, tick, counts, errors, up] = await Promise.all([
			q(`SELECT floor(extract(epoch FROM ts) / ${b}) * ${b} * 1000 AS t, ROUND(AVG(value)::numeric, 1) AS value FROM tel_perf_metrics
				 WHERE metric='players_online' AND ts > now() - interval '${h} hours' GROUP BY 1 ORDER BY 1`),
			q(`SELECT floor(t / 1000 / ${b}) * ${b} * 1000 AS t, thread, AVG(ms) AS ms FROM (WITH s AS (SELECT ts, thread, value v FROM tel_perf_metrics WHERE metric='tick_sum_sec' AND ts > now() - interval '${h} hours'),
							 c AS (SELECT ts, thread, value v FROM tel_perf_metrics WHERE metric='tick_count' AND ts > now() - interval '${h} hours')
				 SELECT extract(epoch FROM s.ts)*1000 AS t, s.thread,
								(s.v - lag(s.v) OVER (PARTITION BY s.thread ORDER BY s.ts)) / NULLIF(c.v - lag(c.v) OVER (PARTITION BY c.thread ORDER BY c.ts),0) * 1000 AS ms
				 FROM s JOIN c ON c.ts = s.ts AND c.thread = s.thread) x WHERE ms IS NOT NULL GROUP BY 1, 2 ORDER BY 1`),
			q(`SELECT
					(SELECT value FROM tel_perf_metrics WHERE metric='players_online' ORDER BY ts DESC LIMIT 1) AS online,
					(SELECT value FROM tel_perf_metrics WHERE metric='players_max' ORDER BY ts DESC LIMIT 1) AS max,
					(SELECT value FROM tel_perf_metrics WHERE metric='server_up' ORDER BY ts DESC LIMIT 1) AS up,
					(SELECT chars_total FROM tel_economy_snapshots ORDER BY ts DESC LIMIT 1) AS chars,
					(SELECT COUNT(*) FROM tel_events WHERE ts > now() - interval '24 hours') AS events24,
					(SELECT COUNT(*) FROM tel_server_logs WHERE ts > now() - interval '24 hours') AS logs24,
					(SELECT COUNT(*) FROM tel_sessions WHERE start_ts > now() - interval '24 hours') AS sessions24,
					(SELECT COUNT(*) FROM tel_deaths WHERE ts > now() - interval '24 hours') AS deaths24`),
			q('SELECT ts, channel, line FROM tel_server_logs WHERE level=\'error\' ORDER BY ts DESC LIMIT 50'),
			q(`SELECT extract(epoch FROM ts)*1000 AS t, value FROM tel_perf_metrics WHERE metric='server_up' AND ts > now() - interval '${h} hours' ORDER BY ts`),
		]);
		return { online: online.rows, tick: tick.rows, counts: counts.rows[0] || {}, errors: errors.rows, up: up.rows };
	}
	async function economy({ hours } = {}) {
		const h = hoursOf(hours, 24 * 7);
		const [mass, top, shops, purchases, flows, flowsByHour, latest, extra] = await Promise.all([
			q(`SELECT floor(extract(epoch FROM ts) / ${bucketSec(h, 60)}) * ${bucketSec(h, 60)} * 1000 AS t, AVG(total_cash) AS total_cash, AVG(total_bank) AS total_bank
				 FROM tel_economy_snapshots WHERE ts > now() - interval '${h} hours' GROUP BY 1 ORDER BY 1`),
			q('SELECT name, citizenid, cash, bank, cash+bank AS total FROM (SELECT DISTINCT ON (citizenid) citizenid, name, cash, bank FROM tel_player_snapshots ORDER BY citizenid, ts DESC) t ORDER BY total DESC NULLS LAST LIMIT 20'),
			q(`SELECT COALESCE(shop,'?') AS shop, SUM(total) AS ca, COUNT(*) AS n FROM tel_purchases WHERE ts > now() - interval '${h} hours' GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 15`),
			q('SELECT ts, player_name, citizenid, shop, COALESCE(label,item) AS article, qty, total, currency FROM tel_purchases ORDER BY ts DESC LIMIT 100'),
			q('SELECT ts, data->>\'kind\' AS kind, data->>\'from_cid\' AS from_cid, data->>\'to_cid\' AS to_cid, (data->>\'amount\')::numeric AS amount, data->>\'note\' AS note FROM tel_events WHERE subtype=\'bank_flow\' ORDER BY ts DESC LIMIT 100'),
			q(`SELECT date_trunc('hour', ts) AS t, COALESCE(data->>'kind','?') AS kind, SUM((data->>'amount')::numeric) AS total FROM tel_events WHERE subtype='bank_flow' AND ts > now() - interval '${h} hours' GROUP BY 1,2 ORDER BY 1`),
			q('SELECT ts, player_count, chars_total, total_cash, total_bank, total_crypto, society_total FROM tel_economy_snapshots ORDER BY ts DESC LIMIT 1'),
			q(`SELECT extract(epoch FROM date_trunc('hour', ts))*1000 AS t, AVG(total_crypto) AS crypto, AVG(society_total) AS society FROM tel_economy_snapshots WHERE ts > now() - interval '${h} hours' GROUP BY 1 ORDER BY 1`),
		]);
		return { mass: mass.rows, top: top.rows, shops: shops.rows, purchases: purchases.rows, flows: flows.rows, flowsByHour: flowsByHour.rows, latest: latest.rows[0] || {}, extra: extra.rows };
	}
	async function players({ q: term } = {}) {
		const s = String(term ?? '').trim().slice(0, 60);
		const r = await q(`SELECT DISTINCT ON (citizenid) citizenid, name, job, gang, cash, bank, online, ts
											 FROM tel_player_snapshots ${s ? 'WHERE name ILIKE $1 OR citizenid ILIKE $1' : ''}
											 ORDER BY citizenid, ts DESC LIMIT 300`, s ? [like(s)] : []);
		return { players: r.rows.sort((a, b) => ((b.cash || 0) + (b.bank || 0)) - ((a.cash || 0) + (a.bank || 0))) };
	}
	async function player({ cid: id } = {}) {
		const cid = cidOf(id);
		const [ident, money, deaths, purchases, sessions, vehicles, inventory, events, flows, stats] = await Promise.all([
			q('SELECT name, citizenid, job, job_grade, gang, cash, bank, crypto, online, ts FROM tel_player_snapshots WHERE citizenid=$1 ORDER BY ts DESC LIMIT 1', [cid]),
			q('SELECT extract(epoch FROM ts)*1000 AS t, cash, bank FROM tel_player_snapshots WHERE citizenid=$1 AND ts > now() - interval \'30 days\' ORDER BY ts', [cid]),
			q('SELECT ts, cause, killer_name, killer_cid, weapon, x, y, z, screenshot_url FROM tel_deaths WHERE citizenid=$1 ORDER BY ts DESC LIMIT 50', [cid]),
			q('SELECT ts, shop, COALESCE(label,item) AS article, qty, total FROM tel_purchases WHERE citizenid=$1 ORDER BY ts DESC LIMIT 50', [cid]),
			q('SELECT start_ts, end_ts, ROUND(duration_min::numeric,1) AS minutes, drop_reason FROM tel_sessions WHERE citizenid=$1 ORDER BY start_ts DESC LIMIT 50', [cid]),
			q('SELECT DISTINCT ON (plate) plate, model, garage, state FROM tel_vehicles_owned WHERE citizenid=$1 ORDER BY plate, ts DESC', [cid]),
			q('SELECT it->>\'n\' AS name, (it->>\'c\')::int AS count FROM (SELECT data AS d FROM tel_player_snapshots WHERE citizenid=$1 AND data->\'inventory\' IS NOT NULL ORDER BY ts DESC LIMIT 1) s, jsonb_array_elements(s.d->\'inventory\') it ORDER BY 2 DESC', [cid]),
			q('SELECT ts, type, subtype, data FROM tel_events WHERE citizenid=$1 ORDER BY ts DESC LIMIT 100', [cid]),
			q('SELECT ts, data->>\'kind\' AS kind, data->>\'from_cid\' AS from_cid, data->>\'to_cid\' AS to_cid, (data->>\'amount\')::numeric AS amount, data->>\'note\' AS note FROM tel_events WHERE subtype=\'bank_flow\' AND (data->>\'from_cid\'=$1 OR data->>\'to_cid\'=$1) ORDER BY ts DESC LIMIT 100', [cid]),
			q(`SELECT (SELECT COALESCE(SUM(duration_min),0)/60.0 FROM tel_sessions WHERE citizenid=$1) AS hours,
								(SELECT COUNT(*) FROM tel_deaths WHERE citizenid=$1) AS deaths,
								(SELECT COUNT(*) FROM tel_purchases WHERE citizenid=$1) AS purchases`, [cid]),
		]);
		return { ident: ident.rows[0] || null, money: money.rows, deaths: deaths.rows, purchases: purchases.rows, sessions: sessions.rows, vehicles: vehicles.rows, inventory: inventory.rows, events: events.rows, flows: flows.rows, stats: stats.rows[0] || {} };
	}
	async function logs({ q: term, level: lvl } = {}) {
		const s = String(term ?? '').slice(0, 100);
		const level = String(lvl ?? '').slice(0, 10);
		const args = [];
		const cond = [];
		if (s) {
			args.push(like(s));
			cond.push(`line ILIKE $${args.length}`);
		}
		if (level) {
			args.push(level);
			cond.push(`level = $${args.length}`);
		}
		const [rows, chat, volume] = await Promise.all([
			q(`SELECT ts, channel, level, line FROM tel_server_logs ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY ts DESC LIMIT 400`, args),
			q('SELECT ts, player_name, citizenid, subtype, data->>\'message\' AS message FROM tel_events WHERE subtype IN (\'chat\',\'command\') ORDER BY ts DESC LIMIT 150'),
			q('SELECT date_trunc(\'minute\', ts) AS t, COALESCE(level,\'info\') AS level, COUNT(*) AS n FROM tel_server_logs WHERE ts > now() - interval \'6 hours\' GROUP BY 1,2 ORDER BY 1'),
		]);
		return { logs: rows.rows, chat: chat.rows, volume: volume.rows };
	}
	async function admin() {
		const [actions, connections, explosions, deathsByHour] = await Promise.all([
			q('SELECT ts, data->>\'action\' AS action, data->>\'admin_name\' AS staff, data->>\'target_name\' AS target, data->>\'reason\' AS reason, data->>\'duration\' AS duration FROM tel_events WHERE type=\'admin_action\' ORDER BY ts DESC LIMIT 150'),
			q('SELECT start_ts, end_ts, player_name, citizenid, drop_reason FROM tel_sessions ORDER BY start_ts DESC LIMIT 150'),
			q('SELECT ts, player_name, citizenid, data->>\'explosion_type\' AS type FROM tel_events WHERE subtype=\'explosion\' ORDER BY ts DESC LIMIT 100'),
			q('SELECT date_trunc(\'hour\', ts) AS t, COUNT(*) AS n FROM tel_deaths WHERE ts > now() - interval \'7 days\' GROUP BY 1 ORDER BY 1'),
		]);
		return { actions: actions.rows, connections: connections.rows, explosions: explosions.rows, deathsByHour: deathsByHour.rows };
	}
	async function db() {
		const [snaps, tables, day, week] = await Promise.all([
			q('SELECT name, label, kind, pos, ts, columns, rows FROM tel_db_snapshots ORDER BY pos NULLS LAST, name'),
			q('SELECT ts, rows FROM tel_db_snapshots WHERE name = \'_tables\''),
			q('SELECT DISTINCT ON (table_name) table_name, rows FROM tel_db_table_stats WHERE ts <= now() - interval \'24 hours\' ORDER BY table_name, ts DESC'),
			q('SELECT DISTINCT ON (table_name) table_name, rows FROM tel_db_table_stats WHERE ts <= now() - interval \'7 days\' ORDER BY table_name, ts DESC'),
		]);
		const before = (stats) => Object.fromEntries(stats.rows.map((r) => [r.table_name, Number(r.rows)]));
		const d1 = before(day);
		const d7 = before(week);
		const t = tables.rows[0];
		return {
			tablesTs: t?.ts || null,
			tables: (Array.isArray(t?.rows) ? t.rows : []).filter(Array.isArray).map(([name, rows, bytes]) => ({ name, rows: Number(rows) || 0, bytes: Number(bytes) || 0, rows24h: d1[name] ?? null, rows7d: d7[name] ?? null })),
			snapshots: snaps.rows.filter((r) => !r.name.startsWith('_') && !['hidden', 'internal'].includes(r.kind)).map(withoutSensitiveColumns),
		};
	}
	async function deathmap({ hours } = {}) {
		const h = hoursOf(hours, 24 * 7);
		const [points, shots] = await Promise.all([
			q(`SELECT ts, citizenid, player_name, cause, killer_cid, killer_name, weapon, x, y, z, screenshot_url
				 FROM tel_deaths WHERE x IS NOT NULL AND y IS NOT NULL AND ts > now() - interval '${h} hours' ORDER BY ts DESC LIMIT 5000`),
			q('SELECT ts, citizenid, player_name, cause, killer_name, weapon, screenshot_url FROM tel_deaths WHERE screenshot_url IS NOT NULL AND screenshot_url <> \'\' ORDER BY ts DESC LIMIT 40'),
		]);
		return { points: points.rows, screenshots: shots.rows };
	}
	async function anomalies({ hours, min: minimum } = {}) {
		const h = hoursOf(hours, 24);
		const min = Math.max(0, parseInt(minimum ?? (await getConfig()).alerts.moneyJump, 10) || 0);
		const r = await q(`
			WITH s AS (
				SELECT citizenid, name, ts, COALESCE(cash,0)+COALESCE(bank,0) AS total,
							 lag(COALESCE(cash,0)+COALESCE(bank,0)) OVER (PARTITION BY citizenid ORDER BY ts) AS prev,
							 first_value(COALESCE(cash,0)+COALESCE(bank,0)) OVER (PARTITION BY citizenid ORDER BY ts) AS first_total,
							 row_number() OVER (PARTITION BY citizenid ORDER BY ts DESC) AS rn
				FROM tel_player_snapshots WHERE ts > now() - interval '${h} hours'),
			j AS (SELECT DISTINCT ON (citizenid) citizenid, name, ts, prev, total, total - prev AS jump
						FROM s WHERE prev IS NOT NULL ORDER BY citizenid, total - prev DESC),
			n AS (SELECT citizenid, first_total, total AS last_total FROM s WHERE rn = 1)
			SELECT j.citizenid, j.name, j.ts, j.prev, j.total, j.jump, n.first_total, n.last_total, n.last_total - n.first_total AS net
			FROM j JOIN n USING (citizenid) WHERE j.jump >= $1 ORDER BY j.jump DESC LIMIT 100`, [min]);
		return { min, hours: h, players: r.rows };
	}
	async function alerts() {
		const cfg = await getConfig();
		const [recent, byKind] = await Promise.all([
			q('SELECT id, ts, kind, severity, title, detail, citizenid, notified FROM tel_alerts ORDER BY ts DESC LIMIT 200'),
			q('SELECT kind, COUNT(*)::int AS n FROM tel_alerts WHERE ts > now() - interval \'24 hours\' GROUP BY 1 ORDER BY 2 DESC'),
		]);
		return {
			alerts: recent.rows, byKind: byKind.rows,
			config: { logCategory: 'telemetry', ...cfg.alerts },
		};
	}
	async function insights({ days } = {}) {
		const d = clampInt(days, 7, 1, 90);
		const tz = await timezone();
		const [heat, jobs, gangs, killers, weapons, causes, peak, uptime] = await Promise.all([
			q(`SELECT extract(isodow FROM ts AT TIME ZONE '${tz}')::int AS dow, extract(hour FROM ts AT TIME ZONE '${tz}')::int AS hour,
								ROUND(AVG(value)::numeric, 1) AS avg, MAX(value) AS max
				 FROM tel_perf_metrics WHERE metric='players_online' AND ts > now() - interval '${d} days' GROUP BY 1,2`),
			q(`SELECT COALESCE(NULLIF(job,''),'aucun') AS name, COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE online))::int AS online
				 FROM (SELECT DISTINCT ON (citizenid) job, online FROM tel_player_snapshots ORDER BY citizenid, ts DESC) t GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
			q(`SELECT gang AS name, COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE online))::int AS online
				 FROM (SELECT DISTINCT ON (citizenid) gang, online FROM tel_player_snapshots ORDER BY citizenid, ts DESC) t
				 WHERE gang IS NOT NULL AND gang NOT IN ('', 'none') GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
			q(`SELECT killer_name AS name, MAX(killer_cid) AS citizenid, COUNT(*)::int AS n FROM tel_deaths
				 WHERE killer_name IS NOT NULL AND killer_name <> '' AND ts > now() - interval '${d} days' GROUP BY 1 ORDER BY 3 DESC LIMIT 10`),
			q(`SELECT weapon AS name, COUNT(*)::int AS n FROM tel_deaths WHERE weapon IS NOT NULL AND weapon <> '' AND ts > now() - interval '${d} days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
			q(`SELECT COALESCE(NULLIF(cause,''),'?') AS name, COUNT(*)::int AS n FROM tel_deaths WHERE ts > now() - interval '${d} days' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
			q(`SELECT value AS n, ts FROM tel_perf_metrics WHERE metric='players_online' AND ts > now() - interval '${d} days' ORDER BY value DESC, ts DESC LIMIT 1`),
			q(`SELECT ROUND((100 * AVG(value) FILTER (WHERE ts > now() - interval '24 hours'))::numeric, 2) AS day,
								ROUND((100 * AVG(value))::numeric, 2) AS period
				 FROM tel_perf_metrics WHERE metric='server_up' AND ts > now() - interval '${d} days'`),
		]);
		return { days: d, tz, heat: heat.rows, jobs: jobs.rows, gangs: gangs.rows, killers: killers.rows, weapons: weapons.rows, causes: causes.rows, peak: peak.rows[0] || null, uptime: uptime.rows[0] || {} };
	}
	async function timeline({ cid: id, before: until, limit: max } = {}) {
		const cid = cidOf(id);
		const before = until ? dateOf(until) : new Date(now() + 60e3);
		const limit = clampInt(max, 200, 20, 500);
		const r = await q(`
			SELECT ts, kind, data FROM (
				SELECT start_ts AS ts, 'session_start' AS kind, '{}'::jsonb AS data FROM tel_sessions WHERE citizenid = $1
				UNION ALL SELECT end_ts, 'session_end', jsonb_build_object('reason', drop_reason, 'minutes', ROUND(duration_min::numeric)) FROM tel_sessions WHERE citizenid = $1 AND end_ts IS NOT NULL
				UNION ALL SELECT ts, 'death', jsonb_build_object('cause', cause, 'killer', killer_name, 'killer_cid', killer_cid, 'weapon', weapon, 'x', x, 'y', y, 'screenshot_url', screenshot_url) FROM tel_deaths WHERE citizenid = $1
				UNION ALL SELECT ts, 'kill', jsonb_build_object('victim', player_name, 'victim_cid', citizenid, 'weapon', weapon) FROM tel_deaths WHERE killer_cid = $1
				UNION ALL SELECT ts, 'purchase', jsonb_build_object('shop', shop, 'article', COALESCE(label, item), 'qty', qty, 'total', total) FROM tel_purchases WHERE citizenid = $1
				UNION ALL SELECT ts, 'bank_flow', data FROM tel_events WHERE subtype = 'bank_flow' AND (data->>'from_cid' = $1 OR data->>'to_cid' = $1)
				UNION ALL SELECT ts, COALESCE(subtype, type), data FROM tel_events
					WHERE citizenid = $1 AND type NOT IN ${NOISE} AND COALESCE(subtype, '') <> 'bank_flow'
				UNION ALL SELECT ts, 'alert', jsonb_build_object('title', title, 'kind', kind, 'severity', severity) FROM tel_alerts WHERE citizenid = $1
			) t WHERE ts IS NOT NULL AND ts < $2 ORDER BY ts DESC LIMIT $3`, [cid, before, limit]);
		return { cid, items: r.rows };
	}

	async function linked({ cid: id } = {}) {
		const cid = cidOf(id);
		const [map, sess] = await Promise.all([
			q('SELECT rows FROM tel_db_snapshots WHERE name = \'license_map\''),
			q(`SELECT DISTINCT s2.citizenid, s2.player_name FROM tel_sessions s1 JOIN tel_sessions s2 ON s2.license = s1.license
				 WHERE s1.citizenid = $1 AND s1.license IS NOT NULL AND s2.citizenid IS NOT NULL AND s2.citizenid <> $1`, [cid]),
		]);
		const out = new Map();
		const rows = Array.isArray(map.rows[0]?.rows) ? map.rows[0].rows : [];
		const mine = rows.find((r) => Array.isArray(r) && r[0] === cid);
		if (mine) {
			for (const r of rows) if (Array.isArray(r) && r[1] === mine[1] && r[0] !== cid) out.set(r[0], { citizenid: r[0], name: r[2], via: 'même licence' });
		}
		for (const s of sess.rows) if (!out.has(s.citizenid)) out.set(s.citizenid, { citizenid: s.citizenid, name: s.player_name, via: 'connexions' });
		return { cid, known: !!mine, players: [...out.values()] };
	}

	// withLogs: false leaves out the console and the chat (people without telemetry.logs)
	async function search({ q: query, days: period, withLogs = true } = {}) {
		const term = String(query ?? '').trim().slice(0, 100);
		if (term.length < 2) throw new ValidationError('Tape au moins 2 caractères pour chercher.');
		const days = clampInt(period, 7, 1, 90);
		const pattern = like(term);
		const none = { rows: [] };
		const [found, logLines, chatLines, events] = await Promise.all([
			q(`SELECT DISTINCT ON (citizenid) citizenid, name, job, gang, online, ts FROM tel_player_snapshots
				 WHERE name ILIKE $1 OR citizenid ILIKE $1 ORDER BY citizenid, ts DESC LIMIT 30`, [pattern]),
			withLogs ? q('SELECT ts, channel, level, line FROM tel_server_logs WHERE ts > now() - make_interval(days => $2) AND line ILIKE $1 ORDER BY ts DESC LIMIT 150', [pattern, days]) : none,
			withLogs ? q(`SELECT ts, citizenid, player_name, subtype, data->>'message' AS message FROM tel_events
				 WHERE subtype IN ('chat', 'command') AND ts > now() - make_interval(days => $2) AND (data->>'message' ILIKE $1 OR player_name ILIKE $1)
				 ORDER BY ts DESC LIMIT 100`, [pattern, days]) : none,
			q(`SELECT ts, type, subtype, citizenid, player_name, data FROM tel_events
				 WHERE ts > now() - make_interval(days => $2) AND type NOT IN ${NOISE} AND COALESCE(subtype, '') NOT IN ('chat', 'command')
					 AND (data::text ILIKE $1 OR player_name ILIKE $1 OR citizenid ILIKE $1)
				 ORDER BY ts DESC LIMIT 150`, [pattern, days]),
		]);
		return { q: term, days, players: found.rows, logs: logLines.rows, chat: chatLines.rows, events: events.rows };
	}

	async function trace({ cid: id, ts, min } = {}) {
		const cid = cidOf(id);
		const at = ts === undefined || ts === null || ts === '' ? new Date(now()) : dateOf(ts);
		const win = clampInt(min, 30, 5, 720);
		const from = new Date(at.getTime() - win * 60e3);
		const to = new Date(at.getTime() + 5 * 60e3);
		const [before, after, flows, purchases, events, staffActions] = await Promise.all([
			q('SELECT ts, cash, bank FROM tel_player_snapshots WHERE citizenid = $1 AND ts < $2 ORDER BY ts DESC LIMIT 1', [cid, at]),
			q('SELECT ts, cash, bank FROM tel_player_snapshots WHERE citizenid = $1 AND ts >= $2 ORDER BY ts LIMIT 1', [cid, at]),
			q('SELECT ts, data FROM tel_events WHERE subtype = \'bank_flow\' AND ts BETWEEN $2 AND $3 AND (data->>\'from_cid\' = $1 OR data->>\'to_cid\' = $1) ORDER BY ts', [cid, from, to]),
			q('SELECT ts, shop, COALESCE(label, item) AS article, qty, total FROM tel_purchases WHERE citizenid = $1 AND ts BETWEEN $2 AND $3 ORDER BY ts', [cid, from, to]),
			q(`SELECT ts, type, subtype, data FROM tel_events WHERE citizenid = $1 AND ts BETWEEN $2 AND $3 AND type NOT IN ${NOISE}
					 AND COALESCE(subtype, '') NOT IN ('bank_flow', 'chat') ORDER BY ts`, [cid, from, to]),
			q('SELECT ts, data FROM tel_events WHERE type = \'admin_action\' AND ts BETWEEN $2 AND $3 AND data::text ILIKE $1 ORDER BY ts', ['%' + cid + '%', from, to]),
		]);
		return { cid, at, windowMin: win, before: before.rows[0] || null, after: after.rows[0] || null, flows: flows.rows, purchases: purchases.rows, events: events.rows, staff: staffActions.rows };
	}

	async function inflation({ days: period } = {}) {
		const d = clampInt(period, 30, 7, 365);
		const TZ = await timezone();
		const [days, flows, median] = await Promise.all([
			q(`SELECT day, cash, bank, chars, players FROM (
					 SELECT DISTINCT ON (date_trunc('day', ts AT TIME ZONE '${TZ}')) date_trunc('day', ts AT TIME ZONE '${TZ}') AS day,
									total_cash AS cash, total_bank AS bank, chars_total AS chars, player_count AS players
					 FROM tel_economy_snapshots WHERE ts > now() - make_interval(days => $1)
					 ORDER BY date_trunc('day', ts AT TIME ZONE '${TZ}'), ts DESC) t ORDER BY day`, [d]),
			q(`SELECT date_trunc('day', ts AT TIME ZONE '${TZ}') AS day, COALESCE(data->>'kind', '?') AS kind,
								SUM((data->>'amount')::numeric) AS total, COUNT(*)::int AS n
				 FROM tel_events WHERE subtype = 'bank_flow' AND ts > now() - make_interval(days => $1) GROUP BY 1, 2 ORDER BY 1`, [d]),
			q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY w) AS median, AVG(w) AS mean, COUNT(*)::int AS n FROM (
					 SELECT DISTINCT ON (citizenid) COALESCE(cash, 0) + COALESCE(bank, 0) AS w FROM tel_player_snapshots ORDER BY citizenid, ts DESC) t`),
		]);
		return { days: d, daily: days.rows, flows: flows.rows, wealth: median.rows[0] || {} };
	}

	async function scripts() {
		const [counts, lastErr, hitches, res, starts] = await Promise.all([
			q(`SELECT COALESCE(channel, '?') AS channel, level, COUNT(*)::int AS n, MAX(ts) AS last FROM tel_server_logs
				 WHERE ts > now() - interval '24 hours' AND level IN ('error', 'warn') AND COALESCE(line, '') NOT ILIKE '%hitch warning%'
				 GROUP BY 1, 2`),
			q(`SELECT DISTINCT ON (channel) channel, ts, line FROM tel_server_logs WHERE ts > now() - interval '24 hours' AND level = 'error'
				 ORDER BY channel, ts DESC`),
			q('SELECT ts, line FROM tel_server_logs WHERE ts > now() - interval \'24 hours\' AND line ILIKE \'%hitch warning%\' ORDER BY ts DESC LIMIT 5000'),
			q('SELECT ts, rows FROM tel_db_snapshots WHERE name = \'_resources\''),
			q('SELECT ts FROM tel_events WHERE subtype = \'server_start\' AND ts > now() - interval \'30 days\' ORDER BY ts DESC LIMIT 50'),
		]);
		const by = new Map();
		for (const r of counts.rows) {
			const e = by.get(r.channel) || { channel: r.channel, errors: 0, warns: 0, last: null, lastError: null };
			if (r.level === 'error') e.errors = r.n; else e.warns = r.n;
			if (!e.last || r.last > e.last) e.last = r.last;
			by.set(r.channel, e);
		}
		for (const r of lastErr.rows) {
			const e = by.get(r.channel);
			if (e) e.lastError = { ts: r.ts, line: String(r.line || '').slice(0, 400) };
		}
		const hours = new Map();
		for (const h of hitches.rows) {
			const ms = Number((HITCH.exec(h.line || '') || [])[1]) || 0;
			const k = new Date(h.ts);
			k.setMinutes(0, 0, 0);
			const b = hours.get(+k) || { t: +k, n: 0, max: 0, total: 0 };
			b.n++;
			b.max = Math.max(b.max, ms);
			b.total += ms;
			hours.set(+k, b);
		}
		return {
			resources: [...by.values()].sort((a, b) => b.errors - a.errors || b.warns - a.warns),
			hitches: { count: hitches.rows.length, hours: [...hours.values()].sort((a, b) => a.t - b.t), worst: Math.max(0, ...[...hours.values()].map((b) => b.max)) },
			list: res.rows[0] ? { ts: res.rows[0].ts, rows: res.rows[0].rows } : null,
			restarts: starts.rows.map((r) => r.ts),
		};
	}

	// --- staff actions: txAdmin, admin tables of the game, announcements of the panel
	async function staff({ days: period, staff: fStaff = null, cat: fCat = null, q: query = '' } = {}) {
		const days = clampInt(period, 7, 1, 90);
		const [ev, cmds] = await Promise.all([
			q(`SELECT ts, type, subtype, citizenid, player_name, data FROM tel_events
				 WHERE ts > now() - make_interval(days => $1)
					 AND (type = 'admin_action' OR (type = 'game_log' AND subtype = ANY($2)))
				 ORDER BY ts DESC LIMIT 3000`, [days, STAFF_TABLES]),
			q('SELECT ts, author, payload FROM tel_commands WHERE ts > now() - make_interval(days => $1) ORDER BY ts DESC LIMIT 200', [days]),
		]);
		const items = [];
		for (const r of ev.rows) {
			const d = r.data || {};
			const isTx = r.type === 'admin_action';
			const action = pick(d, ACTION_KEYS) || (isTx ? '?' : r.subtype);
			const source = isTx ? (d.source || (String(action).startsWith('bank_') ? 'banque' : 'txAdmin')) : r.subtype;
			items.push({
				ts: r.ts, source, action,
				category: r.subtype === 'teleport_admin_logs' ? 'tp' : categorize(`${r.subtype || ''} ${action}`),
				actor: pick(d, ACTOR_KEYS) || (isTx ? null : r.player_name) || '?',
				target: pick(d, TARGET_KEYS) || (isTx ? null : null),
				targetCid: d.target_cid || (isTx ? r.citizenid : r.citizenid) || null,
				reason: pick(d, ['reason', 'raison', 'details', 'message', 'note', 'description']),
				duration: pick(d, ['duration', 'durée', 'expire']),
			});
		}
		for (const c of cmds.rows) items.push({ ts: c.ts, source: 'panel', action: 'annonce', category: 'annonce', actor: c.author || '?', target: 'tous les joueurs', reason: c.payload?.message || null });
		items.sort((a, b) => new Date(b.ts) - new Date(a.ts));

		// Rankings over the whole period, then the filters for the list
		const byActor = new Map();
		const byCat = {};
		const byDay = {};
		for (const it of items) {
			const a = byActor.get(it.actor) || { actor: it.actor, total: 0, cats: {}, last: it.ts, sources: new Set() };
			a.total++;
			a.cats[it.category] = (a.cats[it.category] || 0) + 1;
			a.sources.add(it.source);
			if (new Date(it.ts) > new Date(a.last)) a.last = it.ts;
			byActor.set(it.actor, a);
			byCat[it.category] = (byCat[it.category] || 0) + 1;
			const day = new Date(it.ts).toISOString().slice(0, 10);
			byDay[day] = (byDay[day] || 0) + 1;
		}
		const fq = String(query ?? '').toLowerCase().slice(0, 80);
		const list = items.filter((it) => (!fStaff || it.actor === fStaff) && (!fCat || it.category === fCat)
			&& (!fq || [it.actor, it.action, it.target, it.reason, it.source].some((v) => String(v || '').toLowerCase().includes(fq))));
		return {
			days, total: items.length, truncated: ev.rows.length >= 3000,
			staff: [...byActor.values()].map((a) => ({ ...a, sources: [...a.sources] })).sort((a, b) => b.total - a.total),
			categories: byCat, days_activity: byDay, items: list.slice(0, 500),
		};
	}


	return { overview, economy, players, player, logs, admin, db, deathmap, anomalies, alerts, insights, timeline, linked, search, trace, inflation, scripts, staff };
}
