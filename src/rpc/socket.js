// Websocket of the internal link, on the API's own port: the bot dials /internal/bot with INTERNAL_TOKEN
// (on webgune a "Discord bot" service has no open port, so the API cannot dial the bot).
// The panel's websockets keep their small frame limit; this one carries files (images, transcripts…).
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

export const INTERNAL_PATH = '/internal/bot';
export const MAX_MESSAGE = 64 * 1024 * 1024;
const PING_MS = 15_000;

export function sameSecret(given, expected) {
	const a = Buffer.from(String(given ?? ''));
	const b = Buffer.from(String(expected ?? ''));
	return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}

// Takes the upgrades of `path` on an HTTP server before @fastify/websocket sees them; the others go on as before.
// onConnection(socket) for each authenticated bot connection.
export function attachInternalLink(server, { token, onConnection, path = INTERNAL_PATH, logger = console }) {
	if (!token || token.length < 32) throw new Error('INTERNAL_TOKEN must be set (32 characters or more) to link the bot and the API.');
	const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false });
	const others = server.listeners('upgrade');
	server.removeAllListeners('upgrade');

	function onUpgrade(req, socket, head) {
		let pathname;
		try {
			pathname = new URL(req.url, 'http://internal').pathname;
		}
		catch {
			pathname = '';
		}
		if (pathname !== path) {
			for (const listener of others) listener.call(server, req, socket, head);
			return;
		}
		const auth = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
		if (!sameSecret(auth, token)) {
			logger.warn('Refused a connection on the internal link (wrong INTERNAL_TOKEN).');
			socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => {
			// A dead connection (bot killed, network cut) is noticed within two pings
			let alive = true;
			ws.on('pong', () => {
				alive = true;
			});
			const timer = setInterval(() => {
				if (!alive) return ws.terminate();
				alive = false;
				ws.ping();
			}, PING_MS);
			timer.unref?.();
			ws.on('close', () => clearInterval(timer));
			onConnection(ws, req);
		});
	}
	server.on('upgrade', onUpgrade);

	return {
		close() {
			server.off('upgrade', onUpgrade);
			for (const listener of others) server.on('upgrade', listener);
			for (const ws of wss.clients) ws.terminate();
			wss.close();
		},
	};
}

// An object whose every method calls the same method in the bot process.
// `local` answers some methods without a round trip (synchronous values kept up to date by events).
export function remoteObject(link, target, { service = null, local = {} } = {}) {
	return new Proxy({}, {
		get(_target, name) {
			// Not a thenable, not a symbol-keyed protocol
			if (typeof name !== 'string' || name === 'then' || name === 'toJSON') return undefined;
			if (name in local) return local[name];
			return (...args) => link.call(target, name, args, service);
		},
	});
}
