// Mirror of the FiveM database, kept up to date by the bl_telemetry resource (server/mirror.lua):
// the panel reads the game's tables in the PostgreSQL schema "fivem" instead of connecting to MariaDB,
// which stays closed to the internet.
//
// The resource sends, per table, only what changed (new rows of a log, rows updated since the last pass,
// rows whose hash changed, or a whole small table whose checksum changed). Each table here keeps the name and
// the columns of the game; its PostgreSQL types come from the MariaDB types the resource reads in
// information_schema. Dates arrive as epoch milliseconds (oxmysql) and are stored as timestamptz.
import { ValidationError } from '../errors.js';

const NAME = /^[A-Za-z0-9_]{1,64}$/;
// count: only the number of rows travels (tables the panel only counts), no table here
const MODES = new Set(['append', 'updated', 'hash', 'replace', 'count']);
// Never stored, whatever the resource sends (it already leaves them out)
const FORBIDDEN_TABLES = new Set(['sky_phone_accounts']);
const FORBIDDEN_COLUMN = /(^|_)(ip|ips|tokens?|password|passwd|pass_hash|hwids?|email|mail|secret)$/i;
// Columns used to find a player or to sort by date: indexed on creation
const INDEXED_COLUMN = /^(cid|citizenid|userid|user_id|license|license2|discord|identifier|owner|owner_identifier|recipient_identifier|target_dbid|target_cid|caller_cid|issuer_cid|sender_citizenid|sender_license|target_license|issued_by_license|from_cid|to_cid|from_license|to_license|session_id|item_id|run_id|created_at|joined_at|started_at|issued_at|at)$/i;
// Rows of one INSERT: PostgreSQL takes at most 65535 parameters
const MAX_PARAMS = 30_000;

const quote = name => `"${name.replaceAll('"', '""')}"`;

// MariaDB column (information_schema DATA_TYPE + COLUMN_TYPE) -> PostgreSQL type
export function pgType({ type = '', columnType = '' }) {
	const t = String(type).toLowerCase();
	const full = String(columnType).toLowerCase();
	if (['datetime', 'timestamp'].includes(t)) return 'timestamptz';
	if (t === 'date') return 'date';
	if (t === 'time') return 'text';
	if (t === 'year') return 'integer';
	if (t === 'bigint') return full.includes('unsigned') ? 'numeric' : 'bigint';
	if (['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bit', 'bool', 'boolean'].includes(t)) return 'bigint';
	if (['decimal', 'numeric'].includes(t)) return 'numeric';
	if (['float', 'double', 'real'].includes(t)) return 'double precision';
	if (/blob|binary/.test(t)) return null;
	// char, varchar, text, json, enum, set…
	return 'text';
}

