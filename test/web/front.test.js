import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { createFrontServer, goesToApi } from '../../src/web/front.js';

const silent = { info: () => undefined, warn: () => undefined };

async function setup({ apiUp = true } = {}) {
	const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'brl-front-'));
	fs.mkdirSync(path.join(dist, 'assets'));
	fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>panel</title>');
	fs.writeFileSync(path.join(dist, 'assets', 'app-123.js'), 'console.log(1)');
	fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');

	const seen = [];
	const api = http.createServer((req, res) => {
		seen.push({ url: req.url, headers: req.headers });
		res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=abc; HttpOnly' });
		res.end(JSON.stringify({ path: req.url, method: req.method }));
	});
	const wss = new WebSocketServer({ server: api });
	wss.on('connection', socket => socket.on('message', data => socket.send(`echo:${data}`)));
	await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
	const apiPort = api.address().port;
	if (!apiUp) await new Promise(resolve => api.close(resolve));

	const front = createFrontServer({ config: { API_URL: `http://127.0.0.1:${apiPort}`, WEB_PORT: 0, INTERNAL_TOKEN: 's'.repeat(40) }, logger: silent, staticDir: dist });
	const { port } = await front.listen(0, '127.0.0.1');
	const base = `http://127.0.0.1:${port}`;
	return { base, port, seen, front, close: async () => {
		await front.close();
		if (apiUp) {
			wss.close();
			await new Promise(resolve => api.close(resolve));
		}
	} };
}

test('the panel files are served, any other page is the React app', async () => {
	const { base, close } = await setup();
	const page = await fetch(`${base}/tickets/12`);
	assert.equal(page.status, 200);
	assert.match(await page.text(), /<title>panel/);
	assert.equal(page.headers.get('cache-control'), 'no-cache');
	assert.equal(page.headers.get('x-frame-options'), 'DENY');
	const asset = await fetch(`${base}/assets/app-123.js`);
	assert.match(asset.headers.get('cache-control'), /immutable/);
	assert.match(asset.headers.get('content-type'), /javascript/);
	assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
	assert.equal((await fetch(`${base}/favicon.svg`)).headers.get('content-type'), 'image/svg+xml');
	await close();
});

test('nothing outside the build folder can be read', async () => {
	const { port, close } = await setup();
	// Raw request: fetch would normalise the path
	const status = await new Promise((resolve) => {
		http.get({ host: '127.0.0.1', port, path: '/assets/..%2f..%2f..%2fetc%2fpasswd' }, res => resolve(res.statusCode));
	});
	assert.equal(status, 404);
	const body = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/etc/passwd`).then(r => r.text());
	assert.doesNotMatch(body, /root:/);
	await close();
});

test('/api and /public go to the API, with the client address and cookies', async () => {
	const { base, seen, close } = await setup();
	const res = await fetch(`${base}/api/me?x=1`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', cookie: 'sid=1' } });
	assert.deepEqual(await res.json(), { path: '/api/me?x=1', method: 'POST' });
	assert.match(res.headers.get('set-cookie'), /sid=abc/);
	assert.equal(seen[0].headers['x-forwarded-for'], '127.0.0.1');
	assert.equal(seen[0].headers['x-forwarded-proto'], 'http');
	assert.equal(seen[0].headers.cookie, 'sid=1');
	await fetch(`${base}/public`);
	assert.equal(seen[1].url, '/public');
	assert.equal(goesToApi('/apidocs'), false);
	await close();
});

test('websockets are passed through to the API', async () => {
	const { port, close } = await setup();
	const socket = new WebSocket(`ws://127.0.0.1:${port}/api/console`);
	await once(socket, 'open');
	socket.send('hi');
	const [data] = await once(socket, 'message');
	assert.equal(String(data), 'echo:hi');
	socket.close();
	await close();
});

test('an API that is down gives a clear error', async () => {
	const { base, close } = await setup({ apiUp: false });
	const res = await fetch(`${base}/api/me`);
	assert.equal(res.status, 502);
	assert.match((await res.json()).error.message, /ne répond pas/);
	await close();
});
