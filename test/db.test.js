import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

// The production database is at v8 (before the community batch): every later migration must apply on real data
test('upgrading a v8 database with data keeps it and reaches the latest schema', () => {
	const dir = tmpDir();
	const all = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
	for (const file of fs.readdirSync(all).filter(f => Number(f.slice(0, 3)) <= 8)) fs.copyFileSync(path.join(all, file), path.join(dir, file));
	const db = new Database(':memory:');
	migrate(db, dir);
	assert.equal(schemaVersion(db), 8);
	const now = Date.now();
	db.prepare('INSERT INTO ticket_settings (guild_id, panel_channel_id, panel_message_id, panel_title, panel_text, max_open) VALUES (?, ?, ?, ?, ?, ?)').run('900000000000000001', '610000000000000001', '710000000000000001', 'Support', 'Ouvre un ticket', 2);
	db.prepare('INSERT INTO ticket_categories (guild_id, name, position, created_at) VALUES (?, ?, 0, ?)').run('900000000000000001', 'Aide', now);
	db.prepare('INSERT INTO tickets (guild_id, number, category_id, channel_id, opener_id, created_at) VALUES (?, 1, 1, ?, ?, ?)').run('900000000000000001', '620000000000000001', '300000000000000001', now);
	db.prepare('INSERT INTO sanctions (type, user_id, moderator_id, source, scope, reason, created_at) VALUES (\'warn\', ?, ?, \'panel\', \'network\', \'Spam\', ?)').run('300000000000000001', '100000000000000001', now);

	const result = migrate(db);
	assert.deepEqual(result, { from: 8, to: latestSchemaVersion() });
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 1);
	assert.equal(db.prepare('SELECT reason FROM sanctions').get().reason, 'Spam');
	// v1 ticket panel turned into the first panel of tickets v2
	const panel = db.prepare('SELECT * FROM ticket_panels').get();
	assert.equal(panel.channel_id, '610000000000000001');
	assert.equal(JSON.parse(db.prepare('SELECT config FROM ticket_settings').get().config).maxOpen, 2);
	assert.equal(db.prepare('SELECT status_key FROM tickets').get().status_key, 'open');
});
