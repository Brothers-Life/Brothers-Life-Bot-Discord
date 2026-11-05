// Several API replicas behind one address (webgune's load balancer): the bot must link to every replica,
// and a dial landing on a replica already linked must not replace the link that works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createBotLink } from '../src/bot/link.js';
import { createApiLink } from '../src/api/link.js';
import { LINKED_HEADER, INSTANCE_HEADER } from '../src/rpc/socket.js';

const TOKEN = 'r'.repeat(48);
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined, success: () => undefined };
const noop = () => () => undefined;

const until = async (check, ms = 8000) => {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise(resolve => setTimeout(resolve, 20));
	}
};

async function apiReplica() {
	const server = http.createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const link = createApiLink({ config: { INTERNAL_TOKEN: TOKEN }, consoleLog: { ingest: () => undefined }, logger: silent });
	link.listen(server);
	return { server, link, port: server.address().port };
}

// TCP load balancer: each new connection goes to the next replica in turn
async function roundRobin(ports) {
	let turn = 0;
	const sockets = new Set();
	const lb = net.createServer((client) => {
		const upstream = net.connect(ports[turn++ % ports.length], '127.0.0.1');
		sockets.add(client).add(upstream);
		client.pipe(upstream).pipe(client);
		const drop = () => {
			client.destroy();
			upstream.destroy();
		};
		client.on('error', drop).on('close', drop);
		upstream.on('error', drop).on('close', drop);
	});
	lb.listen(0, '127.0.0.1');
	await once(lb, 'listening');
	return {
		url: `http://127.0.0.1:${lb.address().port}`,
		close() {
			for (const socket of sockets) socket.destroy();
			lb.close();
		},
	};
}

function bot(apiUrl) {
	const executor = { status: () => ({ ready: true, ping: 12 }), guildIds: () => [], botUserId: () => 'bot', ping: async () => 'pong' };
	const core = { tickets: { subscribe: noop }, dms: { subscribe: noop }, music: { onChange: noop }, notifications: { subscribe: noop }, audit: { onRecord: noop } };
	const runtime = { info: () => null, installState: () => null };
	return createBotLink({ config: { INTERNAL_TOKEN: TOKEN, API_URL: apiUrl }, core, executor, runtime, consoleLog: { subscribe: noop }, logger: silent });
}

test('behind a load balancer, the bot links to every API replica and each one reaches Discord', async () => {
	const replicas = [await apiReplica(), await apiReplica()];
	const lb = await roundRobin(replicas.map(r => r.port));
	const link = bot(lb.url);
	link.start();
	await until(() => replicas.every(r => r.link.connected));
	assert.equal(link.links, 2);
	for (const replica of replicas) assert.equal(await replica.link.executor.ping(), 'pong');

	// More dials land on linked replicas: refused, the working links stay
	await new Promise(resolve => setTimeout(resolve, 2500));
	assert.equal(link.links, 2);
	assert.ok(replicas.every(r => r.link.connected));

	// A replica goes away: the other keeps its link, the bot links again once it is back
	replicas[0].link.close();
	await until(() => link.links === 1);
	assert.equal(await replicas[1].link.executor.ping(), 'pong');

	await link.close();
	lb.close();
	for (const replica of replicas) {
		replica.link.close();
		replica.server.close();
	}
});

test('a dial naming the replica as already linked is refused with 409, without dropping the link', async () => {
	const replica = await apiReplica();
	const url = `ws://127.0.0.1:${replica.port}/internal/bot`;
	const first = new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
	const upgraded = once(first, 'upgrade');
	const opened = once(first, 'open');
	const [res] = await upgraded;
	const instance = res.headers[INSTANCE_HEADER];
	assert.ok(instance);
	await opened;
	await until(() => replica.link.connected);

	const again = new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}`, [LINKED_HEADER]: `other,${instance}` } });
	again.on('error', () => undefined);
	const [, refused] = await once(again, 'unexpected-response');
	assert.equal(refused.statusCode, 409);
	again.terminate();
	assert.equal(replica.link.connected, true);

	first.close();
	replica.link.close();
	replica.server.close();
});
