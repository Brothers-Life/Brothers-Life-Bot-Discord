import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN } from '../helpers.js';
import { createFeedFetcher, createFeeds } from '../../src/core/feeds.js';

const CHANNEL = '610000000000000002';
const target = { guildId: MAIN, channelId: CHANNEL, ping: 'none' };
const FEED_URL = 'https://brl.example/feed.xml';
const TIKTOK_URL = 'https://rsshub.example/tiktok/user/@brl';

function rss(items, title = 'Actus BRL') {
	return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://brl.example/</link>${items.map(i => `<item><title>${i.title}</title><link>https://brl.example/${i.id}</link><guid>${i.id}</guid>${i.at ? `<pubDate>${new Date(i.at).toUTCString()}</pubDate>` : ''}${i.image ? `<enclosure url="${i.image}" type="image/jpeg"/>` : ''}<description>${i.text ?? ''}</description></item>`).join('')}</channel></rss>`;
}

function response(body, { status = 200, headers = {} } = {}) {
	const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	return { ok: status >= 200 && status < 300, status, headers: { get: k => h.get(k.toLowerCase()) ?? null }, text: async () => body };
}

async function setup() {
	let clock = Date.UTC(2026, 9, 1, 18, 0);
	const world = { items: [], status: 200, calls: [], hosts: { 'brl.example': '93.184.216.34', 'rsshub.example': '93.184.216.35', 'evil.example': '10.0.0.5', 'redirect.example': '93.184.216.36' } };
	const fetchImpl = async (url, init) => {
		world.calls.push({ url, headers: init.headers });
		if (url.startsWith('https://redirect.example/')) return response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
		if (world.status !== 200) return response('erreur', { status: world.status });
		if (init.headers['If-None-Match'] === '"v-same"' && world.etag === '"v-same"') return response('', { status: 304 });
		return response(rss(world.items), { headers: world.etag ? { etag: world.etag } : {} });
	};
	const lookup = async (host) => {
		if (!world.hosts[host]) throw new Error('ENOTFOUND');
		return [{ address: world.hosts[host], family: 4 }];
	};
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	executor.channels.set(CHANNEL, { guildId: MAIN, name: 'actus' });
	const feeds = createFeeds({ db: core.db, network: core.network, audit: core.audit, executor, logs: core.logs, variables: core.variables, fetchImpl, lookup, logger: { warn: () => undefined }, now: () => clock });
	return { ...ctx, feeds, world, advance: (ms) => { clock += ms; }, now: () => clock };
}

test('RSS: what the feed holds when added is not announced, then new items once each, oldest first, 3 at most', async () => {
	const { feeds, owner, executor, world, advance, now } = await setup();
	world.items = [{ id: 'a', title: 'Ancien', at: now() - 3_600_000 }];
	const sub = await feeds.save(owner, { kind: 'rss', url: FEED_URL, targets: [target], config: { intervalMinutes: 10 } });
	assert.equal(sub.displayName, 'Actus BRL', 'the feed title is the default name');
	assert.equal(sub.state.ready, true);
	await feeds.tick();
	assert.equal(executor.announcements.length, 0, 'first read only remembers, and the next check waits for the interval');

	world.items = [
		{ id: 'e', title: 'Cinq', at: now() + 5000, image: 'https://brl.example/5.jpg' }, { id: 'd', title: 'Quatre', at: now() + 4000 },
		{ id: 'c', title: 'Trois', at: now() + 3000 }, { id: 'b', title: 'Deux', at: now() + 2000 }, ...world.items,
	];
	advance(10 * 60_000);
	await feeds.tick();
	assert.deepEqual(executor.announcements.map(a => a.payload.embed.title), ['Trois', 'Quatre', 'Cinq'], 'no flood: the 3 newest, oldest first');
	const last = executor.announcements.at(-1).payload;
	assert.equal(last.embed.url, 'https://brl.example/e');
	assert.equal(last.embed.imageUrl, 'https://brl.example/5.jpg');
	assert.equal(last.content, '📰 Nouveau sur **Actus BRL**');
	assert.equal(executor.announcements[0].payload.embed.imageUrl, null, 'no image: no broken {item.image} left');

	advance(10 * 60_000);
	await feeds.tick();
	assert.equal(executor.announcements.length, 3, 'already seen items are never announced again');
	assert.deepEqual(feeds.history().map(h => h.title), ['Cinq', 'Quatre', 'Trois']);
	assert.equal(feeds.get(sub.id).state.error, null);
});

test('words filter, template variables (item, server), HTTP cache and backoff on errors', async () => {
	const { feeds, owner, executor, world, advance, now } = await setup();
	world.etag = '"v1"';
	const sub = await feeds.save(owner, {
		kind: 'rss', url: FEED_URL, displayName: 'Nouvelles', targets: [target], config: { intervalMinutes: 5, excludeWords: ['test'] },
		payload: { content: '{item.titre} sur {server} ({flux.titre})', embed: { title: '{item.titre}', url: '{item.lien}', description: '{item.description}' } },
	});
	world.items = [{ id: 'x', title: 'Un test', at: now() + 1000 }, { id: 'y', title: 'Vraie info', at: now() + 2000, text: 'Détails' }];
	advance(5 * 60_000);
	await feeds.tick();
	assert.deepEqual(executor.announcements.map(a => a.payload.content), ['Vraie info sur Serveur (Actus BRL)']);
	assert.equal(executor.announcements[0].payload.embed.description, 'Détails');

	world.etag = '"v-same"';
	advance(5 * 60_000);
	await feeds.tick();
	advance(5 * 60_000);
	await feeds.tick();
	assert.equal(world.calls.at(-1).headers['If-None-Match'], '"v-same"', 'the saved ETag is sent back');

	world.status = 503;
	advance(5 * 60_000);
	await feeds.tick();
	let state = feeds.get(sub.id).state;
	assert.match(state.error, /HTTP 503/);
	assert.equal(state.failures, 1);
	assert.equal(state.nextCheckAt - now(), 10 * 60_000, 'interval doubled after an error');
	advance(10 * 60_000);
	await feeds.tick();
	state = feeds.get(sub.id).state;
	assert.equal(state.failures, 2);
	assert.equal(state.nextCheckAt - now(), 20 * 60_000);
	world.status = 200;
	advance(20 * 60_000);
	await feeds.tick();
	state = feeds.get(sub.id).state;
	assert.equal(state.error, null);
	assert.equal(state.failures, 0);
});

