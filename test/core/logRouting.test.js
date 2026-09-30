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

test('point by point: one type sent elsewhere or turned off, the rest of its category follows the category route', async () => {
	const { core, executor, owner } = await setup();
	await core.logs.setRoute(owner, MAIN, 'ranks', 'c-main-ranks');
	await core.logs.setRoute(owner, MAIN, 'ranks:delete', 'c-main-network');
	await core.logs.setRoute(owner, MAIN, 'ranks:update', '0');
	executor.sent.length = 0;
	const rank = core.ranks.create(owner, { name: 'Modo', level: 10, permissions: [] });
	core.ranks.update(owner, rank.id, { name: 'Modérateur' });
	core.ranks.remove(owner, rank.id);
	await core.logs.flush();
	assert.deepEqual(executor.sent.map(s => [s.channelId, s.message.title]), [['c-main-ranks', 'Rang créé'], ['c-main-network', 'Rang supprimé']]);

	// Server events too, by their type
	await core.logs.setRoute(owner, MAIN, 'messages', 'c-main-ranks');
	await core.logs.setRoute(owner, MAIN, 'messages:message_edit', '0');
	executor.sent.length = 0;
	core.events.record({ guildId: MAIN, category: 'messages', type: 'message_edit', summary: 'edit' });
	core.events.record({ guildId: MAIN, category: 'messages', type: 'message_delete', summary: 'delete' });
	await core.logs.flush();
	assert.deepEqual(executor.sent.map(s => s.message.title), ['delete']);

	const categories = core.logs.categories();
	assert.ok(categories.find(c => c.key === 'ranks').types.some(t => t.key === 'delete'), 'panel actions are types');
	assert.ok(categories.find(c => c.key === 'discord_moderation').types.some(t => t.key === 'member_ban'));
	await assert.rejects(core.logs.setRoute(owner, MAIN, 'ranks', '0'), ValidationError, 'a whole category is removed, not turned off');
	await assert.rejects(core.logs.setRoute(owner, MAIN, 'nope:x', 'c-main-ranks'), ValidationError);
});

test('packs: private channels created once, every category routed, unlisted ones go to the "rest" channel', async () => {
	const { core, executor, owner } = await setup();
	await core.logs.setRoute(owner, MAIN, 'messages:message_edit', '0');
	const first = await core.logs.applyPack(owner, MAIN, 'complet', { staffRoleIds: ['800000000000000001'] });
	assert.equal(first.created, 8);
	assert.deepEqual(executor.logPacks[0].staffRoleIds, ['800000000000000001']);
	const route = (category) => first.routes.find(r => r.category === category)?.channelId;
	assert.equal(route('sanctions'), first.channels['logs-moderation']);
	assert.equal(route('messages'), first.channels['logs-messages']);
	assert.equal(route('network'), first.channels['logs-bot']);
	assert.equal(route('customcommands'), first.channels['logs-communaute']);
	assert.equal(route('messages:message_edit'), '0', 'type routes are kept');
	const routed = new Set(first.routes.map(r => r.category));
	assert.ok(core.logs.categories().every(c => routed.has(c.key)), 'nothing left without a channel');

	const again = await core.logs.applyPack(owner, MAIN, 'complet');
	assert.equal(again.created, 0, 'channels reused');
	const minimal = await core.logs.applyPack(owner, MAIN, 'minimal');
	assert.ok(minimal.routes.filter(r => !r.category.includes(':')).every(r => r.channelId === minimal.channels.logs));
	await assert.rejects(core.logs.applyPack(owner, MIRROR, 'minimal'), ValidationError);
	await assert.rejects(core.logs.applyPack(owner, MAIN, 'nope'), ValidationError);
});
