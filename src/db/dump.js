// Backups of the MariaDB database: a gzipped SQL file, one statement per line (values are escaped, so no
// line break ever sits inside a statement). Made before every schema migration, restored on request.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import mysql from 'mysql2';

const BATCH_BYTES = 1024 * 1024;
const KEEP_BACKUPS = 10;
// Written by the app before migrating, read by launcher.js to roll back data with code
export const LAST_MIGRATION = 'last-migration.json';
// Written by launcher.js, read by the app at start: restore this backup before anything else
export const RESTORE_REQUEST = 'restore-request.json';

async function* dumpLines(db) {
	const connection = await db.pool.getConnection();
	try {
		// One consistent snapshot of every table
		await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
		await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
		const [tables] = await connection.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = \'BASE TABLE\' ORDER BY table_name');
		yield `-- Brothers Life database backup, ${new Date().toISOString()}`;
		yield 'SET FOREIGN_KEY_CHECKS = 0;';
		for (const { name } of tables) {
			const [[create]] = await connection.query(`SHOW CREATE TABLE \`${name}\``);
			yield `DROP TABLE IF EXISTS \`${name}\`;`;
			yield `${create['Create Table'].replace(/\r?\n\s*/g, ' ')};`;
			const [rows] = await connection.query(`SELECT * FROM \`${name}\``);
			if (!rows.length) continue;
			const columns = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
			let values = [];
			let size = 0;
			for (const row of rows) {
				const tuple = `(${Object.values(row).map(v => mysql.escape(v)).join(', ')})`;
				values.push(tuple);
				size += tuple.length;
				if (size >= BATCH_BYTES) {
					yield `INSERT INTO \`${name}\` (${columns}) VALUES ${values.join(', ')};`;
					values = [];
					size = 0;
				}
			}
			if (values.length) yield `INSERT INTO \`${name}\` (${columns}) VALUES ${values.join(', ')};`;
		}
		yield 'SET FOREIGN_KEY_CHECKS = 1;';
		await connection.query('COMMIT');
	}
	finally {
		connection.release();
	}
}

// Writes the backup and its description ({ at, schemaVersion, appVersion }) next to it; returns the file name
export async function dumpDatabase(db, dir, { label, schemaVersion = null, appVersion = null, now = Date.now } = {}) {
	fs.mkdirSync(dir, { recursive: true });
	const at = now();
	const file = `${label}-${new Date(at).toISOString().replace(/[:.]/g, '-')}.sql.gz`;
	const target = path.join(dir, file);
	const lines = Readable.from((async function* () {
		for await (const line of dumpLines(db)) yield `${line}\n`;
	})());
	await pipeline(lines, zlib.createGzip(), fs.createWriteStream(`${target}.part`));
	fs.renameSync(`${target}.part`, target);
	fs.writeFileSync(target.replace(/\.sql\.gz$/, '.json'), JSON.stringify({ at, schemaVersion, appVersion }, null, 2));
	prune(dir);
	return file;
}

// Replaces the whole database with a backup (every table of the backup is dropped and recreated)
export async function restoreDatabase(db, file) {
	const connection = await db.pool.getConnection();
	try {
		await connection.query('SET FOREIGN_KEY_CHECKS = 0');
		// Tables created by a newer schema are not in the backup: removed so the schema matches it again
		const [tables] = await connection.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = \'BASE TABLE\'');
		for (const { name } of tables) await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
		const input = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
		for await (const line of input) {
			if (!line.trim() || line.startsWith('--')) continue;
			await connection.query(line);
		}
		await connection.query('SET FOREIGN_KEY_CHECKS = 1');
	}
	finally {
		connection.release();
	}
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
