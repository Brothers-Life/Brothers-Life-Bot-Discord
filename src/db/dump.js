// Backups of the PostgreSQL database: a gzipped file of the schema version and the rows, one INSERT per line
// (values are written as E'…' literals, so no line break ever sits inside a statement). Made before every
// schema migration, restored on request: the schema comes back from the migrations, then the rows.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { listMigrations } from './migrate.js';

const BATCH_BYTES = 1024 * 1024;
const KEEP_BACKUPS = 10;
// Written by the app before migrating, read by launcher.js to roll back data with code
export const LAST_MIGRATION = 'last-migration.json';
// Written by launcher.js, read by the app at start: restore this backup before anything else
export const RESTORE_REQUEST = 'restore-request.json';

// A SQL literal on one line
export function literal(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'::bytea`;
	if (value instanceof Date) return literal(value.toISOString());
	if (typeof value === 'object') return literal(JSON.stringify(value));
	return `E'${String(value).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

// Tables in an order where every table comes after the ones it references
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

async function* dumpLines(db, schemaVersion) {
	const client = await db.pool.connect();
	try {
		// One consistent snapshot of every table
		await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
		yield `-- Brothers Life database backup, ${new Date().toISOString()}`;
		yield `-- schema:${schemaVersion ?? 0}`;
		for (const name of await tablesInOrder(client)) {
			if (name === 'schema_migrations') continue;
			const result = await client.query(`SELECT * FROM ${name}`);
			if (!result.rows.length) continue;
			const columns = result.fields.map(f => f.name);
			let values = [];
			let size = 0;
			for (const row of result.rows) {
				const tuple = `(${columns.map(c => literal(row[c])).join(', ')})`;
				values.push(tuple);
				size += tuple.length;
				if (size >= BATCH_BYTES) {
					yield `INSERT INTO ${name} (${columns.join(', ')}) VALUES ${values.join(', ')};`;
					values = [];
					size = 0;
				}
			}
			if (values.length) yield `INSERT INTO ${name} (${columns.join(', ')}) VALUES ${values.join(', ')};`;
		}
		await client.query('COMMIT');
	}
	finally {
		client.release();
	}
}

// Writes the backup and its description ({ at, schemaVersion, appVersion }) next to it; returns the file name
export async function dumpDatabase(db, dir, { label, schemaVersion = null, appVersion = null, now = Date.now } = {}) {
	fs.mkdirSync(dir, { recursive: true });
	const at = now();
	const file = `${label}-${new Date(at).toISOString().replace(/[:.]/g, '-')}.sql.gz`;
	const target = path.join(dir, file);
	const lines = Readable.from((async function* () {
		for await (const line of dumpLines(db, schemaVersion)) yield `${line}\n`;
	})());
	await pipeline(lines, zlib.createGzip(), fs.createWriteStream(`${target}.part`));
	fs.renameSync(`${target}.part`, target);
	fs.writeFileSync(target.replace(/\.sql\.gz$/, '.json'), JSON.stringify({ at, schemaVersion, appVersion }, null, 2));
	prune(dir);
	return file;
}

// Replaces the whole database with a backup: the schema is rebuilt by the migrations up to the backup's
// version, then its rows are loaded. Everything happens in one transaction.
export async function restoreDatabase(db, file, { migrationsDir } = {}) {
	const input = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
	const lines = input[Symbol.asyncIterator]();
	let version = null;
	const pending = [];
	// The header gives the schema version
	for (let i = 0; i < 3; i++) {
		const { value, done } = await lines.next();
		if (done) break;
		const match = /^-- schema:(\d+)/.exec(value);
		if (match) {
			version = Number(match[1]);
			break;
		}
		if (!value.startsWith('--')) pending.push(value);
	}
	if (version === null) throw new Error(`${path.basename(file)} is not a backup of this bot (no schema version).`);

	const client = await db.pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('DROP SCHEMA public CASCADE');
		await client.query('CREATE SCHEMA public');
		await client.query('CREATE TABLE schema_migrations (version INT PRIMARY KEY, applied_at BIGINT NOT NULL)');
		for (const migration of listMigrations(migrationsDir)) {
			if (migration.version > version) break;
			await client.query(fs.readFileSync(migration.file, 'utf8'));
			await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [migration.version, Date.now()]);
		}
		// Rows the migrations wrote (default profiles…) are replaced by the backup's
		for (const { name } of (await client.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = \'BASE TABLE\' AND table_name <> \'schema_migrations\'')).rows) {
			await client.query(`TRUNCATE ${name} CASCADE`);
		}
		for (const line of pending) await client.query(line);
		for await (const line of lines) {
			if (!line.trim() || line.startsWith('--')) continue;
			await client.query(line);
		}
		// Identity columns continue after the restored ids
		const identities = (await client.query('SELECT table_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = \'id\' AND is_identity = \'YES\'')).rows;
		for (const { name } of identities) {
			await client.query(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 0) + 1, false)`);
		}
		await client.query('COMMIT');
	}
	catch (error) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw error;
	}
	finally {
		client.release();
	}
	await db.refreshSchema?.();
}

export function listBackups(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter(f => f.endsWith('.sql.gz'))
		.map((file) => {
			let meta = {};
			try {
				meta = JSON.parse(fs.readFileSync(path.join(dir, file.replace(/\.sql\.gz$/, '.json')), 'utf8'));
			}
			catch {
				// a backup without its description is still listed
			}
			const stat = fs.statSync(path.join(dir, file));
			return { file, at: meta.at ?? stat.mtimeMs, schemaVersion: meta.schemaVersion ?? null, appVersion: meta.appVersion ?? null, size: stat.size };
		})
		.sort((a, b) => b.at - a.at);
}

function prune(dir) {
	for (const { file } of listBackups(dir).slice(KEEP_BACKUPS)) {
		fs.rmSync(path.join(dir, file), { force: true });
		fs.rmSync(path.join(dir, file.replace(/\.sql\.gz$/, '.json')), { force: true });
	}
}
