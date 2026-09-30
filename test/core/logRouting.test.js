import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { MIRROR } from '../../src/core/logRouting.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';

async function setup() {
	const ctx = await withNetwork();
	ctx.executor.channels.set('c-main-ranks', { guildId: MAIN, name: 'logs-rangs' });
	ctx.executor.channels.set('c-main-network', { guildId: MAIN, name: 'logs-reseau' });
	ctx.executor.channels.set('c-main-mirror', { guildId: MAIN, name: 'miroir' });
	ctx.executor.channels.set('c-other-network', { guildId: OTHER, name: 'logs' });
	return ctx;
}

test('each category goes to its own channel', async () => {
	const { core, executor, owner } = await setup();
	await core.logs.setRoute(owner, MAIN, 'ranks', 'c-main-ranks');
	await core.logs.setRoute(owner, MAIN, 'network', 'c-main-network');
	executor.sent.length = 0;

	core.ranks.create(owner, { name: 'Modo', level: 10, permissions: [] });
	await core.logs.flush();

	assert.deepEqual(executor.sent.map(s => s.channelId), ['c-main-ranks']);
	assert.equal(executor.sent[0].message.title, 'Rang créé');
});

test('a channel must belong to the server', async () => {
	const { core, owner } = await setup();
	await assert.rejects(core.logs.setRoute(owner, MAIN, 'ranks', 'c-other-network'), ValidationError);
	await assert.rejects(core.logs.setRoute(owner, MAIN, 'nope', 'c-main-ranks'), ValidationError);
});

test('needs logs.manage', async () => {
	const { core } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(core.logs.setRoute(alice, MAIN, 'ranks', 'c-main-ranks'), ForbiddenError);
});

test('the network mirror receives other servers logs with a prefix', async () => {
	const { core, executor, owner } = await setup();
	await core.logs.setRoute(owner, OTHER, 'network', 'c-other-network');
	await core.logs.setRoute(owner, MIRROR, 'network', 'c-main-mirror');
	executor.sent.length = 0;

	core.logs.log(OTHER, 'network', { title: 'Test' });
	await core.logs.flush();

	assert.deepEqual(executor.sent.map(s => [s.channelId, s.message.title]), [
		['c-other-network', 'Test'],
		['c-main-mirror', '[Other] Test'],
	]);
});

test('a dead channel disables its routes and raises a system log', async () => {
	const { core, executor, owner } = await setup();
	executor.channels.set('c-system', { guildId: MAIN, name: 'systeme' });
	await core.logs.setRoute(owner, MAIN, 'ranks', 'c-main-ranks');
	await core.logs.setRoute(owner, MAIN, 'system', 'c-system');
	executor.failures.set('c-main-ranks', 10003);
	executor.sent.length = 0;

	core.logs.log(null, 'ranks', { title: 'Test' });
	await core.logs.flush();

	assert.equal(core.logs.routes(MAIN).find(r => r.category === 'ranks').enabled, false);
	assert.deepEqual(executor.sent.map(s => s.channelId), ['c-system']);
	assert.equal(executor.sent[0].message.title, 'Salon de logs désactivé');
});

test('removing a route', async () => {
	const { core, owner } = await setup();
	await core.logs.setRoute(owner, MAIN, 'ranks', 'c-main-ranks');
	await core.logs.setRoute(owner, MAIN, 'ranks', null);
	assert.deepEqual(core.logs.routes(MAIN), []);
});
