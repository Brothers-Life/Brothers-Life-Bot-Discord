import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Migrations are files named NNN_description.sql; NNN is the schema version they lead to
export function listMigrations(dir = MIGRATIONS_DIR) {
	return fs.readdirSync(dir)
		.map((file) => {
			const match = /^(\d+)_.+\.sql$/.exec(file);
			return match ? { version: Number(match[1]), file: path.join(dir, file) } : null;
		})
		.filter(Boolean)
		.sort((a, b) => a.version - b.version);
}

export function latestSchemaVersion(dir = MIGRATIONS_DIR) {
	const migrations = listMigrations(dir);
	return migrations.length ? migrations.at(-1).version : 0;
}

const VERSION_TABLE = 'CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at BIGINT NOT NULL) ENGINE=InnoDB';

export async function schemaVersion(db) {
	await db.query(VERSION_TABLE);
	const row = (await db.query('SELECT MAX(version) AS version FROM schema_migrations'))[0];
	return row?.version ?? 0;
}

// The bot and the API both migrate on start: a named lock makes the second one wait for the first.
// MariaDB commits schema changes right away, so a failing migration can leave it half applied:
// the launcher takes a backup before every update.
export async function migrate(db, dir = MIGRATIONS_DIR) {
	const connection = await db.pool.getConnection();
	try {
		const [[lock]] = await connection.query('SELECT GET_LOCK(?, 120) AS ok', [`brl_migrate_${db.options.database}`]);
		if (!lock?.ok) throw new Error('Another process is migrating the database (lock not obtained after 2 minutes).');
		try {
			const from = await schemaVersion(db);
			const latest = latestSchemaVersion(dir);
			if (from > latest) {
				throw new Error(`Database schema (v${from}) is newer than this version of the bot (v${latest}). Restore a compatible backup or install a newer version.`);
			}
			for (const { version, file } of listMigrations(dir)) {
				if (version <= from) continue;
				await db.exec(fs.readFileSync(file, 'utf8'));
				await db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, Date.now());
			}
			return { from, to: await schemaVersion(db) };
		}
		finally {
			await connection.query('SELECT RELEASE_LOCK(?)', [`brl_migrate_${db.options.database}`]);
		}
	}
	finally {
		connection.release();
	}
}
