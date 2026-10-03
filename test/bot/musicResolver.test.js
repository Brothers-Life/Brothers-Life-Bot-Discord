import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMusicResolver } from '../../src/bot/music/resolver.js';

const keys = { clientId: 'a'.repeat(32), clientSecret: 'b'.repeat(32) };

function fakeSpotify() {
	const calls = [];
	const fetchImpl = async (url, options = {}) => {
		calls.push({ url: String(url), auth: options.headers?.Authorization });
		if (String(url).includes('accounts.spotify.com')) return Response.json({ access_token: `tok${calls.length}`, expires_in: 3600 });
		return Response.json({ tracks: { items: [{
			id: 'abc', name: 'One More Time', duration_ms: 320_000,
			artists: [{ name: 'Daft Punk' }], album: { images: [{ url: 'https://i.scdn.co/cover.jpg' }] },
			external_urls: { spotify: 'https://open.spotify.com/track/abc' },
		}] } });
	};
	return { calls, fetchImpl };
}

test('Spotify search: app token reused, tracks played from YouTube later', async () => {
	const { calls, fetchImpl } = fakeSpotify();
	const resolver = createMusicResolver({ ytdlp: { json: async () => ({ entries: [] }) }, fetchImpl });
	const [track] = await resolver.search('daft punk', 5, 'spotify', { spotify: keys });
	assert.deepEqual(track, {
		title: 'One More Time', author: 'Daft Punk', url: 'https://open.spotify.com/track/abc', durationMs: 320_000,
		thumbnail: 'https://i.scdn.co/cover.jpg', source: 'spotify', query: 'Daft Punk - One More Time', live: false,
	});
	await resolver.search('one more time', 5, 'spotify', { spotify: keys });
	assert.equal(calls.filter(c => c.url.includes('accounts.spotify.com')).length, 1, 'one token for both searches');
	assert.match(calls.at(-1).url, /type=track/);
	assert.equal(calls.at(-1).auth, 'Bearer tok1');
	await assert.rejects(resolver.search('x y', 5, 'spotify'), /pas configurée/);
});

test('refused Spotify keys give a clear message', async () => {
	const resolver = createMusicResolver({ ytdlp: {}, fetchImpl: async () => new Response('{}', { status: 400 }) });
	await assert.rejects(resolver.search('daft punk', 5, 'spotify', { spotify: keys }), /Clés Spotify refusées/);
});
