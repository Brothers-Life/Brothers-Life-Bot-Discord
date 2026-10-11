import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettings, openDb } from '../src/db/index.js';
import { dumpDatabase, restoreDatabase, listBackups, LAST_MIGRATION, RESTORE_REQUEST } from '../src/db/dump.js';
import { migrate, latestSchemaVersion, schemaVersion } from '../src/db/migrate.js';
import { compile, bind } from '../src/db/sql.js';
import { createScratchDatabase, openTestDb } from './db.js';

function tmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'brl-db-'));
}

test('a new database is migrated to the latest schema', async () => {
	const db = await createScratchDatabase();
	assert.equal(await schemaVersion(db), latestSchemaVersion());
	assert.deepEqual(db.migration, { from: 0, to: latestSchemaVersion() });
	const tables = (await db.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()')).map(r => r.name);
	for (const name of ['guilds', 'ranks', 'rank_permissions', 'rank_roles', 'user_ranks', 'sessions', 'audit_log', 'log_routes', 'settings']) {
		assert.ok(tables.includes(name), `missing table ${name}`);
	}
});

test('migrating twice is a no-op', async () => {
	const db = await createScratchDatabase();
	const version = await schemaVersion(db);
	assert.deepEqual(await migrate(db), { from: version, to: version });
});

test('a failing migration stops there', async () => {
	const dir = tmpDir();
	fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x INTEGER);');
	fs.writeFileSync(path.join(dir, '002_broken.sql'), 'THIS IS NOT SQL;');
	const db = await createScratchDatabase({ migrate: false });
	await assert.rejects(() => migrate(db, dir));
	assert.equal(await schemaVersion(db), 1);
});

test('refuses a database newer than the code', async () => {
	const dir = tmpDir();
	fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x INTEGER);');
	const db = await createScratchDatabase({ migrate: false });
	await schemaVersion(db);
	await db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (5, 0)');
	await assert.rejects(() => migrate(db, dir), /newer/);
});

test('settings store JSON values and delete on null', async () => {
	const settings = createSettings(await openTestDb());
	assert.equal(await settings.get('x', 'default'), 'default');
	await settings.set('x', [1, 2]);
	assert.deepEqual(await settings.get('x'), [1, 2]);
	await settings.set('x', null);
	assert.equal(await settings.get('x'), null);
});

test('statements bind positional, array and named values', async () => {
	const db = await openTestDb();
	const insert = db.prepare('INSERT INTO settings (`key`, value) VALUES (@key, @value)');
	const first = await insert.run({ key: 'a', value: '"x"' });
	assert.equal(first.changes, 1);
	await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)').run(['b', '1']);
	const rows = await db.prepare('SELECT `key` FROM settings WHERE `key` IN (?, ?) ORDER BY `key`').all('a', 'b');
	assert.deepEqual(rows.map(r => r.key), ['a', 'b']);
	assert.equal(await db.prepare('SELECT value FROM settings WHERE `key` = ?').get('missing'), undefined);
	// UPDATE counts matched rows, even when the value does not change (like SQLite)
	assert.equal((await db.prepare('UPDATE settings SET value = value WHERE `key` = ?').run('a')).changes, 1);
});

test('a transaction rolls back on error and nested calls join it', async () => {
	const db = await openTestDb();
	const insert = db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)');
	const count = async () => (await db.prepare('SELECT COUNT(*) AS n FROM settings WHERE `key` LIKE \'tx%\'').get()).n;
	const inner = db.transaction(async () => insert.run('tx2', '2'));
	const outer = db.transaction(async (fail) => {
		await insert.run('tx1', '1');
		await inner();
		if (fail) throw new Error('boom');
	});
	await assert.rejects(() => outer(true), /boom/);
	assert.equal(await count(), 0);
	await outer(false);
	assert.equal(await count(), 2);
});

test('named parameters ignore strings and comments', () => {
	const compiled = compile('SELECT \'@not\', ":no" -- @nope\n FROM t WHERE a = @a AND b = ? AND c = :c');
	assert.equal(compiled.sql, 'SELECT \'@not\', ":no" -- @nope\n FROM t WHERE a = ? AND b = ? AND c = ?');
	assert.deepEqual(bind(compiled, [2, { a: 1, c: 3 }]), [1, 2, 3]);
	assert.throws(() => bind(compiled, [2, { a: 1 }]), /"c"/);
	assert.throws(() => bind(compile('SELECT ?'), [{ x: 1 }]), /JSON\.stringify/);
});

test('a backup restores every row, text with line breaks and binary data included', async () => {
	const db = await createScratchDatabase();
	const dir = tmpDir();
	await db.query('INSERT INTO settings (`key`, value) VALUES (?, ?), (?, ?)', 'a', '"ligne 1\nligne 2 ; DROP TABLE x;\n-- pas un commentaire"', 'b', '"é💬\'\\\\"');
	await db.query('INSERT INTO files (id, kind, mime, size, gzip, data, created_at) VALUES (?, ?, ?, ?, 0, ?, 1)', 'upload:x', 'upload', 'image/png', 3, Buffer.from([0, 255, 10]));
	const file = await dumpDatabase(db, dir, { label: 'test', schemaVersion: 2 });
	assert.equal(listBackups(dir)[0].schemaVersion, 2);

	await db.query('DELETE FROM settings');
	await db.query('INSERT INTO settings (`key`, value) VALUES (?, ?)', 'c', '1');
	await restoreDatabase(db, path.join(dir, file));
	const rows = await db.query('SELECT `key`, value FROM settings ORDER BY `key`');
	assert.deepEqual(rows.map(r => r.key), ['a', 'b']);
	assert.equal(rows[0].value, '"ligne 1\nligne 2 ; DROP TABLE x;\n-- pas un commentaire"');
	assert.equal(rows[1].value, '"é💬\'\\\\"');
	assert.deepEqual([...(await db.query('SELECT data FROM files'))[0].data], [0, 255, 10]);
	assert.equal(await schemaVersion(db), latestSchemaVersion());
});

test('the database is saved before a migration, and a restore asked by the launcher is applied at start', async () => {
	const dir = tmpDir();
	fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (x INTEGER);');
	const db = await createScratchDatabase({ migrate: false });
	await migrate(db, dir);
	await db.query('INSERT INTO a (x) VALUES (1)');
	fs.writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE b (y INTEGER);');
	const backups = path.join(dir, 'backups');
	const reopened = await openDb(db.options, { migrationsDir: dir, backupDir: backups, logger: { info: () => undefined } });
	const last = JSON.parse(fs.readFileSync(path.join(backups, LAST_MIGRATION), 'utf8'));
	assert.equal(last.schemaVersion, 1);
	assert.equal(reopened.migration.to, 2);

	await reopened.query('INSERT INTO a (x) VALUES (2)');
	fs.writeFileSync(path.join(backups, RESTORE_REQUEST), JSON.stringify({ file: last.file }));
	fs.rmSync(path.join(dir, '002_b.sql'));
	const restored = await openDb(db.options, { migrationsDir: dir, backupDir: backups, logger: { warn: () => undefined, success: () => undefined, info: () => undefined } });
	assert.equal(await schemaVersion(restored), 1);
	assert.deepEqual((await restored.query('SELECT x FROM a')).map(r => r.x), [1]);
	assert.equal(fs.existsSync(path.join(backups, RESTORE_REQUEST)), false);
	await reopened.close();
	await restored.close();
});
