// One-time move of the data of v1.x (SQLite file data/bot.db) to the MariaDB database of v2.
// Also moves the files kept on disk (images sent from the panel, ticket transcripts, channel archives).
//
//   node scripts/migrate-sqlite.mjs prod                  (MariaDB settings of .env.prod or the environment)
//   node scripts/migrate-sqlite.mjs prod --from data/bot.db --data data [--force]
//
// The SQLite file is only read. The MariaDB database must be empty (a fresh v2 start is fine): --force
// empties it first. Stop the bot during the move.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import config from '../src/utils/config.js';
import { openDb, databaseOptions } from '../src/db/index.js';

// Schema of the last SQLite version (v1.11.0): older files must first be opened once by v1.11.0
const LAST_SQLITE_SCHEMA = 43;
const BATCH = 500;
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

const db = await openDb(databaseOptions(config), { logger: { info: () => undefined } });
const tablesOf = async () => (await db.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = \'BASE TABLE\' ORDER BY table_name')).map(r => r.name);
const sqliteTables = new Set(sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all().map(r => r.name));

// Only an empty target: never mix two networks
const filled = [];
for (const table of await tablesOf()) {
	if (SKIP.has(table) || table === 'restriction_profiles') continue;
	if ((await db.query(`SELECT 1 FROM \`${table}\` LIMIT 1`)).length) filled.push(table);
}
if (filled.length && !force) {
	fail(`La base MariaDB contient déjà des données (${filled.slice(0, 5).join(', ')}${filled.length > 5 ? '…' : ''}). Utilise une base vide, ou --force pour la vider d'abord.`);
}

// Values as MariaDB expects them for the column type
function convert(value, type) {
	if (value === null || value === undefined) return null;
	if (value instanceof Uint8Array) return Buffer.from(value);
	if (/int|double|decimal/.test(type)) {
		if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
		if (typeof value === 'string') return null;
		return value;
	}
	if (/char|text/.test(type) && typeof value !== 'string') return String(value);
	return value;
}

const connection = await db.pool.getConnection();
await connection.query('SET FOREIGN_KEY_CHECKS = 0');
const report = [];
for (const table of await tablesOf()) {
	if (SKIP.has(table)) continue;
	if (!sqliteTables.has(table)) {
		report.push([table, 0, 'absente de SQLite']);
		continue;
	}
	const targetColumns = await db.query('SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND extra NOT LIKE ? ORDER BY ordinal_position', table, '%GENERATED%');
	const sourceColumns = new Set(sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name));
	const columns = targetColumns.filter(c => sourceColumns.has(c.name));
	await connection.query(`DELETE FROM \`${table}\``);
	const select = sqlite.prepare(`SELECT ${columns.map(c => `"${c.name}"`).join(', ')} FROM "${table}"`);
	select.setReadBigInts(true);
	let batch = [];
	let count = 0;
	const flush = async () => {
		if (!batch.length) return;
		await connection.query(`INSERT INTO \`${table}\` (${columns.map(c => `\`${c.name}\``).join(', ')}) VALUES ?`, [batch]);
		count += batch.length;
		batch = [];
	};
	for (const row of select.iterate()) {
		batch.push(columns.map(c => convert(typeof row[c.name] === 'bigint' ? (Number.isSafeInteger(Number(row[c.name])) ? Number(row[c.name]) : String(row[c.name])) : row[c.name], c.type)));
		if (batch.length >= BATCH) await flush();
	}
	await flush();
	const expected = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
	report.push([table, count, count === expected ? '' : `attendu ${expected}`]);
}
await connection.query('SET FOREIGN_KEY_CHECKS = 1');

// Files kept on disk by v1 -> files table
const put = (id, kind, mime, data, gzip) => connection.query('REPLACE INTO files (id, kind, mime, size, gzip, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
	[id, kind, mime, data.length, gzip ? 1 : 0, gzip ? zlib.gzipSync(data) : data, Date.now()]);
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
let files = 0;
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
connection.release();

const width = Math.max(...report.map(([t]) => t.length));
for (const [table, count, note] of report) console.log(`${table.padEnd(width)}  ${String(count).padStart(7)}  ${note}`);
console.log(`\nFichiers repris (images, transcripts, archives) : ${files}`);
const problems = report.filter(([, , note]) => note.startsWith('attendu'));
await db.close();
if (problems.length) fail(`${problems.length} table(s) incomplète(s) : vérifie les lignes ci-dessus.`);
console.log('\n✔ Données reprises. Le fichier SQLite n’a pas été modifié : garde-le en sauvegarde.');
