// One-time copy of the old panel's telemetry database (bl-panel-api, tables events, sessions…) into the tel_*
// tables. Started by the API when TELEMETRY_IMPORT_FROM holds the old database URL; a table already holding rows
// is left alone, so a restart never copies twice. Player identifiers inside JSON data are dropped on the way
// (same rule as the ingestion). The old panel's accounts (panel_users) are not copied: ranks replace them.
import pg from 'pg';
import { withoutSensitiveKeys } from './privacy.js';

export const IMPORT_SETTING = 'telemetry.imported';
const TABLES = ['events', 'economy_snapshots', 'player_snapshots', 'purchases', 'deaths', 'sessions', 'vehicles_owned', 'admin_actions',
	'server_logs', 'perf_metrics', 'alerts', 'db_snapshots', 'db_table_stats', 'commands', 'perf_windows', 'perf_buckets', 'profiler_runs'];
const PAGE = 2000;
const BATCH = 500;

async function columnsOf(query, table) {
	const rows = await query(`SELECT column_name AS name, data_type AS type FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [table]);
	return new Map(rows.map(r => [r.name, r.type]));
}

function value(raw, type) {
	if (raw === null || raw === undefined) return null;
	if (type === 'json' || type === 'jsonb') return JSON.stringify(withoutSensitiveKeys(raw));
	return raw;
}

export async function importTelemetry({ db, url, settings, logger = console }) {
	if (await settings.get(IMPORT_SETTING, null)) return null;
	const source = new pg.Pool({ connectionString: url, max: 2 });
	const read = async (sql, values = []) => (await source.query(sql, values)).rows;
	const write = async (sql, values = []) => (await db.raw(sql, values)).rows;
	const counts = {};
	try {
		for (const table of TABLES) {
			const target = `tel_${table}`;
			const from = await columnsOf(read, table);
			if (!from.size) {
				counts[table] = 'absente';
				continue;
			}
			if ((await write(`SELECT 1 FROM ${target} LIMIT 1`)).length) {
				counts[table] = 'déjà remplie';
				continue;
			}
			const to = await columnsOf(write, target);
			const columns = [...from.keys()].filter(c => to.has(c));
			const list = columns.map(c => `"${c}"`).join(', ');
			const byId = columns.includes('id');
			let cursor = null;
			let copied = 0;
			for (;;) {
				const rows = byId
					? await read(`SELECT ${list} FROM ${table} ${cursor === null ? '' : 'WHERE id > $1'} ORDER BY id LIMIT ${PAGE}`, cursor === null ? [] : [cursor])
					: await read(`SELECT ctid::text AS __ctid, ${list} FROM ${table} ${cursor === null ? '' : 'WHERE ctid > $1::tid'} ORDER BY ctid LIMIT ${PAGE}`, cursor === null ? [] : [cursor]);
				if (!rows.length) break;
				for (let i = 0; i < rows.length; i += BATCH) {
					const chunk = rows.slice(i, i + BATCH);
					const values = [];
					const tuples = chunk.map((row) => {
						const marks = columns.map((c) => {
							values.push(value(row[c], to.get(c)));
							return `$${values.length}`;
						});
						return `(${marks.join(', ')})`;
					});
					await write(`INSERT INTO ${target} (${list}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`, values);
				}
				copied += rows.length;
				cursor = byId ? rows.at(-1).id : rows.at(-1).__ctid;
			}
			if (byId) await write(`SELECT setval(pg_get_serial_sequence('${target}', 'id'), COALESCE((SELECT MAX(id) FROM ${target}), 0) + 1, false)`);
			counts[table] = copied;
			logger.info(`Telemetry import: ${table} → ${target}, ${copied} rows`);
		}
		await settings.set(IMPORT_SETTING, { at: Date.now(), counts });
		return counts;
	}
	finally {
		await source.end().catch(() => undefined);
	}
}