test('TikTok through an RSS bridge: video variables, clear message without URL', async () => {
	const { feeds, owner, executor, world, advance, now } = await setup();
	await assert.rejects(feeds.save(owner, { kind: 'tiktok', url: '@brl', targets: [target] }), /RSSHub/);
	const sub = await feeds.save(owner, { kind: 'tiktok', url: TIKTOK_URL, displayName: 'BRL', targets: [target] });
	assert.equal(sub.config.intervalMinutes, 30);
	world.items = [{ id: 'v1', title: 'Clip du serveur', at: now() + 1000, image: 'https://p16.example/cover.jpg' }];
	advance(30 * 60_000);
	await feeds.tick();
	const p = executor.announcements[0].payload;
	assert.equal(p.content, '🎵 Nouvelle vidéo TikTok de **BRL** !');
	assert.equal(p.embed.title, 'Clip du serveur');
	assert.equal(p.embed.imageUrl, 'https://p16.example/cover.jpg');
	assert.deepEqual(await feeds.test(owner, sub.id), { sent: 1, total: 1 });
});

test('a new URL starts over without announcing what the new feed holds; old items dated before the first read are skipped', async () => {
	const { feeds, owner, executor, world, advance, now } = await setup();
	world.items = [{ id: 'a', title: 'A', at: now() }];
	const sub = await feeds.save(owner, { kind: 'rss', url: FEED_URL, targets: [target], config: { intervalMinutes: 5 } });
	world.items = [{ id: 'old', title: 'Vieux billet revenu', at: now() - 30 * 86_400_000 }, ...world.items];
	advance(5 * 60_000);
	await feeds.tick();
	assert.equal(executor.announcements.length, 0, 'an item from a month ago is not news');
	world.items = [{ id: 'z1', title: 'Autre flux', at: now() }];
	await feeds.save(owner, { id: sub.id, url: 'https://rsshub.example/other.xml' });
	advance(5 * 60_000);
	await feeds.tick();
	assert.equal(executor.announcements.length, 0);
});

test('netGuard: local, private and metadata addresses refused, also after DNS and redirects', async () => {
	const { feeds, owner, world } = await setup();
	for (const url of ['http://127.0.0.1/feed', 'http://localhost:3000/rss', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://192.168.1.10/rss', 'file:///etc/passwd', 'https://user:pass@brl.example/']) {
		await assert.rejects(feeds.save(owner, { kind: 'rss', url, targets: [target] }), /refusée|http|identifiants|complète/i, url);
	}
	await assert.rejects(feeds.save(owner, { kind: 'rss', url: 'https://evil.example/rss', targets: [target] }), /réseau local/, 'a name pointing to the local network');
	await assert.rejects(feeds.preview(owner, 'https://redirect.example/rss'), /refusée/, 'a redirect to the machine itself');
	await assert.rejects(feeds.save(owner, { kind: 'rss', url: 'https://nowhere.example/rss', targets: [target] }), /introuvable/);
	assert.ok(!world.calls.some(c => /127\.0\.0\.1|localhost|169\.254|192\.168|evil/.test(c.url)), 'nothing was fetched from a refused address');
});

test('size limit and non-feed answers', async () => {
	const big = 'x'.repeat(3 * 1024 * 1024);
	const fetchFeed = createFeedFetcher({ fetchImpl: async () => response(big), lookup: async () => [{ address: '93.184.216.34' }] });
	await assert.rejects(fetchFeed('https://brl.example/big.xml'), /trop volumineux/);
	const announced = createFeedFetcher({ fetchImpl: async () => response('', { headers: { 'content-length': String(5e6) } }), lookup: async () => [{ address: '93.184.216.34' }] });
	await assert.rejects(announced('https://brl.example/big.xml'), /trop volumineux/);
	const { feeds, owner } = await setup();
	await assert.rejects(feeds.preview(owner, 'https://nowhere.example/'), /introuvable/);
});

test('preview, permissions, removal', async () => {
	const { feeds, owner, world, now } = await setup();
	world.items = [{ id: 'a', title: 'Premier', at: now() }];
	const preview = await feeds.preview(owner, FEED_URL);
	assert.equal(preview.title, 'Actus BRL');
	assert.equal(preview.items[0].title, 'Premier');
	const nobody = { id: '1', can: () => false };
	await assert.rejects(feeds.save(nobody, { kind: 'rss', url: FEED_URL, targets: [target] }), /notifications.manage/);
	await assert.rejects(feeds.preview(nobody, FEED_URL), /notifications.manage/);
	const sub = await feeds.save(owner, { kind: 'rss', url: FEED_URL, targets: [target] });
	await feeds.remove(owner, sub.id);
	assert.equal(feeds.list().length, 0);
});