// Value sent by the resource -> value for the column
export function toColumn(value, type) {
	if (value === null || value === undefined) return null;
	if (type === 'timestamptz' || type === 'date') {
		if (typeof value === 'number') {
			if (!Number.isFinite(value) || value <= 0) return null;
			// Seconds for some resources, milliseconds for oxmysql
			const date = new Date(value < 1e11 ? value * 1000 : value);
			return type === 'date' ? date.toISOString().slice(0, 10) : date;
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return null;
		return type === 'date' ? date.toISOString().slice(0, 10) : date;
	}
	if (type === 'bigint' || type === 'integer' || type === 'numeric' || type === 'double precision') {
		if (typeof value === 'boolean') return value ? 1 : 0;
		if (typeof value === 'number') return Number.isFinite(value) ? value : null;
		const text = String(value).trim();
		if (text === '' || !Number.isFinite(Number(text))) return null;
		return type === 'bigint' || type === 'integer' ? text.split('.')[0] : text;
	}
	// text: oxmysql may hand JSON columns over already parsed; PostgreSQL refuses NUL
	const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
	return text.includes('\u0000') ? text.replaceAll('\u0000', '') : text;
}

function checkSchema(schema) {
	if (!schema || !Array.isArray(schema.columns) || !schema.columns.length) throw new ValidationError('schéma manquant');
	const columns = [];
	for (const c of schema.columns) {
		if (!NAME.test(String(c?.name ?? ''))) throw new ValidationError(`colonne invalide : ${c?.name}`);
		if (FORBIDDEN_COLUMN.test(c.name)) continue;
		const type = pgType(c);
		if (type) columns.push({ name: c.name, type });
	}
	const pk = (schema.pk ?? []).map(String);
	if (pk.some(k => !columns.some(c => c.name === k))) throw new ValidationError('clé primaire inconnue');
	return { columns, pk };
}

export function createFivemMirror({ db, logger = console, now = Date.now }) {
	// name -> { columns, pk, schemaHash, mode } of the tables already known
	let known = null;

	async function load() {
		if (known) return known;
		const rows = await db.prepare('SELECT name, columns, pk, schema_hash, mode FROM fivem_mirror_tables').all();
		known = new Map(rows.map(r => [r.name, { columns: r.columns, pk: r.pk ?? [], schemaHash: r.schema_hash, mode: r.mode }]));
		return known;
	}

	// The table of the game in the schema "fivem", created or changed to match what the resource sent
	async function ensureTable(name, schema, schemaHash, mode) {
		const { columns, pk } = checkSchema(schema);
		const current = (await load()).get(name);
		const sameColumns = current && current.pk.join() === pk.join()
			&& columns.every(c => current.columns.some(k => k.name === c.name && k.type === c.type));
		if (!current || !sameColumns) {
			// New table, or columns of another type: rebuilt from scratch (the resource sends everything again)
			await db.exec(`DROP TABLE IF EXISTS fivem.${quote(name)}`);
			const defs = columns.map(c => `${quote(c.name)} ${c.type}`);
			if (pk.length) defs.push(`PRIMARY KEY (${pk.map(quote).join(', ')})`);
			await db.exec(`CREATE TABLE fivem.${quote(name)} (${defs.join(', ')})`);
			for (const c of columns) {
				if (INDEXED_COLUMN.test(c.name) && !(pk.length === 1 && pk[0] === c.name)) {
					await db.exec(`CREATE INDEX ON fivem.${quote(name)} (${quote(c.name)})`);
				}
			}
		}
		else if (current.columns.length !== columns.length) {
			// Same columns plus new ones: added in place, rows kept
			for (const c of columns.filter(col => !current.columns.some(k => k.name === col.name))) {
				await db.exec(`ALTER TABLE fivem.${quote(name)} ADD COLUMN IF NOT EXISTS ${quote(c.name)} ${c.type}`);
			}
		}
		await db.raw(`INSERT INTO fivem_mirror_tables (name, columns, pk, schema_hash, mode, synced_at, cursor, checksum, row_count)
			VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, 0)
			ON CONFLICT (name) DO UPDATE SET columns = EXCLUDED.columns, pk = EXCLUDED.pk, schema_hash = EXCLUDED.schema_hash, mode = EXCLUDED.mode,
				cursor = CASE WHEN $7 THEN NULL ELSE fivem_mirror_tables.cursor END,
				checksum = CASE WHEN $7 THEN NULL ELSE fivem_mirror_tables.checksum END`,
		[name, JSON.stringify(columns), pk, schemaHash, mode, now(), !sameColumns]);
		const entry = { columns, pk, schemaHash, mode };
		known.set(name, entry);
		return { entry, rebuilt: !sameColumns };
	}

	// rows: arrays in the order of `fields` (names sent by the resource); unknown fields are dropped
	async function upsert(name, entry, fields, rows) {
		if (!rows.length) return 0;
		const index = entry.columns.map(c => fields.indexOf(c.name));
		const used = entry.columns.filter((_, i) => index[i] >= 0);
		const at = index.filter(i => i >= 0);
		if (!used.length) return 0;
		const missingPk = entry.pk.filter(k => !used.some(c => c.name === k));
		if (missingPk.length) throw new ValidationError(`clé primaire absente des lignes : ${missingPk.join(', ')}`);
		const conflict = entry.pk.length
			? ` ON CONFLICT (${entry.pk.map(quote).join(', ')}) DO ${used.length > entry.pk.length
				? `UPDATE SET ${used.filter(c => !entry.pk.includes(c.name)).map(c => `${quote(c.name)} = EXCLUDED.${quote(c.name)}`).join(', ')}`
				: 'NOTHING'}`
			: '';
		const perInsert = Math.max(1, Math.floor(MAX_PARAMS / used.length));
		// New rows only (an updated row keeps the count): xmax = 0 on a freshly inserted tuple
		let inserted = 0;
		for (let start = 0; start < rows.length; start += perInsert) {
			const chunk = rows.slice(start, start + perInsert);
			const params = [];
			const values = chunk.map((row) => {
				const cells = used.map((c, i) => {
					params.push(toColumn(row[at[i]], c.type));
					return `$${params.length}`;
				});
				return `(${cells.join(', ')})`;
			});
			const result = await db.raw(`WITH w AS (INSERT INTO fivem.${quote(name)} (${used.map(c => quote(c.name)).join(', ')}) VALUES ${values.join(', ')}${conflict}
				RETURNING (xmax = 0) AS fresh) SELECT COUNT(*) FILTER (WHERE fresh)::bigint AS n FROM w`, params);
			inserted += Number(result.rows[0]?.n ?? 0);
		}
		return inserted;
	}

	// keys: primary key values (one array per row) to remove
	async function remove(name, entry, keys) {
		if (!keys.length || !entry.pk.length) return 0;
		let removed = 0;
		const per = Math.max(1, Math.floor(MAX_PARAMS / entry.pk.length));
		for (let start = 0; start < keys.length; start += per) {
			const chunk = keys.slice(start, start + per);
			const params = [];
			const tuples = chunk.map((key) => {
				const cells = entry.pk.map((k, i) => {
					params.push(toColumn(Array.isArray(key) ? key[i] : key, entry.columns.find(c => c.name === k).type));
					return `$${params.length}`;
				});
				return `(${cells.join(', ')})`;
			});
			const result = await db.raw(`DELETE FROM fivem.${quote(name)} WHERE (${entry.pk.map(quote).join(', ')}) IN (${tuples.join(', ')})`, params);
			removed += result.rowCount ?? 0;
		}
		return removed;
	}

	// keep: every primary key the game still has: the others are removed (a full list, sent now and then)
	async function keepOnly(name, entry, keep) {
		if (!entry.pk.length) return 0;
		const types = entry.pk.map(k => entry.columns.find(c => c.name === k).type);
		const keys = keep.map(key => (Array.isArray(key) ? key : [key]).map((v, i) => toColumn(v, types[i])));
		const cast = entry.pk.map((k, i) => `(k->>${i})::${types[i]}`).join(', ');
		// One parameter for the whole list; NOT EXISTS stays fast on a big table (anti-join on the primary key)
		const result = await db.raw(`DELETE FROM fivem.${quote(name)} t WHERE NOT EXISTS (
			SELECT 1 FROM jsonb_array_elements($1::jsonb) k WHERE (${cast}) = (${entry.pk.map(k => `t.${quote(k)}`).join(', ')}))`, [JSON.stringify(keys)]);
		return result.rowCount ?? 0;
	}

	const service = {
		// Where the resource is for each table, to go on after a restart of the game or of the panel
		async state() {
			const rows = await db.prepare('SELECT name, schema_hash, mode, cursor, checksum, row_count, synced_at FROM fivem_mirror_tables ORDER BY name').all();
			return Object.fromEntries(rows.map(r => [r.name, { schemaHash: r.schema_hash, mode: r.mode, cursor: r.cursor, checksum: r.checksum, rows: Number(r.row_count), syncedAt: Number(r.synced_at) }]));
		},

		// One POST of the resource: several tables, each in its own transaction.
		// table: { name, mode, schemaHash, schema?, fields, rows, deletes?, keep?, replace?, cursor?, checksum? }
		// Answer per table: { ok } or { needSchema } (columns unknown here: send them) or { reset } (table rebuilt: send all).
		async apply(payload) {
			const tables = Array.isArray(payload?.tables) ? payload.tables : [];
			const out = {};
			for (const t of tables.slice(0, 50)) {
				const name = String(t?.name ?? '');
				if (!NAME.test(name) || FORBIDDEN_TABLES.has(name) || !MODES.has(t.mode)) {
					out[name || '?'] = { error: 'refusée' };
					continue;
				}
				try {
					if (t.mode === 'count') {
						const count = Math.max(0, Math.round(Number(t.count) || 0));
						if ((await load()).get(name)?.mode !== 'count') await db.exec(`DROP TABLE IF EXISTS fivem.${quote(name)}`);
						await db.raw(`INSERT INTO fivem_mirror_tables (name, columns, pk, schema_hash, mode, row_count, synced_at, full_at) VALUES ($1, '[]', '{}', 'count', 'count', $2, $3, $3)
							ON CONFLICT (name) DO UPDATE SET columns = '[]', pk = '{}', schema_hash = 'count', mode = 'count', row_count = $2, synced_at = $3, full_at = $3, cursor = NULL, checksum = NULL`, [name, count, now()]);
						known.set(name, { columns: [], pk: [], schemaHash: 'count', mode: 'count' });
						out[name] = { ok: true };
						continue;
					}
					out[name] = await db.transaction(async () => {
						let entry = (await load()).get(name);
						// A table only counted until now becomes a copied one: its columns are needed
						if (entry?.mode === 'count' && !t.schema) return { needSchema: true };
						let rebuilt = false;
						if (t.schema) ({ entry, rebuilt } = await ensureTable(name, t.schema, String(t.schemaHash ?? ''), t.mode));
						else if (!entry || entry.schemaHash !== String(t.schemaHash ?? '')) return { needSchema: true };
						// A rebuilt table is empty: it only takes a complete send (replace, or a pass from the start, from = null);
						// otherwise the resource forgets what it sent and starts this table over
						if (rebuilt && !t.replace && t.from !== null && t.from !== undefined) return { reset: true };
						const fields = Array.isArray(t.fields) ? t.fields.map(String) : [];
						const rows = Array.isArray(t.rows) ? t.rows.filter(Array.isArray) : [];
						if (t.replace) await db.exec(`TRUNCATE fivem.${quote(name)}`);
						const inserted = await upsert(name, entry, fields, rows);
						const removed = (Array.isArray(t.deletes) ? await remove(name, entry, t.deletes) : 0)
							+ (Array.isArray(t.keep) ? await keepOnly(name, entry, t.keep) : 0);
						const text = v => (v === undefined || v === null ? null : String(v));
						await db.raw(`UPDATE fivem_mirror_tables SET mode = $1, cursor = COALESCE($2, cursor), checksum = COALESCE($3, checksum),
							row_count = GREATEST(0, CASE WHEN $6 THEN 0 ELSE row_count END + $4), synced_at = $5,
							full_at = CASE WHEN $6 OR $7 THEN $5 ELSE full_at END WHERE name = $8`,
						[t.mode, text(t.cursor), text(t.checksum), inserted - removed, now(), Boolean(t.replace), Boolean(t.keep), name]);
						return { ok: true, inserted, removed, ...(rebuilt ? { reset: true } : {}) };
					})();
				}
				catch (error) {
					known = null;
					if (error instanceof ValidationError) {
						out[name] = { error: error.message };
						continue;
					}
					logger.warn?.(`FiveM mirror ${name}:`, error.message);
					out[name] = { error: 'interne' };
				}
			}
			return { tables: out };
		},

		// Tables copied in the mirror (features without their table are skipped); counted-only ones are not there
		async tables() {
			return new Set([...(await load())].filter(([, e]) => e.mode !== 'count').map(([name]) => name));
		},

		// Rows of a table only counted by the resource, null otherwise
		async counted(name) {
			const rows = await db.raw('SELECT row_count FROM fivem_mirror_tables WHERE name = $1 AND mode = \'count\'', [name]);
			return rows.rows[0] ? Number(rows.rows[0].row_count) : null;
		},

		// [{ name, type }] of a mirrored table (PostgreSQL types), null when it is not mirrored
		async columns(name) {
			return (await load()).get(name)?.columns ?? null;
		},

		// Freshness for the panel: last sync of all tables, and of each one
		async status() {
			const rows = await db.prepare('SELECT name, mode, row_count, synced_at, full_at FROM fivem_mirror_tables ORDER BY name').all();
			return {
				tables: rows.map(r => ({ name: r.name, mode: r.mode, rows: Number(r.row_count), syncedAt: Number(r.synced_at), fullAt: r.full_at ? Number(r.full_at) : null })),
				lastSync: rows.reduce((m, r) => Math.max(m, Number(r.synced_at)), 0) || null,
			};
		},

		// Forget the cached list of tables (tests, another process changed them)
		invalidate() {
			known = null;
		},
	};
	return service;
}
