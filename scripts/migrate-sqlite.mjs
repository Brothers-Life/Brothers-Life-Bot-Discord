// One-time move of the data of v1.x (SQLite file data/bot.db) to the PostgreSQL database of v2.
// Also moves the files kept on disk (images sent from the panel, ticket transcripts, channel archives).
//
//   node scripts/migrate-sqlite.mjs prod                  (PostgreSQL settings of .env.prod or the environment)
//   node scripts/migrate-sqlite.mjs prod --from data/bot.db --data data [--force]
//
// The SQLite file is only read. The PostgreSQL database must be empty (a fresh v2 start is fine): --force
// empties it first. Stop the bot during the move. Everything is written in one transaction: on an error,
// the database stays as it was.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import config from '../src/utils/config.js';
import { openDb, databaseOptions } from '../src/db/index.js';

// Schema of the last SQLite version (v1.11.0): older files must first be opened once by v1.11.0
const LAST_SQLITE_SCHEMA = 43;
// PostgreSQL takes at most 65535 parameters per query
const MAX_PARAMS = 30_000;
const SKIP = new Set(['schema_migrations', 'files']);

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const dataDir = path.resolve(option('--data', config.DATA_DIR));
const source = path.resolve(option('--from', path.join(dataDir, 'bot.db')));
const force = args.includes('--force');

function fail(message) {
	console.error(`\n✖ ${message}`);
	process.exit(1);
}

if (!fs.existsSync(source)) fail(`Fichier SQLite introuvable : ${source} (option --from).`);
const sqlite = new DatabaseSync(source, { readOnly: true });
sqlite.exec('PRAGMA query_only = ON');
const version = sqlite.prepare('PRAGMA user_version').get().user_version;
if (version !== LAST_SQLITE_SCHEMA) {
	fail(`Ce fichier est au schéma v${version}. Lance d'abord une fois la v1.11.0 (schéma v${LAST_SQLITE_SCHEMA}) dessus, puis recommence.`);
}

const db = await openDb(databaseOptions(config), { logger: { info: () => undefined, warn: console.warn } });
const quote = name => `"${String(name).replace(/"/g, '""')}"`;
const sqliteTables = new Set(sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all().map(r => r.name));

// Tables in an order where every table comes after the ones it references (foreign keys stay checked)
async function tablesInOrder(client) {
	const tables = (await client.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = \'BASE TABLE\' ORDER BY table_name')).rows.map(r => r.name);
	const deps = (await client.query(`
		SELECT tc.table_name AS child, ccu.table_name AS parent
		FROM information_schema.table_constraints tc
		JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
	`)).rows;
	const parents = new Map(tables.map(t => [t, new Set()]));
	for (const { child, parent } of deps) if (child !== parent) parents.get(child)?.add(parent);
	const ordered = [];
	const placed = new Set();
	while (ordered.length < tables.length) {
		const next = tables.filter(t => !placed.has(t) && [...parents.get(t)].every(p => placed.has(p)));
		// A cycle (none today): the rest in name order
		for (const t of next.length ? next : tables.filter(x => !placed.has(x))) {
			ordered.push(t);
			placed.add(t);
		}
	}
	return ordered;
}

// Values as PostgreSQL expects them for the column type (information_schema data_type)
function convert(value, type) {
	if (value === null || value === undefined) return null;
	if (typeof value === 'bigint') value = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
	if (value instanceof Uint8Array && !Buffer.isBuffer(value)) value = Buffer.from(value);
	if (type === 'bytea') return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
	if (/^(bigint|integer|smallint)$/.test(type)) {
		if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
		if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
		if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Math.round(Number(value));
		return null;
	}
	if (/^(double precision|real|numeric)$/.test(type)) {
		const n = Number(value);
		return typeof value === 'string' && value.trim() === '' ? null : (Number.isFinite(n) ? n : null);
	}
	// text: PostgreSQL refuses the NUL character
	const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
	return text.includes('\u0000') ? text.replaceAll('\u0000', '') : text;
}

