// Client of the bot's internal link, used by the API process.
import { EventEmitter } from 'node:events';
import { encode, decode, reviveError } from './codec.js';

const CALL_TIMEOUT_MS = 5 * 60_000;
const RETRY_MS = [1000, 2000, 5000, 10_000];

export class BotUnavailableError extends Error {
	constructor(cause) {
		super('Le bot ne répond pas pour le moment (redémarrage ou panne). Réessaie dans un instant.');
		this.code = 'BOT_UNAVAILABLE';
		this.status = 503;
		this.cause = cause;
	}
}

export function createRpcClient({ url, token, logger = console, fetchImpl = fetch }) {
	const base = url.replace(/\/+$/, '');
	const headers = { Authorization: `Bearer ${token}` };
	const events = new EventEmitter();
	events.setMaxListeners(0);
	let stream = null;
	let closed = false;
	let connected = false;

	async function post(path, body) {
		let res;
		try {
			res = await fetchImpl(`${base}${path}`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body: encode(body),
				signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
			});
		}
		catch (error) {
			throw new BotUnavailableError(error);
		}
		const text = await res.text();
		let payload;
		try {
			payload = decode(text);
		}
		catch {
			throw new BotUnavailableError(new Error(`HTTP ${res.status}`));
		}
		if (!payload.ok) throw payload.error instanceof Error ? payload.error : reviveError(payload.error ?? { message: `HTTP ${res.status}` });
		return payload.result;
	}

	// Reads the Server-Sent Events of the bot, reconnecting forever until close()
	async function listen() {
		let attempt = 0;
		while (!closed) {
			const controller = new AbortController();
			stream = controller;
			try {
				const res = await fetchImpl(`${base}/rpc/events`, { headers, signal: controller.signal });
				if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
				attempt = 0;
				connected = true;
				events.emit('connected');
				const decoder = new TextDecoder();
				let buffer = '';
				for await (const chunk of res.body) {
					buffer += decoder.decode(chunk, { stream: true });
					let index;
					while ((index = buffer.indexOf('\n\n')) !== -1) {
						const block = buffer.slice(0, index);
						buffer = buffer.slice(index + 2);
						const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
						if (!data) continue;
						try {
							const event = decode(data);
							events.emit('event', event);
							events.emit(event.type, event.data);
						}
						catch (error) {
							logger.warn('Bad event from the bot:', error.message);
						}
					}
				}
				throw new Error('stream ended');
			}
			catch (error) {
				if (closed) return;
				if (connected) {
					connected = false;
					events.emit('disconnected');
					logger.warn(`Lost the link with the bot (${error.message}), reconnecting…`);
				}
				const delay = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
				await new Promise(resolve => setTimeout(resolve, delay).unref?.());
			}
		}
	}

	return {
		events,
		get connected() {
			return connected;
		},
		call(target, method, args = [], service = null) {
			return post('/rpc/call', { target, service, method, args });
		},
		emit(type, data = null) {
			return post('/rpc/emit', { type, data });
		},
		async health() {
			const res = await fetchImpl(`${base}/rpc/health`, { headers, signal: AbortSignal.timeout(5000) });
			return decode(await res.text()).result;
		},
		start() {
			closed = false;
			listen();
		},
		close() {
			closed = true;
			stream?.abort();
		},
	};
}

// An object whose every method calls the same method in the bot process.
// `local` answers some methods without a round trip (synchronous values kept up to date by events).
export function remoteObject(rpc, target, { service = null, local = {} } = {}) {
	return new Proxy({}, {
		get(_target, name) {
			// Not a thenable, not a symbol-keyed protocol
			if (typeof name !== 'string' || name === 'then' || name === 'toJSON') return undefined;
			if (name in local) return local[name];
			return (...args) => rpc.call(target, name, args, service);
		},
	});
}
