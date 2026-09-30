import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, ConfigError } from '../src/utils/config.js';

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
