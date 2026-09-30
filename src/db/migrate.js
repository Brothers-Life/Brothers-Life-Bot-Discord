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

export function schemaVersion(db) {
	return db.pragma('user_version', { simple: true });
}

// Each migration runs in its own transaction: a failing migration leaves the database untouched
export function migrate(db, dir = MIGRATIONS_DIR) {
	const from = schemaVersion(db);
	const latest = latestSchemaVersion(dir);

	if (from > latest) {
		throw new Error(`Database schema (v${from}) is newer than this version of the bot (v${latest}). Restore a compatible backup or install a newer version.`);
	}

	for (const { version, file } of listMigrations(dir)) {
		if (version <= from) continue;
		const sql = fs.readFileSync(file, 'utf8');
		db.transaction(() => {
			db.exec(sql);
			db.pragma(`user_version = ${version}`);
		})();
	}

	return { from, to: schemaVersion(db) };
}
