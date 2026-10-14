import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createPeer, BotUnavailableError } from '../src/rpc/peer.js';
import { attachInternalLink, remoteObject } from '../src/rpc/socket.js';
import { encode, decode } from '../src/rpc/codec.js';
import { createPrincipal } from '../src/core/permissions.js';
import { ValidationError } from '../src/core/errors.js';

const TOKEN = 'x'.repeat(40);
const quiet = { warn: () => undefined };

// Two peers wired back to back (what the websocket does)
function pair(onCall, onEvent = () => undefined) {
	let bot = null;
	const api = createPeer({ send: text => setImmediate(() => bot.handle(text)), onEvent: () => undefined, logger: quiet });
	bot = createPeer({ send: text => setImmediate(() => api.handle(text)), onCall, onEvent, logger: quiet });
	return { api, bot };
}

test('the codec keeps buffers, dates, maps, big integers, errors and actors', () => {
	const actor = { ...createPrincipal({ id: '1', permissions: ['a.b'], level: 3 }), source: 'panel' };
	const value = decode(encode({ file: Buffer.from('hé'), at: new Date(5), map: new Map([['k', 1]]), set: new Set([2]), perms: 8n, error: new ValidationError('Non'), actor }));
	assert.equal(value.file.toString(), 'hé');
	assert.equal(value.at.getTime(), 5);
	assert.equal(value.map.get('k'), 1);
	assert.ok(value.set.has(2));
	assert.equal(value.perms, 8n);
	assert.ok(value.error instanceof ValidationError);
	assert.equal(value.error.message, 'Non');
	assert.equal(value.actor.can('a.b'), true);
	assert.equal(value.actor.can('c.d'), false);
	assert.equal(value.actor.level, 3);
	assert.equal(value.actor.source, 'panel');
	const owner = decode(encode(createPrincipal({ id: '2', isOwner: true })));
	assert.equal(owner.level, Infinity);
	assert.equal(owner.can('anything.at_all'), true);
	assert.throws(() => encode({ fn: () => undefined }), /Functions/);
});

test('calls reach the other end, errors come back with their class', async () => {
	const { api } = pair(async ({ target, method, args }) => {
		if (method === 'fail') throw new ValidationError('Salon introuvable.');
		if (method === 'discord') throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
		return { target, method, size: args[0].length };
	});
	const executor = remoteObject(api, 'executor', { local: { botUserId: () => '42' } });
	assert.deepEqual(await executor.send(Buffer.alloc(3)), { target: 'executor', method: 'send', size: 3 });
	assert.equal(executor.botUserId(), '42');
	assert.equal(executor.then, undefined);
	await assert.rejects(executor.fail(), ValidationError);
	await assert.rejects(executor.discord(), (error) => error.code === 10003);
});

test('a closed link fails pending and new calls with a clear error, events go both ways', async () => {
	const events = [];
	const { api } = pair(() => new Promise(() => undefined), event => events.push(event));
	const pending = api.call('executor', 'slow');
	api.event('audit', { action: 'x' });
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.deepEqual(events, [{ type: 'audit', data: { action: 'x' } }]);
	api.close();
	await assert.rejects(pending, BotUnavailableError);
	await assert.rejects(api.call('executor', 'x'), BotUnavailableError);
});

test('the bot dials the API with the token; a wrong token is refused, other upgrades go on', async () => {
	const server = http.createServer();
	let other = 0;
	server.on('upgrade', (req, socket) => {
		other++;
		socket.destroy();
	});
	const accepted = [];
	const link = attachInternalLink(server, { token: TOKEN, onConnection: ws => accepted.push(ws), logger: quiet });
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const base = `ws://127.0.0.1:${server.address().port}`;

	const intruder = new WebSocket(`${base}/internal/bot`, { headers: { Authorization: `Bearer ${'y'.repeat(40)}` } });
	const [, res] = await once(intruder, 'unexpected-response');
	assert.equal(res.statusCode, 401);
	intruder.on('error', () => undefined);
	intruder.terminate();

	const panel = new WebSocket(`${base}/api/console`);
	await once(panel, 'error').catch(() => undefined);
	assert.equal(other, 1);

	const bot = new WebSocket(`${base}/internal/bot`, { headers: { Authorization: `Bearer ${TOKEN}` }, maxPayload: 64 * 1024 * 1024 });
	await once(bot, 'open');
	assert.equal(accepted.length, 1);
	// Files bigger than the panel's frame limit go through
	const received = once(accepted[0], 'message');
	bot.send(encode({ file: Buffer.alloc(1024 * 1024, 1) }));
	assert.equal(decode(String((await received)[0])).file.length, 1024 * 1024);
	bot.close();
	link.close();
	server.close();
});

test('the internal link refuses to start without a long enough secret', () => {
	assert.throws(() => attachInternalLink(http.createServer(), { token: 'short', onConnection: () => undefined }), /INTERNAL_TOKEN/);
});
