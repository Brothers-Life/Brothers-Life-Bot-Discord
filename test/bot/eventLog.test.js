import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogEvent, Collection } from 'discord.js';
import { withNetwork, ALICE, MAIN } from '../helpers.js';
import { messageEdited, messageDeleted, messagesBulkDeleted, memberLeft, memberUpdated, voiceChanged, auditEntry } from '../../src/bot/eventLog.js';

async function setup() {
	const ctx = await withNetwork();
	const guild = { id: MAIN, client: { core: ctx.core }, memberCount: 10 };
	return { ...ctx, guild };
}

const alice = { id: ALICE, username: 'alice', createdTimestamp: Date.now() - 100 * 86_400_000 };

test('edited and deleted messages', async () => {
	const { core, guild } = await setup();
	const channel = { id: '1', name: 'general' };
	messageEdited({ partial: false, content: 'bonjour' }, { guild, author: alice, content: 'bonsoir', channelId: '1', channel, url: 'https://x' });
	messageEdited({ partial: false, content: 'same' }, { guild, author: alice, content: 'same', channelId: '1', channel, url: 'https://x' });
	messageDeleted({ guild, author: alice, partial: false, content: 'secret', channelId: '1', channel, attachments: new Collection() });
	messageDeleted({ guild, author: null, partial: true, content: null, channelId: '1', channel, attachments: new Collection() });
	messageEdited({ partial: false, content: 'a' }, { guild, author: { ...alice, bot: true }, content: 'b', channelId: '1', channel, url: '' });

	const events = core.events.query({ category: 'messages' });
	assert.deepEqual(events.map(e => e.type), ['message_delete', 'message_delete', 'message_edit']);
	assert.equal(events[2].details.after, 'bonsoir');
	assert.equal(events[0].details.content, null, 'uncached message');
});

test('bulk delete, member leave, nickname and voice', async () => {
	const { core, guild } = await setup();
	messagesBulkDeleted(new Collection([['1', { author: alice }], ['2', { author: alice }]]), { id: '1', name: 'general', guild });
	memberLeft({ id: ALICE, guild, user: alice, joinedTimestamp: Date.now(), roles: { cache: new Collection([[MAIN, { id: MAIN, name: '@everyone' }], ['r1', { id: 'r1', name: 'Modo' }]]) } });
	memberUpdated({ partial: false, nickname: null }, { id: ALICE, guild, user: alice, nickname: 'Ali' });
	voiceChanged({ channelId: null, channel: null }, { id: ALICE, guild, member: { user: alice }, channelId: 'v1', channel: { name: 'Vocal' } });

	const types = core.events.query().map(e => e.type).reverse();
	assert.deepEqual(types, ['message_bulk_delete', 'member_leave', 'member_nickname', 'voice_join']);
	assert.deepEqual(core.events.query({ category: 'members' }).find(e => e.type === 'member_leave').details.roles, ['Modo']);
});

test('audit log entries: role changes of a member, role update', async () => {
	const { core, guild } = await setup();
	auditEntry({
		action: AuditLogEvent.MemberRoleUpdate,
		target: alice,
		targetId: ALICE,
		executor: { id: '100000000000000001', username: 'owner' },
		executorId: '100000000000000001',
		changes: [{ key: '$add', new: [{ id: 'r1', name: 'Modo' }] }],
	}, guild);
	auditEntry({
		action: AuditLogEvent.RoleUpdate,
		target: { id: 'r1', name: 'Modo' },
		targetId: 'r1',
		executorId: '100000000000000001',
		changes: [{ key: 'color', old: 0, new: 16711680 }],
	}, guild);
	auditEntry({ action: AuditLogEvent.MemberBanAdd, targetId: ALICE, changes: [] }, guild);

	const events = core.events.query();
	assert.deepEqual(events.map(e => e.type), ['role_update', 'member_roles_update']);
	assert.equal(events[1].summary, 'Rôles de alice : +Modo');
	assert.equal(events[1].userId, ALICE);
	assert.equal(events[0].actorId, '100000000000000001');
});