const client = await db.pool.connect();
const report = [];
let files = 0;
try {
	const tables = await tablesInOrder(client);

	// Only an empty target: never mix two networks (restriction_profiles is filled by the migrations)
	const filled = [];
	// Only the tables of the v1: the FiveM telemetry (tel_*, copied from the old panel) is left as it is
	for (const table of tables) {
		if (SKIP.has(table) || table === 'restriction_profiles' || !sqliteTables.has(table)) continue;
		if ((await client.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rows.length) filled.push(table);
	}
	if (filled.length && !force) {
		fail(`La base PostgreSQL contient déjà des données (${filled.slice(0, 5).join(', ')}${filled.length > 5 ? '…' : ''}). Utilise une base vide, ou --force pour la vider d'abord.`);
	}

	await client.query('BEGIN');
	const targets = tables.filter(t => !SKIP.has(t));
	const emptied = targets.filter(t => sqliteTables.has(t));
	// Settings of the telemetry (taken over from the old panel) survive the copy of the v1 settings
	const kept = emptied.includes('settings') ? (await client.query('SELECT key, value FROM settings WHERE key LIKE \'telemetry.%\'')).rows : [];
	if (emptied.length) await client.query(`TRUNCATE ${emptied.map(quote).join(', ')} RESTART IDENTITY`);

	for (const table of targets) {
		if (!sqliteTables.has(table)) {
			report.push([table, 0, table.startsWith('tel_') ? 'gardée (télémétrie, pas dans la v1)' : 'absente de SQLite']);
			continue;
		}
		const targetColumns = (await client.query(`
			SELECT column_name AS name, data_type AS type, is_identity AS identity
			FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER'
			ORDER BY ordinal_position
		`, [table])).rows;
		const sourceColumns = new Set(sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c => c.name));
		const columns = targetColumns.filter(c => sourceColumns.has(c.name));
		const expected = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get().n;
		if (!columns.length) {
			report.push([table, 0, expected ? `attendu ${expected} (aucune colonne commune)` : '']);
			continue;
		}
		const overriding = columns.some(c => c.identity === 'YES') ? ' OVERRIDING SYSTEM VALUE' : '';
		const head = `INSERT INTO ${quote(table)} (${columns.map(c => quote(c.name)).join(', ')})${overriding} VALUES `;
		const insert = (rows) => {
			const params = [];
			const tuples = rows.map(row => `(${row.map((value) => {
				params.push(value);
				return `$${params.length}`;
			}).join(', ')})`);
			return client.query(head + tuples.join(', '), params);
		};
		const perBatch = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
		const select = sqlite.prepare(`SELECT ${columns.map(c => quote(c.name)).join(', ')} FROM ${quote(table)}`);
		select.setReadBigInts(true);
		let batch = [];
		let count = 0;
		let orphans = 0;
		const flush = async () => {
			if (!batch.length) return;
			await client.query('SAVEPOINT batch');
			try {
				await insert(batch);
				count += batch.length;
			}
			catch (error) {
				// 23503: rows pointing to a row that no longer exists (SQLite did not always check): left out
				if (error.code !== '23503') throw error;
				await client.query('ROLLBACK TO SAVEPOINT batch');
				for (const row of batch) {
					await client.query('SAVEPOINT one');
					try {
						await insert([row]);
						count++;
					}
					catch (rowError) {
						if (rowError.code !== '23503') throw rowError;
						await client.query('ROLLBACK TO SAVEPOINT one');
						orphans++;
					}
				}
			}
			await client.query('RELEASE SAVEPOINT batch');
			batch = [];
		};
		for (const row of select.iterate()) {
			batch.push(columns.map(c => convert(row[c.name], c.type)));
			if (batch.length >= perBatch) await flush();
		}
		await flush();
		const notes = [];
		if (count + orphans !== expected) notes.push(`attendu ${expected}`);
		if (orphans) notes.push(`${orphans} ligne(s) orpheline(s) ignorée(s)`);
		report.push([table, count, notes.join(', ')]);
	}

	// Identity ids continue after the copied ones
	const identities = (await client.query('SELECT table_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = \'id\' AND is_identity = \'YES\'')).rows.map(r => r.name);
	for (const table of identities) {
		await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${quote(table)}), 0) + 1, false)`, [quote(table)]);
	}

	// Files kept on disk by v1 -> files table
	const put = (id, kind, mime, data, gzip) => client.query(`
		INSERT INTO files (id, kind, mime, size, gzip, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, mime = EXCLUDED.mime, size = EXCLUDED.size, gzip = EXCLUDED.gzip, data = EXCLUDED.data, created_at = EXCLUDED.created_at
	`, [id, kind, mime, data.length, gzip ? 1 : 0, gzip ? zlib.gzipSync(data) : data, Date.now()]);
	const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
	const uploads = path.join(dataDir, 'uploads');
	if (fs.existsSync(uploads)) {
		for (const name of fs.readdirSync(uploads).filter(n => /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(n))) {
			await put(`upload:${name}`, 'upload', MIME[name.split('.').pop()], fs.readFileSync(path.join(uploads, name)), false);
			files++;
		}
	}
	const transcripts = path.join(dataDir, 'transcripts');
	if (fs.existsSync(transcripts)) {
		for (const name of fs.readdirSync(transcripts).filter(n => /^ticket-\d+\.html$/.test(n))) {
			await put(`transcript:${name.replace(/\.html$/, '')}`, 'transcript', 'text/html', fs.readFileSync(path.join(transcripts, name)), true);
			files++;
		}
	}
	const archives = path.join(dataDir, 'archives');
	if (fs.existsSync(archives)) {
		for (const name of fs.readdirSync(archives).filter(n => n.endsWith('.html'))) {
			await put(`archive:${name}`, 'archive', 'text/html', fs.readFileSync(path.join(archives, name)), true);
			files++;
		}
	}
	// YouTube cookies of the music (read back by the bot at start, see src/bot/client.js)
	const cookies = path.join(dataDir, 'youtube-cookies.txt');
	if (fs.existsSync(cookies)) {
		await put('secret:youtube-cookies', 'secret', 'text/plain', fs.readFileSync(cookies), true);
		files++;
	}
	for (const { key, value } of kept) {
		await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
	}
	await client.query('COMMIT');
}
catch (error) {
	await client.query('ROLLBACK').catch(() => undefined);
	client.release();
	await db.close();
	fail(`Reprise annulée, la base n'a pas été modifiée : ${error.message}`);
}
client.release();

const width = Math.max(...report.map(([t]) => t.length));
for (const [table, count, note] of report) console.log(`${table.padEnd(width)}  ${String(count).padStart(7)}  ${note}`);
console.log(`\nFichiers repris (images, transcripts, archives) : ${files}`);
const problems = report.filter(([, , note]) => note.startsWith('attendu'));
await db.close();
if (problems.length) fail(`${problems.length} table(s) incomplète(s) : vérifie les lignes ci-dessus.`);
console.log('\n✔ Données reprises. Le fichier SQLite n’a pas été modifié : garde-le en sauvegarde.');
