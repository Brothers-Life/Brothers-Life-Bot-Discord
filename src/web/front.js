// The front server: static files of the React app, everything else of the panel forwarded to the API.
// Only node:* modules: nothing to install beyond the release itself.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from './headers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATIC_DIR = path.resolve(__dirname, '..', '..', 'web', 'dist');

const TYPES = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
	'.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
	'.webmanifest': 'application/manifest+json', '.map': 'application/json',
};
// Hop-by-hop headers are never forwarded
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

// Requests the API answers: its routes, the websockets, the public page (shown only while switched on)
// and the FiveM telemetry (/v1/…, bl_telemetry)
export function goesToApi(pathname) {
	return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/public' || pathname.startsWith('/v1/');
}

export function createFrontServer({ config, tls = null, logger = console, staticDir = DEFAULT_STATIC_DIR }) {
	const api = new URL(config.API_URL);
	const apiAgent = api.protocol === 'https:' ? https : http;
	const root = path.resolve(staticDir);
	const index = path.join(root, 'index.html');

	function forwardedHeaders(req) {
		const headers = {};
		for (const [key, value] of Object.entries(req.headers)) if (!HOP.has(key)) headers[key] = value;
		const client = req.socket.remoteAddress ?? '';
		headers['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${client}` : client;
		headers['x-forwarded-proto'] = tls ? 'https' : 'http';
		headers['x-forwarded-host'] = req.headers.host ?? '';
		headers.host = api.host;
		return headers;
	}

	function proxy(req, res) {
		const upstream = apiAgent.request({
			protocol: api.protocol, hostname: api.hostname, port: api.port, method: req.method, path: req.url, headers: forwardedHeaders(req),
		}, (answer) => {
			const headers = {};
			for (const [key, value] of Object.entries(answer.headers)) if (!HOP.has(key)) headers[key] = value;
			res.writeHead(answer.statusCode ?? 502, headers);
			answer.pipe(res);
		});
		upstream.on('error', (error) => {
			logger.warn(`API unreachable (${req.method} ${req.url}):`, error.message);
			if (res.headersSent) return res.destroy();
			res.writeHead(502, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
			res.end(JSON.stringify({ error: { code: 'API_UNAVAILABLE', message: 'L’API du panel ne répond pas pour le moment. Réessaie dans un instant.' } }));
		});
		req.pipe(upstream);
	}

	// Websockets (/api/console, /api/tickets/live…): the upgrade is passed through untouched
	function proxyUpgrade(req, socket, head) {
		const upstream = apiAgent.request({
			protocol: api.protocol, hostname: api.hostname, port: api.port, method: req.method, path: req.url,
			headers: { ...forwardedHeaders(req), connection: 'Upgrade', upgrade: req.headers.upgrade },
		});
		upstream.on('upgrade', (answer, apiSocket, apiHead) => {
			const lines = [`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}`];
			for (let i = 0; i < answer.rawHeaders.length; i += 2) lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`);
			socket.write(`${lines.join('\r\n')}\r\n\r\n`);
			if (apiHead?.length) socket.write(apiHead);
			if (head?.length) apiSocket.write(head);
			apiSocket.pipe(socket).pipe(apiSocket);
			apiSocket.on('error', () => socket.destroy());
			socket.on('error', () => apiSocket.destroy());
		});
		upstream.on('response', (answer) => {
			socket.end(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}\r\n\r\n`);
		});
		upstream.on('error', () => socket.destroy());
		upstream.end();
	}

	function sendFile(res, file, cache) {
		fs.stat(file, (error, stat) => {
			if (error || !stat.isFile()) {
				res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
				return res.end('Not found');
			}
			res.writeHead(200, {
				...SECURITY_HEADERS,
				'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
				'Content-Length': stat.size,
				// Built files carry a hash in their name: cached for good; the app page always fresh
				'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
			});
			fs.createReadStream(file).pipe(res);
		});
	}

	function serveStatic(req, res) {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
			return res.end();
		}
		if (!fs.existsSync(index)) {
			res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
			return res.end('Panel not built: run "npm run build:web" (or use a release).');
		}
		let pathname;
		try {
			pathname = decodeURIComponent(new URL(req.url, 'http://front').pathname);
		}
		catch {
			res.writeHead(400, SECURITY_HEADERS);
			return res.end();
		}
		const file = path.resolve(root, `.${pathname}`);
		// Nothing outside the build folder (../ tricks)
		if (file !== root && !file.startsWith(root + path.sep)) {
			res.writeHead(404, SECURITY_HEADERS);
			return res.end();
		}
		if (pathname.startsWith('/assets/')) return sendFile(res, file, true);
		if (pathname !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file, false);
		// Any other path is a page of the React app
		return sendFile(res, index, false);
	}

	const handler = (req, res) => {
		const pathname = req.url.split('?')[0];
		if (goesToApi(pathname)) return proxy(req, res);
		return serveStatic(req, res);
	};
	const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
	server.on('upgrade', (req, socket, head) => {
		if (goesToApi(req.url.split('?')[0])) return proxyUpgrade(req, socket, head);
		socket.destroy();
	});

	return {
		server,
		// GET on the API (JSON), for the front's own needs
		apiJson(pathname) {
			return new Promise((resolve, reject) => {
				const headers = config.INTERNAL_TOKEN ? { 'x-internal-token': config.INTERNAL_TOKEN } : {};
				const request = apiAgent.get({ protocol: api.protocol, hostname: api.hostname, port: api.port, path: pathname, headers, timeout: 10_000 }, (answer) => {
					let body = '';
					answer.setEncoding('utf8');
					answer.on('data', (chunk) => {
						body += chunk;
					});
					answer.on('end', () => {
						try {
							resolve(JSON.parse(body));
						}
						catch (error) {
							reject(error);
						}
					});
				});
				request.on('timeout', () => request.destroy(new Error('timeout')));
				request.on('error', reject);
			});
		},
		listen(port = config.WEB_PORT, host = '0.0.0.0') {
			return new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen(port, host, () => {
					server.off('error', reject);
					resolve(server.address());
				});
			});
		},
		close() {
			return new Promise(resolve => server.close(() => resolve()));
		},
	};
}
