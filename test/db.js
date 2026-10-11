// Test databases on MariaDB: each test file (one process) gets its own database, created and migrated once,
// emptied between tests (only the tables written to), dropped at the end.
// TEST_DATABASE_URL=mysql://root:root@127.0.0.1:3306 by default (docker compose -f docker-compose.test.yml up -d).
import crypto from 'node:crypto';
import { after } from 'node:test';
import mysql from 'mysql2/promise';
import { openDb, databaseOptions } from '../src/db/index.js';

const WRITE = /^\s*(?:INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+IGNORE)?|DELETE\s+FROM)\s+`?(\w+)`?/i;

export function testServerOptions() {
	const url = process.env.TEST_DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3306/';
	const server = databaseOptions({ DATABASE_URL: url });
	delete server.database;
	return server;
}

// A fresh database of its own, migrated (or not): for tests about migrations
export async function createScratchDatabase({ migrate = true, migrationsDir } = {}) {
	const server = testServerOptions();
	const name = `brl_test_${crypto.randomBytes(6).toString('hex')}`;
	const admin = await mysql.createConnection(server);
	await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
	await admin.end();
	const db = await openDb({ ...server, database: name }, { migrate, migrationsDir, connectionLimit: 4 });
	scratch.push({ db, name });
	return db;
}

const scratch = [];
let shared = null;

async function setup() {
	const db = await createScratchDatabase();
	const dirty = new Set();
	db.onQuery((sql) => {
		const match = WRITE.exec(sql);
		if (match) dirty.add(match[1]);
	});
	// Rows written by the migrations (default restriction profiles…), put back after each reset
	const seeds = new Map();
	const tables = (await db.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = \'BASE TABLE\'')).map(r => r.name);
	for (const table of tables) {
		if (table === 'schema_migrations') continue;
		const rows = await db.query(`SELECT * FROM \`${table}\``);
		if (rows.length) seeds.set(table, rows);
	}
	return { db, dirty, seeds };
}

async function reset({ db, dirty, seeds }) {
	if (!dirty.size) return;
	const tables = [...dirty];
	dirty.clear();
	const connection = await db.pool.getConnection();
	try {
		await connection.query('SET FOREIGN_KEY_CHECKS = 0');
		for (const table of tables) await connection.query(`TRUNCATE TABLE \`${table}\``);
		await connection.query('SET FOREIGN_KEY_CHECKS = 1');
		for (const table of tables) {
			for (const row of seeds.get(table) ?? []) await connection.query(`INSERT INTO \`${table}\` SET ?`, [row]);
		}
	}
	finally {
		connection.release();
	}
}

// The database of this test file, empty apart from what the migrations write
export async function openTestDb() {
	if (!shared) shared = await setup();
	else await reset(shared);
	return shared.db;
}

after(async () => {
	if (!scratch.length) return;
	const admin = await mysql.createConnection(testServerOptions());
	for (const { db, name } of scratch.splice(0)) {
		await db.close().catch(() => undefined);
		await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
	}
	await admin.end();
	shared = null;
});
