// Internal link of the bot process: the API (panel) calls it to act on Discord and to reach the services
// living in the bot (music player…), and listens to its events (console, tickets, music…).
// Plain HTTP + Server-Sent Events, protected by INTERNAL_TOKEN. Never expose this port publicly.
import http from 'node:http';
import crypto from 'node:crypto';
import { encode, decode } from './codec.js';

const MAX_BODY = 64 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;

export function sameSecret(given, expected) {
	const a = Buffer.from(String(given ?? ''));
	const b = Buffer.from(String(expected ?? ''));
	return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				reject(Object.assign(new Error('Body too large'), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

// handlers.call({ target, service, method, args }) -> result; handlers.emit({ type, data }) from the API
export function createRpcServer({ token, host = '0.0.0.0', port = 3002, handlers, logger = console }) {
	if (!token || token.length < 32) throw new Error('INTERNAL_TOKEN must be set (32 characters or more) to link the bot and the API.');
	const clients = new Set();

	function send(res, status, body) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(encode(body));
	}

	const server = http.createServer(async (req, res) => {
		const auth = req.headers.authorization ?? '';
		if (!sameSecret(auth.replace(/^Bearer /, ''), token)) {
			send(res, 401, { ok: false, error: { name: 'Error', message: 'Unauthorized', status: 401 } });
			return;
		}
		const url = new URL(req.url, 'http://internal');
		try {
			if (req.method === 'GET' && url.pathname === '/rpc/health') {
				send(res, 200, { ok: true, result: await handlers.health?.() ?? { ready: true } });
			}
			else if (req.method === 'GET' && url.pathname === '/rpc/events') {
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
				res.write(': connected\n\n');
				clients.add(res);
				const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
				req.on('close', () => {
					clearInterval(heartbeat);
					clients.delete(res);
				});
				// What a fresh subscriber needs right away (bot user, guild icons…)
				for (const event of await handlers.welcome?.() ?? []) res.write(`data: ${encode(event)}\n\n`);
			}
			else if (req.method === 'POST' && url.pathname === '/rpc/call') {
				const request = decode(await readBody(req));
				try {
					send(res, 200, { ok: true, result: await handlers.call(request) });
				}
				catch (error) {
					send(res, 200, { ok: false, error });
				}
			}
			else if (req.method === 'POST' && url.pathname === '/rpc/emit') {
				await handlers.emit?.(decode(await readBody(req)));
				send(res, 200, { ok: true, result: null });
			}
			else {
				send(res, 404, { ok: false, error: { name: 'Error', message: 'Not found', status: 404 } });
			}
		}
		catch (error) {
			logger.warn('Internal link request failed:', error?.message ?? error);
			if (!res.headersSent) send(res, error.status ?? 500, { ok: false, error });
		}
	});
	server.requestTimeout = 10 * 60_000;

	return {
		// Pushes an event to every connected API process
		broadcast(event) {
			if (!clients.size) return;
			const line = `data: ${encode(event)}\n\n`;
			for (const res of clients) res.write(line);
		},
		get subscribers() {
			return clients.size;
		},
		listen() {
			return new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen(port, host, () => {
					server.off('error', reject);
					resolve(server.address());
				});
			});
		},
		close() {
			for (const res of clients) res.end();
			clients.clear();
			const closed = new Promise(resolve => server.close(() => resolve()));
			server.closeAllConnections();
			return closed;
		},
	};
}
