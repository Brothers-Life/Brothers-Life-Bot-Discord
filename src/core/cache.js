// Cache of values that are slow to compute (whole-server reports…), shared between the processes through Redis
// when REDIS_URL is set, kept in this process's memory otherwise. Redis is only ever a shortcut: unreachable,
// slow or holding something unreadable, the memory copy answers and the value is computed again. Values are JSON.

const COMMAND_TIMEOUT = 1500;

// Where REDIS_URL points (host:port, never the password), or what is wrong with it. Anything that is not a
// redis:// address would silently make the client try 127.0.0.1:6379.
export function redisTarget(url) {
	try {
		const parsed = new URL(url);
		if (!/^rediss?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error('not redis');
		return { target: `${parsed.hostname}:${parsed.port || 6379}`, problem: null };
	}
	catch {
		return { target: null, problem: 'REDIS_URL doit ressembler à redis://:motdepasse@hôte:6379' };
	}
}

async function redisClient(url, logger, onError = () => null) {
	const { createClient } = await import('redis');
	const client = createClient({
		url,
		// A command sent while disconnected fails at once instead of waiting for the connection to come back
		disableOfflineQueue: true,
		socket: { connectTimeout: 5000, reconnectStrategy: retries => Math.min(500 * (retries + 1), 15_000) },
	});
	let lastError = '';
	client.on('error', (error) => {
		// One line per kind of failure, not one per reconnection attempt
		const text = error?.code ?? error?.message ?? String(error);
		if (text !== lastError) logger.warn('Redis:', text);
		lastError = text;
		onError(text);
	});
	client.on('ready', () => {
		lastError = '';
		onError(null);
		logger.info?.('Redis connected: shared cache on.');
	});
	client.connect().catch(() => null);
	return client;
}

const within = (promise, ms) => new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('timeout')), ms);
	promise.then(resolve, reject).finally(() => clearTimeout(timer));
});

// connect(url, logger) -> { isReady, get(key), set(key, text, { expiration: { type: 'PX', value } }), quit() } (node-redis by default, a fake in tests)
export function createCache({ url = '', logger = console, now = Date.now, connect = redisClient, prefix = 'brl:' } = {}) {
	const memory = new Map();
	const inflight = new Map();
	const { target, problem } = url ? redisTarget(url) : { target: null, problem: null };
	// Why Redis does not answer, for the status page (ECONNREFUSED, WRONGPASS…)
	let lastError = problem;
	if (problem) logger.warn(`Redis: ${problem} — cache kept in memory.`);
	const opening = url && !problem ? Promise.resolve().then(() => connect(url, logger, (error) => { lastError = error; })).catch((error) => {
		logger.warn('Redis unavailable, cache kept in memory:', error?.message);
		lastError = error?.message ?? 'client Redis indisponible';
		return null;
	}) : null;

	// The Redis client when it can answer right now
	async function live() {
		const client = await opening;
		return client?.isReady ? client : null;
	}

	async function read(key) {
		const client = await live();
		if (client) {
			try {
				const text = await within(client.get(prefix + key), COMMAND_TIMEOUT);
				// Nothing in Redis: the memory copy of this process may be older than what another one would compute
				if (!text) return null;
				const entry = JSON.parse(text);
				if (entry && typeof entry.at === 'number') return entry;
			}
			catch (error) {
				logger.warn('Redis read failed:', error?.message);
			}
		}
		const entry = memory.get(key);
		if (entry && entry.until <= now()) memory.delete(key);
		return memory.get(key) ?? null;
	}

	async function write(key, value, keepMs) {
		const entry = { at: now(), value };
		memory.set(key, { ...entry, until: entry.at + keepMs });
		const client = await live();
		if (!client) return;
		try {
			await within(client.set(prefix + key, JSON.stringify(entry), { expiration: { type: 'PX', value: keepMs } }), COMMAND_TIMEOUT);
		}
		catch (error) {
			logger.warn('Redis write failed:', error?.message);
		}
	}

	// One computation at a time per key in this process; a failure is not kept
	function refresh(key, keepMs, build) {
		const running = inflight.get(key);
		if (running) return running;
		const promise = (async () => {
			const value = await build();
			await write(key, value, keepMs);
			return value;
		})().finally(() => inflight.delete(key));
		inflight.set(key, promise);
		return promise;
	}

	return {
		shared: Boolean(url),

		// The value of `key`, computed by build() when missing. Younger than `ttl`: returned as is. Older but within
		// `stale` more milliseconds: returned at once while a fresh one is computed in the background.
		async wrap(key, { ttl, stale = 0 }, build) {
			const entry = await read(key);
			const age = entry ? now() - entry.at : Infinity;
			if (age < ttl) return entry.value;
			if (age < ttl + stale) {
				refresh(key, ttl + stale, build).catch(error => logger.warn(`Cache refresh of ${key} failed:`, error?.message));
				return entry.value;
			}
			return refresh(key, ttl + stale, build);
		},

		// For the status page: is Redis configured, does it answer, how fast
		async status() {
			if (!url) return { configured: false, ready: false, latency: null, target: null, error: null };
			const client = await live();
			if (!client) return { configured: true, ready: false, latency: null, target, error: lastError };
			const start = performance.now();
			try {
				await within(Promise.resolve(client.ping?.()), COMMAND_TIMEOUT);
				return { configured: true, ready: true, latency: Math.round(performance.now() - start), target, error: null };
			}
			catch (error) {
				return { configured: true, ready: false, latency: null, target, error: error?.message ?? null };
			}
		},

		async close() {
			const client = await opening;
			if (!client) return;
			// A client that is still trying to reconnect never answers quit(): it is cut off
			if (client.isReady) await within(client.quit(), COMMAND_TIMEOUT).catch(() => null);
			try {
				client.destroy?.();
			}
			catch {
				// Already closed by quit()
			}
		},
	};
}
