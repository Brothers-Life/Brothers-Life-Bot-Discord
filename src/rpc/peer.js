// One end of the internal link between the bot and the API, over a single websocket opened by the bot
// (the bot needs no open port: on webgune a "Discord bot" service has none). Messages (JSON, src/rpc/codec.js):
//   { t: 'call', id, target, service, method, args }   API → bot: do this
//   { t: 'result', id, ok, result | error }             bot → API: the answer
//   { t: 'event', type, data }                          either way: something happened (tickets, console, audit…)
import { encode, decode } from './codec.js';

export class BotUnavailableError extends Error {
	constructor(cause) {
		super('Le bot ne répond pas pour le moment (redémarrage ou panne). Réessaie dans un instant.');
		this.code = 'BOT_UNAVAILABLE';
		this.status = 503;
		this.cause = cause;
	}
}

const CALL_TIMEOUT_MS = 2 * 60_000;

// send(text): writes on the socket; onCall(request) -> result (bot side); onEvent({ type, data })
export function createPeer({ send, onCall = null, onEvent = () => undefined, timeoutMs = CALL_TIMEOUT_MS, logger = console }) {
	const pending = new Map();
	let nextId = 1;
	let open = true;

	function write(message) {
		send(encode(message));
	}

	async function answer(message) {
		try {
			if (!onCall) throw new Error('This end of the link takes no calls');
			const result = await onCall(message);
			write({ t: 'result', id: message.id, ok: true, result });
		}
		catch (error) {
			write({ t: 'result', id: message.id, ok: false, error });
		}
	}

	return {
		// A message received on the socket
		handle(text) {
			let message;
			try {
				message = decode(String(text));
			}
			catch (error) {
				logger.warn('Bad message on the internal link:', error.message);
				return;
			}
			if (message.t === 'call') {
				answer(message).catch(error => logger.warn('Internal link answer failed:', error?.message));
			}
			else if (message.t === 'result') {
				const call = pending.get(message.id);
				if (!call) return;
				pending.delete(message.id);
				clearTimeout(call.timer);
				if (message.ok) call.resolve(message.result);
				else call.reject(message.error instanceof Error ? message.error : new Error(String(message.error?.message ?? message.error)));
			}
			else if (message.t === 'event') {
				try {
					onEvent({ type: message.type, data: message.data });
				}
				catch (error) {
					logger.warn('Internal link event failed:', error?.message);
				}
			}
		},
		call(target, method, args = [], service = null) {
			if (!open) return Promise.reject(new BotUnavailableError());
			const id = nextId++;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new BotUnavailableError(new Error(`${target}.${method} timed out`)));
				}, timeoutMs);
				timer.unref?.();
				pending.set(id, { resolve, reject, timer });
				try {
					write({ t: 'call', id, target, service, method, args });
				}
				catch (error) {
					pending.delete(id);
					clearTimeout(timer);
					reject(error instanceof TypeError ? error : new BotUnavailableError(error));
				}
			});
		},
		event(type, data = null) {
			if (open) write({ t: 'event', type, data });
		},
		// The socket closed: every pending call fails right away
		close(reason = null) {
			open = false;
			for (const { reject, timer } of pending.values()) {
				clearTimeout(timer);
				reject(new BotUnavailableError(reason));
			}
			pending.clear();
		},
		get pending() {
			return pending.size;
		},
	};
}
