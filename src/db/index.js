import { AsyncLocalStorage } from 'node:async_hooks';
import mysql from 'mysql2/promise';
import { compile, bind } from './sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate.js';
import { dumpDatabase, restoreDatabase, LAST_MIGRATION, RESTORE_REQUEST } from './dump.js';

// Exact comparisons like before (utf8mb4_bin tables), `||` concatenates strings, strict types
const SQL_MODE = 'STRICT_ALL_TABLES,PIPES_AS_CONCAT,NO_ENGINE_SUBSTITUTION,ERROR_FOR_DIVISION_BY_ZERO';

// mysql://user:password@host:3306/database, or the DB_* variables
export function databaseOptions(config) {
	if (config.DATABASE_URL) {
		const url = new URL(config.DATABASE_URL);
		return {
			host: url.hostname,
			port: Number(url.port) || 3306,
			user: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
			database: decodeURIComponent(url.pathname.slice(1)),
		};
	}
	return { host: config.DB_HOST, port: Number(config.DB_PORT) || 3306, user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME };
}

// The database shared by the bot and the API (MariaDB). The interface keeps the shape the code was
// written for (prepare().get/all/run, transaction()), every call returning a promise.
// backupDir: where the database is saved before each migration (and where launcher.js asks for a restore)
export async function openDb(options, { migrationsDir, migrate: runMigrations = true, connectionLimit = 10, backupDir = null, appVersion = null, logger = console } = {}) {
	const pool = mysql.createPool({
		...options,
		charset: 'utf8mb4_bin',
		connectionLimit,
		waitForConnections: true,
		// Numbers come back as numbers (SUM/AVG give DECIMAL, BIGINT counters), ids are strings in the schema
		decimalNumbers: true,
		supportBigNumbers: true,
		bigNumberStrings: false,
		dateStrings: true,
		// changes = rows matched by an UPDATE, like SQLite, not only the rows whose values changed
		flags: ['FOUND_ROWS'],
		enableKeepAlive: true,
	});
	pool.on('connection', (connection) => {
		connection.query(`SET SESSION sql_mode = '${SQL_MODE}', time_zone = '+00:00'`);
	});

	// The connection of the transaction running in this async context, if any
	const transactions = new AsyncLocalStorage();
	const listeners = new Set();

	function runner() {
		const tx = transactions.getStore();
		return tx && !tx.done ? tx.connection : pool;
	}

	async function query(sql, values) {
		const [result] = await runner().query({ sql, values });
		for (const listener of listeners) listener(sql);
		return result;
	}

	const db = {
		pool,
		options,
		prepare(sql) {
			const compiled = compile(sql);
			return {
				sql,
				async get(...args) {
					const rows = await query(compiled.sql, bind(compiled, args));
					return rows[0];
				},
				async all(...args) {
					return query(compiled.sql, bind(compiled, args));
				},
				async run(...args) {
					const result = await query(compiled.sql, bind(compiled, args));
					return { changes: result.affectedRows, lastInsertRowid: result.insertId };
				},
			};
		},
		// One-off query with positional or named parameters
		async query(sql, ...args) {
			const compiled = compile(sql);
			return query(compiled.sql, bind(compiled, args));
		},
		// Several statements at once (schema changes, imports), never with user values
		async exec(sql) {
			const connection = await mysql.createConnection({ ...options, charset: 'utf8mb4_bin', multipleStatements: true });
			try {
				await connection.query(`SET SESSION sql_mode = '${SQL_MODE}', time_zone = '+00:00'`);
				await connection.query(sql);
			}
			finally {
				await connection.end();
			}
		},
		// db.transaction(fn) returns an async function running fn in one transaction; the queries made
		// by fn (and whatever it awaits) use the transaction's connection. A nested call joins the outer one.
		transaction(fn) {
			return async (...args) => {
				const current = transactions.getStore();
				if (current && !current.done) return fn(...args);
				const connection = await pool.getConnection();
				const tx = { connection, done: false };
				try {
					await connection.beginTransaction();
					const result = await transactions.run(tx, () => fn(...args));
					await connection.commit();
					return result;
				}
				catch (error) {
					await connection.rollback().catch(() => undefined);
					throw error;
				}
				finally {
					// Work started inside the transaction but still running afterwards goes back to the pool
					tx.done = true;
					connection.release();
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
		async close() {
			await pool.end();
		},
	};

	if (backupDir) await applyRestoreRequest(db, backupDir, logger);
	const beforeMigrate = backupDir
		? async (from) => {
			const file = await dumpDatabase(db, backupDir, { label: `avant-migration-v${from}`, schemaVersion: from, appVersion });
			fs.writeFileSync(path.join(backupDir, LAST_MIGRATION), JSON.stringify({ file, at: Date.now(), schemaVersion: from }));
			logger.info(`Database saved to ${path.join(backupDir, file)} before migrating`);
		}
		: null;
	db.migration = runMigrations ? await migrate(db, migrationsDir, { beforeMigrate }) : null;
	return db;
}

// launcher.js rolled back a version, or a version that needs older data was installed from the panel
async function applyRestoreRequest(db, backupDir, logger) {
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
	await restoreDatabase(db, source);
	logger.success?.('Database restored.');
}

// Small JSON key/value store on top of the settings table
export function createSettings(db) {
	const get = db.prepare('SELECT value FROM settings WHERE `key` = ?');
	const set = db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
	const del = db.prepare('DELETE FROM settings WHERE `key` = ?');

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
