import { withoutSensitiveKeys } from './privacy.js';
import { num, real, int, text } from './util.js';

// Data sent by bl_telemetry (POST /v1/batch): events, console lines, game database snapshots.
// Port of handleBatch / handleEvent / handleDbSnapshot of bl-panel-api/server.js.

const json = v => JSON.stringify(v ?? {});

export function createIngest({ q, perf, raiseAlert, now }) {
	const anticheatCooldown = new Map();
	// Timestamps of the game are milliseconds; anything else is "now"
	const tsOf = v => {
		const n = Number(v);
		return Number.isFinite(n) && n > 0 ? n : now();
	};

	// Results of the game database reads (bl_telemetry/dbsync): only the last version of each is kept
	async function dbSnapshot(d) {
		const name = String(d.name ?? '');
		if (!/^[\w-]{1,60}$/.test(name) || !Array.isArray(d.rows) || !Array.isArray(d.columns)) return;
		const rows = d.rows.slice(0, 5000);
		const columns = d.columns.slice(0, 30).map(c => String(c).slice(0, 60));
		await q(`INSERT INTO tel_db_snapshots (name, label, kind, pos, ts, columns, rows) VALUES ($1, $2, $3, $4, now(), $5, $6)
			ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, pos = EXCLUDED.pos, ts = now(),
				columns = EXCLUDED.columns, rows = EXCLUDED.rows`,
		[name, String(d.label || name).slice(0, 120), String(d.kind || 'table').slice(0, 20), Number.isInteger(d.pos) ? d.pos : null,
			JSON.stringify(columns), JSON.stringify(rows)]);
		if (name === '_tables') {
			const list = rows.filter(Array.isArray);
			await q('INSERT INTO tel_db_table_stats (table_name, rows, bytes) SELECT * FROM unnest($1::text[], $2::bigint[], $3::bigint[])',
				[list.map(r => String(r[0]).slice(0, 120)), list.map(r => num(r[1])), list.map(r => num(r[2]))]);
		}
	}

	async function anticheat(ev, d, cid, name) {
		const reason = String(d.reason || 'détection').slice(0, 120);
		const key = `${cid || ev.src || '?'}:${reason}`;
		if (now() - (anticheatCooldown.get(key) || 0) <= 2 * 60_000) return;
		if (anticheatCooldown.size > 5000) anticheatCooldown.clear();
		anticheatCooldown.set(key, now());
		const details = d.details && typeof d.details === 'object'
			? Object.entries(d.details).map(([k, v]) => `${k} : ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')
			: '';
		await raiseAlert('anticheat', 'critical', `Anticheat : ${name || cid || `joueur ${ev.src ?? '?'}`} — ${reason}`,
			(cid ? `citizenid ${cid}\n` : '') + details, cid, d);
	}

	async function event(ev) {
		if (!ev || typeof ev !== 'object') return;
		const raw = ev.data && typeof ev.data === 'object' ? ev.data : {};
		// Volumous: not copied into tel_events
		if (ev.type === 'db_snapshot') return dbSnapshot(raw);
		// Performance: tables of their own
		if (await perf.ingest(ev.type, raw)) return;
		// The license is only used to join sessions (kept in tel_sessions); event data never keeps it
		const license = text(raw.license, 120);
		const d = withoutSensitiveKeys(raw);
		const cid = text(ev.citizenid ?? raw.citizenid, 60);
		const name = text(ev.player_name ?? raw.player_name, 120);
		const src = int(ev.src);
		const ts = tsOf(ev.ts);
		await q('INSERT INTO tel_events (ts, type, subtype, citizenid, player_name, src, data) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7)',
			[ts, text(ev.type, 60) || 'unknown', text(ev.subtype, 60), cid, name, src, json(d)]);
		if (ev.subtype === 'character_loaded' && (license || src !== null)) {
			// Joins the open session (created at connection, without character) to the loaded character
			await q(`UPDATE tel_sessions SET citizenid = $1, player_name = COALESCE($2, player_name)
				WHERE id = (SELECT id FROM tel_sessions WHERE end_ts IS NULL AND citizenid IS NULL
					AND (license = $3 OR ($3::text IS NULL AND src = $4)) ORDER BY start_ts DESC LIMIT 1)`,
			[cid, name, license, src]);
		}
		switch (ev.type) {
		case 'anticheat':
			await anticheat(ev, d, cid, name);
			break;
		case 'economy_snapshot':
			await q('INSERT INTO tel_economy_snapshots (ts, player_count, chars_total, total_cash, total_bank, total_crypto, society_total, data) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8)',
				[ts, int(d.player_count), int(d.chars_total), num(d.total_cash), num(d.total_bank), real(d.total_crypto), num(d.society_total), json(d.extra)]);
			break;
		case 'player_snapshot':
			if (!cid) break;
			await q('INSERT INTO tel_player_snapshots (ts, citizenid, name, job, job_grade, gang, cash, bank, crypto, online, data) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
				[ts, cid, name, text(d.job, 60), int(d.job_grade), text(d.gang, 60), num(d.cash), num(d.bank), real(d.crypto), Boolean(d.online), json(d.extra)]);
			break;
		case 'purchase':
			await q('INSERT INTO tel_purchases (ts, citizenid, player_name, shop, item, label, qty, unit_price, total, currency, data) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
				[ts, cid, name, text(d.shop, 120), text(d.item, 120), text(d.label, 120), int(d.qty) || 1, num(d.unit_price), num(d.total), text(d.currency, 30) || 'cash', json(d.extra)]);
			break;
		case 'death':
			await q('INSERT INTO tel_deaths (ts, citizenid, player_name, cause, killer_cid, killer_name, weapon, x, y, z, screenshot_url, data) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
				[ts, cid, name, text(d.cause, 120), text(d.killer_cid, 60), text(d.killer_name, 120), text(d.weapon, 120), real(d.x), real(d.y), real(d.z), text(d.screenshot_url, 1000), json(d.extra)]);
			break;
		case 'session_start':
			await q('INSERT INTO tel_sessions (citizenid, player_name, license, src, start_ts) VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0))',
				[cid, name, license, src, ts]);
			break;
		case 'session_end':
			await q(`UPDATE tel_sessions SET end_ts = to_timestamp($1/1000.0), drop_reason = $2,
						duration_min = EXTRACT(EPOCH FROM (to_timestamp($1/1000.0) - start_ts)) / 60.0
					WHERE id = (SELECT id FROM tel_sessions WHERE (citizenid = $3 OR license = $4) AND end_ts IS NULL ORDER BY start_ts DESC LIMIT 1)`,
			[ts, text(d.reason, 300), cid, license]);
			break;
		case 'vehicle_snapshot':
			await q('INSERT INTO tel_vehicles_owned (ts, citizenid, owner_name, plate, model, garage, state, data) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8)',
				[ts, cid, name, text(d.plate, 20), text(d.model, 60), text(d.garage, 60), int(d.state), json(d.extra)]);
			break;
		case 'admin_action':
			await q('INSERT INTO tel_admin_actions (ts, action, admin_name, target_cid, target_name, reason, duration, data) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8)',
				[ts, text(d.action, 60), text(d.admin_name, 120), text(d.target_cid, 60), text(d.target_name, 120), text(d.reason, 1000), text(d.duration, 60), json(d.extra)]);
			break;
		default:
			break;
		}
	}

	async function log(lg) {
		if (!lg || typeof lg !== 'object') return;
		const labels = lg.labels && typeof lg.labels === 'object' ? lg.labels : {};
		await q('INSERT INTO tel_server_logs (ts, channel, level, source, line, labels) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6)',
			[tsOf(lg.ts), text(labels.channel, 120), text(labels.level, 10), text(labels.source, 60) || 'fivem', String(lg.line ?? '').slice(0, 4000), json(labels)]);
	}

	return {
		event,
		async batch(body) {
			const events = Array.isArray(body?.events) ? body.events : [];
			const logs = Array.isArray(body?.logs) ? body.logs : [];
			for (const ev of events) await event(ev);
			for (const lg of logs) await log(lg);
			return { ok: true, events: events.length, logs: logs.length };
		},
	};
}
