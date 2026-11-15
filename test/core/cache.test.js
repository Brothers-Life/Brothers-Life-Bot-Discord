import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../../src/core/cache.js';

const quiet = { warn: () => null, info: () => null };
const tick = () => new Promise(resolve => setImmediate(resolve));

// What cache.js uses of node-redis, on a Map shared by every client of the test
function fakeRedis(store = new Map()) {
	const state = { isReady: true, fail: false, sets: [] };
	const client = {
		get isReady() {
			return state.isReady;
		},
		async get(key) {
			if (state.fail) throw new Error('boom');
			return store.get(key) ?? null;
		},
		async set(key, text, options) {
			if (state.fail) throw new Error('boom');
			state.sets.push({ key, options });
			store.set(key, text);
		},
		async quit() {
			state.closed = true;
		},
	};
	return { store, state, connect: async () => client };
}

test('cache: in memory, one computation per period, shared by concurrent callers', async () => {
	let at = 1000;
	let runs = 0;
	const cache = createCache({ logger: quiet, now: () => at });
	assert.equal(cache.shared, false);
	const build = async () => ({ n: ++runs });
	const [a, b] = await Promise.all([cache.wrap('k', { ttl: 100 }, build), cache.wrap('k', { ttl: 100 }, build)]);
	assert.deepEqual([a, b, runs], [{ n: 1 }, { n: 1 }, 1]);
	at += 99;
	assert.deepEqual(await cache.wrap('k', { ttl: 100 }, build), { n: 1 });
	at += 1;
	assert.deepEqual(await cache.wrap('k', { ttl: 100 }, build), { n: 2 }, 'too old and no stale window: computed again');
	await cache.close();
});

test('cache: a stale value is served at once while the next one is computed', async () => {
	let at = 0;
	let runs = 0;
	const cache = createCache({ logger: quiet, now: () => at });
	const build = async () => ++runs;
	const options = { ttl: 100, stale: 500 };
	assert.equal(await cache.wrap('k', options, build), 1);
	at = 300;
	assert.equal(await cache.wrap('k', options, build), 1, 'the old value, without waiting');
	await tick();
	assert.equal(runs, 2);
	assert.equal(await cache.wrap('k', options, build), 2);
	at = 300 + 600;
	assert.equal(await cache.wrap('k', options, build), 3, 'past the stale window: the caller waits for a fresh value');
});

test('cache: a failed computation is not kept, a failed background refresh keeps the old value', async () => {
	let at = 0;
	let fail = true;
	const cache = createCache({ logger: quiet, now: () => at });
	const build = async () => {
		if (fail) throw new Error('down');
		return 'ok';
	};
	await assert.rejects(cache.wrap('k', { ttl: 100, stale: 100 }, build), /down/);
	fail = false;
	assert.equal(await cache.wrap('k', { ttl: 100, stale: 100 }, build), 'ok');
	fail = true;
	at = 150;
	assert.equal(await cache.wrap('k', { ttl: 100, stale: 100 }, build), 'ok');
	await tick();
	assert.equal(await cache.wrap('k', { ttl: 100, stale: 100 }, build), 'ok', 'still within the stale window');
});

test('cache: with Redis, two processes share one computation', async () => {
	const redis = fakeRedis();
	let runs = 0;
	const build = async () => ({ n: ++runs });
	const one = createCache({ url: 'redis://x', logger: quiet, connect: redis.connect, now: () => 5000 });
	const two = createCache({ url: 'redis://x', logger: quiet, connect: redis.connect, now: () => 5050 });
	assert.equal(one.shared, true);
	assert.deepEqual(await one.wrap('report', { ttl: 100, stale: 400 }, build), { n: 1 });
	assert.deepEqual(await two.wrap('report', { ttl: 100, stale: 400 }, build), { n: 1 });
	assert.equal(runs, 1);
	assert.deepEqual(redis.state.sets, [{ key: 'brl:report', options: { expiration: { type: 'PX', value: 500 } } }]);
	assert.deepEqual({ ...await one.status(), latency: 0 }, { configured: true, ready: true, latency: 0 });
	redis.state.isReady = false;
	assert.deepEqual(await one.status(), { configured: true, ready: false, latency: null });
	redis.state.isReady = true;
	assert.deepEqual(await createCache({ logger: quiet }).status(), { configured: false, ready: false, latency: null });
	await one.close();
	assert.equal(redis.state.closed, true);
});

test('cache: Redis down, failing or holding garbage never breaks a page', async () => {
	const redis = fakeRedis();
	let runs = 0;
	const build = async () => ++runs;
	const cache = createCache({ url: 'redis://x', logger: quiet, connect: redis.connect, now: () => 0 });
	redis.state.isReady = false;
	assert.equal(await cache.wrap('k', { ttl: 100 }, build), 1);
	assert.equal(await cache.wrap('k', { ttl: 100 }, build), 1, 'memory answers while Redis is away');
	assert.equal(redis.store.size, 0);
	redis.state.isReady = true;
	redis.state.fail = true;
	assert.equal(await cache.wrap('k', { ttl: 100 }, build), 1, 'a failing command falls back on memory');
	redis.state.fail = false;
	redis.store.set('brl:other', '{not json');
	assert.equal(await cache.wrap('other', { ttl: 100 }, build), 2);

	const unreachable = createCache({ url: 'redis://x', logger: quiet, connect: async () => {
		throw new Error('no module');
	} });
	assert.equal(await unreachable.wrap('k', { ttl: 100 }, async () => 'value'), 'value');
	await unreachable.close();
});
