import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';

export { Database };

export function openDb(file, { migrationsDir } = {}) {
	if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

	const db = new Database(file);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	db.migration = migrate(db, migrationsDir);
	return db;
}

// Consistent online copy, safe while the bot is writing
export async function backupDb(db, destFile) {
	fs.mkdirSync(path.dirname(destFile), { recursive: true });
	await db.backup(destFile);
}

// Small JSON key/value store on top of the settings table
export function createSettings(db) {
	const get = db.prepare('SELECT value FROM settings WHERE key = ?');
	const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
	const del = db.prepare('DELETE FROM settings WHERE key = ?');

	return {
		get(key, fallback = null) {
			const row = get.get(key);
			return row ? JSON.parse(row.value) : fallback;
		},
		set(key, value) {
			if (value === null || value === undefined) del.run(key);
			else set.run(key, JSON.stringify(value));
		},
	};
}
