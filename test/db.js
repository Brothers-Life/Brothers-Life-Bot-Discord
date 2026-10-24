// Test databases on PostgreSQL: each test file (one process) gets its own database, created and migrated once,
// emptied between tests (only the tables written to), dropped at the end.
// TEST_DATABASE_URL=postgres://postgres:root@127.0.0.1:5432/postgres by default (npm run db:test).
import crypto from 'node:crypto';
import { after } from 'node:test';
import pg from 'pg';
import { openDb, databaseOptions } from '../src/db/index.js';
import { literal } from '../src/db/dump.js';

// A table of another schema (fivem."players") is not one of ours: the FiveM mirror is dropped as a whole in reset()
const WRITE = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?(?![\w.])/i;

function serverUrl() {
	return process.env.TEST_DATABASE_URL ?? 'postgres://postgres:root@127.0.0.1:5432/postgres';
}

// Connection settings of a database on the test server
export function testDatabaseOptions(name) {
	const url = new URL(serverUrl());
	url.pathname = `/${name}`;
	return databaseOptions({ DATABASE_URL: url.toString() });
}

async function admin(sql) {
	const client = new pg.Client({ connectionString: serverUrl() });
	await client.connect();
	try {
		await client.query(sql);
	}
	finally {
		await client.end();
	}
}

// A fresh database of its own, migrated (or not): for tests about migrations
export async function createScratchDatabase({ migrate = true, migrationsDir } = {}) {
	const name = `brl_test_${crypto.randomBytes(6).toString('hex')}`;
	await admin(`CREATE DATABASE ${name}`);
	const db = await openDb(testDatabaseOptions(name), { migrate, migrationsDir, connectionLimit: 4 });
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
		if (match) dirty.add(match[1].toLowerCase());
	});
	// Rows written by the migrations (default restriction profiles…), put back after each reset
	const seeds = new Map();
	const tables = (await db.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = \'BASE TABLE\'')).map(r => r.name);
	for (const table of tables) {
		if (table === 'schema_migrations') continue;
		const rows = await db.query(`SELECT * FROM ${table}`);
		if (rows.length) seeds.set(table, rows);
	}
	return { db, dirty, seeds };
}

async function reset({ db, dirty, seeds }) {
	// Tables of the FiveM mirror (schema fivem), created by the tests that use it
	const mirrored = (await db.query('SELECT tablename AS name FROM pg_tables WHERE schemaname = \'fivem\'')).map(r => `fivem."${r.name}"`);
	if (mirrored.length) await db.exec(`DROP TABLE ${mirrored.join(', ')}`);
	if (!dirty.size) return;
	const tables = [...dirty];
	dirty.clear();
	// One statement: ids start again from 1, rows pointing to these tables go too
	await db.exec(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
	for (const table of tables) {
		for (const row of seeds.get(table) ?? []) {
			const columns = Object.keys(row);
			await db.exec(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(c => literal(row[c])).join(', ')})`);
		}
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
	for (const { db, name } of scratch.splice(0)) {
		await db.close().catch(() => undefined);
		await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
	}
	shared = null;
});
