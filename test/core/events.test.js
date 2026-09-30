import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ValidationError } from '../../src/core/errors.js';

async function setup() {
	const ctx = await withNetwork();
	ctx.executor.channels.set('c-messages', { guildId: MAIN, name: 'logs-messages' });
	await ctx.core.logs.setRoute(ctx.owner, MAIN, 'messages', 'c-messages');
	ctx.executor.sent.length = 0;
	return ctx;
}

test('events of active servers are stored and posted in their log channel', async () => {
	const { core, executor } = await setup();
	const id = core.events.record({ guildId: MAIN, category: 'messages', type: 'message_delete', userId: ALICE, channelId: '1', summary: 'Message supprimé de alice', details: { content: 'salut' }, message: { title: 'Message supprimé' } });
	assert.ok(id);
	await core.logs.flush();
	assert.deepEqual(executor.sent.map(s => [s.channelId, s.message.title]), [['c-messages', 'Message supprimé']]);
});

test('servers outside the network are ignored', async () => {
	const { core } = await setup();
	assert.equal(core.events.record({ guildId: OTHER, category: 'members', type: 'join', summary: 'x' }), null);
	assert.equal(core.events.query().length, 0);
});

test('search by user, category and text', async () => {
	const { core } = await setup();
	core.events.record({ guildId: MAIN, category: 'messages', type: 'message_edit', userId: ALICE, summary: 'Message modifié', details: { before: 'bonjour', after: 'bonsoir' } });
	core.events.record({ guildId: MAIN, category: 'members', type: 'member_join', userId: '300000000000000001', summary: 'Arrivée de bob' });
	core.events.record({ guildId: MAIN, category: 'roles', type: 'role_update', actorId: ALICE, summary: 'Rôle Modo modifié' });

	assert.equal(core.events.query({ userId: ALICE }).length, 2, 'as user or as author');
	assert.equal(core.events.query({ category: 'members' }).length, 1);
	assert.equal(core.events.query({ q: 'bonsoir' }).length, 1, 'searches details too');
	assert.equal(core.events.query({ q: '100%' }).length, 0, 'wildcards are escaped');
});

test('retention and purge', async () => {
	const { core, owner } = await setup();
	core.events.record({ guildId: MAIN, category: 'members', type: 'member_join', summary: 'old' });
	core.db.prepare('UPDATE events SET at = ?').run(Date.now() - 40 * 86_400_000);
	core.events.record({ guildId: MAIN, category: 'members', type: 'member_join', summary: 'new' });
	assert.equal(core.events.purge(), 1);
	core.events.setRetention(owner, 7);
	assert.equal(core.events.retentionDays(), 7);
	assert.throws(() => core.events.setRetention(owner, 0), ValidationError);
});
