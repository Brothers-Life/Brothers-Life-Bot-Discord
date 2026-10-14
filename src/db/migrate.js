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

const VERSION_TABLE = 'CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at BIGINT NOT NULL)';
// Same number for every process of the bot: pg_advisory_lock serialises their migrations
const LOCK_KEY = 'brl_migrate';

export async function schemaVersion(db) {
	await db.query(VERSION_TABLE);
	const row = (await db.query('SELECT MAX(version) AS version FROM schema_migrations'))[0];
	return row?.version ?? 0;
}

// The bot and the API both migrate on start: an advisory lock makes the second one wait for the first.
// Each migration runs in its own transaction (PostgreSQL rolls schema changes back too).
// beforeMigrate(fromVersion): called (inside the lock) when migrations are about to run on an existing database
export async function migrate(db, dir = MIGRATIONS_DIR, { beforeMigrate = null } = {}) {
	const client = await db.pool.connect();
	try {
		await client.query('SET lock_timeout = \'120s\'');
		await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
		try {
			const from = await schemaVersion(db);
			const latest = latestSchemaVersion(dir);
			if (from > latest) {
				throw new Error(`Database schema (v${from}) is newer than this version of the bot (v${latest}). Restore a compatible backup or install a newer version.`);
			}
			const pending = listMigrations(dir).filter(m => m.version > from);
			if (pending.length && from > 0) await beforeMigrate?.(from);
			for (const { version, file } of pending) {
				await client.query('BEGIN');
				try {
					await client.query(fs.readFileSync(file, 'utf8'));
					await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [version, Date.now()]);
					await client.query('COMMIT');
				}
				catch (error) {
					await client.query('ROLLBACK').catch(() => undefined);
					throw new Error(`Migration ${path.basename(file)} failed: ${error.message}`);
				}
			}
			return { from, to: await schemaVersion(db) };
		}
		finally {
			await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => undefined);
		}
	}
	finally {
		client.release();
	}
}
