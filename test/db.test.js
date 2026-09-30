import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, backupDb, createSettings, Database } from '../src/db/index.js';
import { migrate, latestSchemaVersion, schemaVersion } from '../src/db/migrate.js';

function tmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'brl-db-'));
}

test('a new database is migrated to the latest schema', () => {
	const db = openDb(':memory:');
	assert.equal(schemaVersion(db), latestSchemaVersion());
	assert.deepEqual(db.migration, { from: 0, to: latestSchemaVersion() });
	const tables = db.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all().map(r => r.name);
	for (const name of ['guilds', 'ranks', 'rank_permissions', 'rank_roles', 'user_ranks', 'sessions', 'audit_log', 'log_routes', 'settings']) {
		assert.ok(tables.includes(name), `missing table ${name}`);
	}
});

test('migrating twice is a no-op', () => {
	const db = openDb(':memory:');
	const version = schemaVersion(db);
	assert.deepEqual(migrate(db), { from: version, to: version });
});

test('a failing migration is rolled back', () => {
	const dir = tmpDir();
	fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x INTEGER);');
	fs.writeFileSync(path.join(dir, '002_broken.sql'), 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;');
	const db = new Database(':memory:');
	assert.throws(() => migrate(db, dir));
	assert.equal(schemaVersion(db), 1);
	assert.equal(db.prepare('SELECT count(*) AS c FROM sqlite_master WHERE name = \'b\'').get().c, 0);
});

test('refuses a database newer than the code', () => {
	const dir = tmpDir();
	fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x INTEGER);');
	const db = new Database(':memory:');
	db.pragma('user_version = 5');
	assert.throws(() => migrate(db, dir), /newer/);
});

test('backup produces a usable copy', async () => {
	const dir = tmpDir();
	const db = openDb(path.join(dir, 'bot.db'));
	createSettings(db).set('hello', { a: 1 });
	await backupDb(db, path.join(dir, 'backups', 'copy.db'));
	const copy = openDb(path.join(dir, 'backups', 'copy.db'));
	assert.deepEqual(createSettings(copy).get('hello'), { a: 1 });
	db.close();
	copy.close();
});

test('settings store JSON values and delete on null', () => {
	const settings = createSettings(openDb(':memory:'));
	assert.equal(settings.get('x', 'default'), 'default');
	settings.set('x', [1, 2]);
	assert.deepEqual(settings.get('x'), [1, 2]);
	settings.set('x', null);
	assert.equal(settings.get('x'), null);
});
