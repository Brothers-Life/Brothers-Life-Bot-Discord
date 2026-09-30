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

	// A redirect towards the local network is not followed
	const calls = [];
	const fetchImpl = async (url) => {
		calls.push(url);
		return { ok: false, status: 302, headers: { get: () => 'https://127.0.0.1/secret' } };
	};
	assert.equal(await fetchImage('https://cdn.example.com/a.png', { fetchImpl }), null);
	assert.deepEqual(calls, ['https://cdn.example.com/a.png']);
});
