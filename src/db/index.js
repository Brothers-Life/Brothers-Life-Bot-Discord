import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { compile, bind } from './sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate.js';
import { dumpDatabase, restoreDatabase, LAST_MIGRATION, RESTORE_REQUEST } from './dump.js';

// BIGINT (counters, timestamps in ms, ids) and NUMERIC (SUM, AVG) come back as JS numbers, like before.
// Discord ids are TEXT columns: never concerned.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
	const n = Number(value);
	return Number.isSafeInteger(n) ? n : value;
});
pg.types.setTypeParser(pg.types.builtins.NUMERIC, value => Number(value));

const INSERT_INTO = /^\s*INSERT\s+INTO\s+"?(\w+)"?/i;

// postgres://user:password@host:5432/database (DATABASE_URL, given by Railway), or the DB_* variables
export function databaseOptions(config) {
	if (config.DATABASE_URL) {
		const url = new URL(config.DATABASE_URL);
		return {
			connectionString: config.DATABASE_URL,
			host: url.hostname,
			port: Number(url.port) || 5432,
			user: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
			database: decodeURIComponent(url.pathname.slice(1)),
		};
	}
	return { host: config.DB_HOST, port: Number(config.DB_PORT) || 5432, user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME };
}

function poolConfig(options, max) {
	const { connectionString, host, port, user, password, database } = options;
	return {
		...(connectionString ? { connectionString } : { host, port, user, password, database }),
		max,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 15_000,
		// A query never waits forever (locks, network)
		statement_timeout: 60_000,
		application_name: 'brothers-life',
	};
}

// The database shared by the bot and the API (PostgreSQL). The interface keeps the shape the code was
// written for (prepare().get/all/run, transaction()), every call returning a promise.
// run() gives { changes, lastInsertRowid }: an INSERT into a table with an identity `id` returns it.
// backupDir: where the database is saved before each migration (and where launcher.js asks for a restore)
export async function openDb(options, { migrationsDir, migrate: runMigrations = true, connectionLimit = 10, backupDir = null, appVersion = null, logger = console } = {}) {
	const pool = new pg.Pool(poolConfig(options, connectionLimit));
	// An idle client losing its connection must not crash the process
	pool.on('error', error => logger.warn?.('Database connection lost:', error.message));

	// The client of the transaction running in this async context, if any
	const transactions = new AsyncLocalStorage();
	const listeners = new Set();
	// Tables whose INSERT gives back the new id (identity column "id")
	let identityTables = new Set();

	function runner() {
		const tx = transactions.getStore();
		return tx && !tx.done ? tx.client : pool;
	}

	async function query(text, values) {
		const result = await runner().query({ text, values });
		for (const listener of listeners) listener(text);
		return result;
	}

	function withReturning(text) {
		const match = INSERT_INTO.exec(text);
		if (!match || !identityTables.has(match[1].toLowerCase()) || /\bRETURNING\b/i.test(text)) return text;
		return `${text.trimEnd().replace(/;$/, '')} RETURNING id`;
	}

	const db = {
		pool,
		options,
		prepare(sql) {
			const compiled = compile(sql);
			let returning = null;
			return {
				sql,
				async get(...args) {
					return (await query(compiled.sql, bind(compiled, args))).rows[0];
				},
				async all(...args) {
					return (await query(compiled.sql, bind(compiled, args))).rows;
				},
				async run(...args) {
					returning ??= withReturning(compiled.sql);
					const result = await query(returning, bind(compiled, args));
					return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows?.[0]?.id ?? null };
				},
			};
		},
		// One-off query with positional or named parameters: the rows
		async query(sql, ...args) {
			const compiled = compile(sql);
			return (await query(compiled.sql, bind(compiled, args))).rows;
		},
		// PostgreSQL as is: $1, $2… placeholders and an array of values; gives { rows, rowCount }.
		// For SQL written for PostgreSQL directly (telemetry views), inside or outside a transaction.
		async raw(text, values = []) {
			return query(text, values);
		},
		// Several statements at once (schema changes, imports), never with user values
		async exec(sql) {
			await runner().query(sql);
		},
		// db.transaction(fn) returns an async function running fn in one transaction; the queries made
		// by fn (and whatever it awaits) use the transaction's client. A nested call joins the outer one.
		transaction(fn) {
			return async (...args) => {
				const current = transactions.getStore();
				if (current && !current.done) return fn(...args);
				const client = await pool.connect();
				const tx = { client, done: false };
				try {
					await client.query('BEGIN');
					const result = await transactions.run(tx, () => fn(...args));
					await client.query('COMMIT');
					return result;
				}
				catch (error) {
					await client.query('ROLLBACK').catch(() => undefined);
					throw error;
				}
				finally {
					// Work started inside the transaction but still running afterwards goes back to the pool
					tx.done = true;
					client.release();
				}
			};
		},
		get inTransaction() {
			const tx = transactions.getStore();
			return Boolean(tx && !tx.done);
		},
		// Tests: tells which tables were written to
		onQuery(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		// After a schema change: which tables give back their new id
		async refreshSchema() {
			const rows = (await pool.query('SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = \'id\' AND is_identity = \'YES\'')).rows;
			identityTables = new Set(rows.map(r => r.table_name));
		},
		async close() {
			await pool.end();
		},
	};

	if (backupDir) await applyRestoreRequest(db, backupDir, migrationsDir, logger);
	const beforeMigrate = backupDir
		? async (from) => {
			const file = await dumpDatabase(db, backupDir, { label: `avant-migration-v${from}`, schemaVersion: from, appVersion });
			fs.writeFileSync(path.join(backupDir, LAST_MIGRATION), JSON.stringify({ file, at: Date.now(), schemaVersion: from }));
			logger.info(`Database saved to ${path.join(backupDir, file)} before migrating`);
		}
		: null;
	db.migration = runMigrations ? await migrate(db, migrationsDir, { beforeMigrate }) : null;
	await db.refreshSchema();
	return db;
}

// launcher.js rolled back a version, or a version that needs older data was installed from the panel
async function applyRestoreRequest(db, backupDir, migrationsDir, logger) {
	const request = path.join(backupDir, RESTORE_REQUEST);
	if (!fs.existsSync(request)) return;
	const { file } = JSON.parse(fs.readFileSync(request, 'utf8'));
	const source = path.join(backupDir, path.basename(String(file)));
	fs.rmSync(request, { force: true });
	if (!fs.existsSync(source)) {
		logger.error(`Restore asked from ${file}, but the file is missing: the database is left as is.`);
		return;
	}
	logger.warn(`Restoring the database from ${path.basename(source)}…`);
	await restoreDatabase(db, source, { migrationsDir });
	logger.success?.('Database restored.');
}

// Small JSON key/value store on top of the settings table
export function createSettings(db) {
	const get = db.prepare('SELECT value FROM settings WHERE key = ?');
	const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value');
	const del = db.prepare('DELETE FROM settings WHERE key = ?');

	return {
		async get(key, fallback = null) {
			const row = await get.get(key);
			return row ? JSON.parse(row.value) : fallback;
		},
		async set(key, value) {
			if (value === null || value === undefined) await del.run(key);
			else await set.run(key, JSON.stringify(value));
		},
	};
}
