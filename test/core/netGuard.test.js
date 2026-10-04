import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedHost, blockedUrl } from '../../src/core/netGuard.js';
import { fetchImage } from '../../src/core/cards.js';

test('outgoing addresses typed in the panel: local network, loopback and metadata refused', async () => {
	for (const url of ['https://127.0.0.1/a.png', 'https://10.0.0.5/a.png', 'https://192.168.1.2/a.png', 'https://169.254.169.254/latest', 'https://[::1]/a.png', 'https://localhost/a.png', 'https://metadata.google.internal/']) {
		assert.ok(blockedUrl(url), url);
	}
	assert.equal(blockedUrl('https://cdn.discordapp.com/a.png'), null);
	assert.equal(blockedHost('192.168.1.2', { allowPrivate: true }), null);
	assert.ok(blockedHost('169.254.169.254', { allowPrivate: true }));

	// Disguised forms of the same addresses
	for (const url of ['https://[::ffff:169.254.169.254]/', 'https://[::ffff:7f00:1]/', 'https://localhost./', 'https://metadata.google.internal./', 'https://0x7f.1/', 'https://2130706433/']) {
		assert.ok(blockedUrl(url), url);
	}
	for (const host of ['0xa9.0xfe.0xa9.0xfe', '2852039166', '::ffff:a9fe:a9fe', 'metadata.google.internal.', 'fe90::1']) {
		assert.ok(blockedHost(host, { allowPrivate: true }), host);
	}
	assert.equal(blockedHost('example.com', { allowPrivate: true }), null);
	assert.equal(blockedHost('51.75.12.34'), null);

	// A redirect towards the local network is not followed
	const calls = [];
	const fetchImpl = async (url) => {
		calls.push(url);
		return { ok: false, status: 302, headers: { get: () => 'https://127.0.0.1/secret' } };
	};
	assert.equal(await fetchImage('https://cdn.example.com/a.png', { fetchImpl }), null);
	assert.deepEqual(calls, ['https://cdn.example.com/a.png']);
});
