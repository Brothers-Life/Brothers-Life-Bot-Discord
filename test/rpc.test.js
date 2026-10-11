import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRpcServer } from '../src/rpc/server.js';
import { createRpcClient, remoteObject, BotUnavailableError } from '../src/rpc/client.js';
import { encode, decode } from '../src/rpc/codec.js';
import { createPrincipal } from '../src/core/permissions.js';
import { ValidationError } from '../src/core/errors.js';

const TOKEN = 'x'.repeat(40);

async function setup(handlers) {
	const server = createRpcServer({ token: TOKEN, host: '127.0.0.1', port: 0, handlers, logger: { warn: () => undefined } });
	const address = await server.listen();
	const client = createRpcClient({ url: `http://127.0.0.1:${address.port}`, token: TOKEN, logger: { warn: () => undefined } });
	return { server, client, port: address.port };
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

test('calls reach the handler, errors come back with their class', async () => {
	const { server, client } = await setup({
		async call({ target, method, args }) {
			if (method === 'fail') throw new ValidationError('Salon introuvable.');
			if (method === 'discord') throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
			return { target, method, size: args[0].length };
		},
	});
	const executor = remoteObject(client, 'executor', { local: { botUserId: () => '42' } });
	assert.deepEqual(await executor.send(Buffer.alloc(3)), { target: 'executor', method: 'send', size: 3 });
	assert.equal(executor.botUserId(), '42');
	assert.equal(executor.then, undefined);
	await assert.rejects(executor.fail(), ValidationError);
	await assert.rejects(executor.discord(), (error) => error.code === 10003);
	await server.close();
});

test('a wrong token is refused, a stopped bot gives a clear error', async () => {
	const { server, port } = await setup({ async call() { return 1; } });
	const intruder = createRpcClient({ url: `http://127.0.0.1:${port}`, token: 'y'.repeat(40) });
	await assert.rejects(intruder.call('executor', 'x'), /Unauthorized/);
	await server.close();
	const client = createRpcClient({ url: `http://127.0.0.1:${port}`, token: TOKEN });
	await assert.rejects(client.call('executor', 'x'), BotUnavailableError);
});

test('events are streamed to the API, starting with the welcome ones', async () => {
	const { server, client } = await setup({ call: async () => undefined, async welcome() { return [{ type: 'snapshot', data: { botUserId: '42' } }]; } });
	const snapshot = once(client.events, 'snapshot');
	client.start();
	assert.deepEqual((await snapshot)[0], { botUserId: '42' });
	const next = once(client.events, 'ticket');
	server.broadcast({ type: 'ticket', data: { id: 7, file: Buffer.from('x') } });
	const [data] = await next;
	assert.equal(data.id, 7);
	assert.equal(data.file.toString(), 'x');
	client.close();
	await server.close();
});

test('the internal link refuses to start without a long enough secret', () => {
	assert.throws(() => createRpcServer({ token: 'short', handlers: {} }), /INTERNAL_TOKEN/);
});
