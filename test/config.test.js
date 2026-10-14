import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, ConfigError, missingDatabaseConfig } from '../src/utils/config.js';

const OWNER = '267235400467218432';

test('applies defaults', () => {
	const config = parseConfig({ OWNER_ID: OWNER });
	assert.equal(config.WEB_PORT, 3000);
	assert.equal(config.WEB_MODE, 'http');
	assert.equal(config.WEB_PUBLIC_URL, 'http://localhost:3000');
	assert.equal(config.USE_TRANSLATION_CACHE, true);
});

test('rejects a missing or malformed OWNER_ID', () => {
	assert.throws(() => parseConfig({}), ConfigError);
	assert.throws(() => parseConfig({ OWNER_ID: '123' }), /OWNER_ID/);
	assert.throws(() => parseConfig({ OWNER_ID: `${OWNER},${OWNER}` }), /OWNER_ID/);
});

test('rejects an unknown WEB_MODE', () => {
	assert.throws(() => parseConfig({ OWNER_ID: OWNER, WEB_MODE: 'ftp' }), /WEB_MODE/);
});

test('requires https:// in WEB_PUBLIC_URL for https modes', () => {
	assert.throws(
		() => parseConfig({ OWNER_ID: OWNER, WEB_MODE: 'https-selfsigned', WEB_PUBLIC_URL: 'http://1.2.3.4:25565' }),
		/https:\/\//,
	);
	const config = parseConfig({ OWNER_ID: OWNER, WEB_MODE: 'https-selfsigned', WEB_PUBLIC_URL: 'https://1.2.3.4:25565/' });
	assert.equal(config.WEB_PUBLIC_URL, 'https://1.2.3.4:25565');
});

test('requires certificate paths for https-custom', () => {
	assert.throws(
		() => parseConfig({ OWNER_ID: OWNER, WEB_MODE: 'https-custom', WEB_PUBLIC_URL: 'https://panel.example.com' }),
		/TLS_CERT/,
	);
});

test('collects every problem at once', () => {
	try {
		parseConfig({ WEB_MODE: 'nope', WEB_PORT: '99999' });
		assert.fail('should throw');
	}
	catch (err) {
		assert.ok(err.problems.length >= 3);
	}
});

test('uses the Pterodactyl allocation when WEB_PORT and WEB_PUBLIC_URL are not set', () => {
	const config = parseConfig({ OWNER_ID: OWNER, SERVER_PORT: '25565', SERVER_IP: '51.77.1.2', WEB_MODE: 'https-selfsigned' });
	assert.equal(config.WEB_PORT, 25565);
	assert.equal(config.WEB_PUBLIC_URL, 'https://51.77.1.2:25565');
	assert.equal(parseConfig({ OWNER_ID: OWNER, SERVER_PORT: '25565', SERVER_IP: '0.0.0.0' }).WEB_PUBLIC_URL, 'http://localhost:25565');
});

test('reads the PostgreSQL settings and tells which ones are missing', () => {
	const none = parseConfig({ OWNER_ID: OWNER });
	assert.deepEqual(missingDatabaseConfig(none), ['DB_HOST', 'DB_USER', 'DB_NAME']);
	const url = parseConfig({ OWNER_ID: OWNER, DATABASE_URL: 'postgres://bot:secret@db.local:5433/brl' });
	assert.equal(url.DATABASE_URL, 'postgres://bot:secret@db.local:5433/brl');
	assert.deepEqual(missingDatabaseConfig(url), []);
	const vars = parseConfig({ OWNER_ID: OWNER, DB_HOST: 'db.local', DB_PORT: '3307', DB_USER: 'bot', DB_PASSWORD: ' p@ss ', DB_NAME: 'brl' });
	assert.equal(vars.DB_PASSWORD, ' p@ss ');
	assert.deepEqual(missingDatabaseConfig(vars), []);
	assert.deepEqual(missingDatabaseConfig(parseConfig({ OWNER_ID: OWNER, DB_HOST: 'db.local' })), ['DB_USER', 'DB_NAME']);
});

test('uses PORT (webgune and other hosts) when WEB_PORT is not set', () => {
	assert.equal(parseConfig({ OWNER_ID: OWNER, PORT: '8080' }).WEB_PORT, 8080);
	assert.equal(parseConfig({ OWNER_ID: OWNER, PORT: '8080', WEB_PORT: '3001' }).WEB_PORT, 3001);
});

test('takes the old FiveM panel variables, without the comments pasted with them', () => {
	const config = parseConfig({ OWNER_ID: OWNER, DISCORD_CLIENT_ID: '155485873949088160   # ⟵ à remplir', INGEST_TOKEN: 'abc', DISCORD_CLIENT_SECRET: 's3cret' });
	assert.equal(config.APP_ID, '155485873949088160');
	assert.equal(config.CLIENT_SECRET, 's3cret');
	assert.deepEqual(config.LEGACY_PANEL, { INGEST_TOKEN: 'abc', DISCORD_CLIENT_ID: '155485873949088160', DISCORD_CLIENT_SECRET: 's3cret' });
	assert.equal(parseConfig({ OWNER_ID: OWNER, APP_ID: '123456789012345678', DISCORD_CLIENT_ID: '155485873949088160' }).APP_ID, '123456789012345678');
});

test('rejects a malformed DATABASE_URL or DB_PORT', () => {
	assert.throws(() => parseConfig({ OWNER_ID: OWNER, DATABASE_URL: 'not a url' }), /DATABASE_URL/);
	assert.throws(() => parseConfig({ OWNER_ID: OWNER, DATABASE_URL: 'mysql://u:p@h/db' }), /DATABASE_URL/);
	assert.throws(() => parseConfig({ OWNER_ID: OWNER, DATABASE_URL: 'postgres://u:p@h:5432/' }), /DATABASE_URL/);
	assert.throws(() => parseConfig({ OWNER_ID: OWNER, DB_PORT: 'abc' }), /DB_PORT/);
});
