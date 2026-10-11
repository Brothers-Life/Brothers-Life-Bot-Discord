import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogEvent, Collection } from 'discord.js';
import { withNetwork, ALICE, MAIN } from '../helpers.js';
import { messageEdited, messageDeleted, messagesBulkDeleted, memberLeft, memberUpdated, userUpdated, voiceChanged, auditEntry } from '../../src/bot/eventLog.js';

async function setup() {
	const ctx = await withNetwork();
	const guild = { id: MAIN, client: { core: ctx.core }, memberCount: 10 };
	return { ...ctx, guild };
}

const alice = { id: ALICE, username: 'alice', createdTimestamp: Date.now() - 100 * 86_400_000 };

test('edited and deleted messages', async () => {
	const { core, guild } = await setup();
	const channel = { id: '1', name: 'general' };
	await messageEdited({ partial: false, content: 'bonjour' }, { guild, author: alice, content: 'bonsoir', channelId: '1', channel, url: 'https://x' });
	await messageEdited({ partial: false, content: 'same' }, { guild, author: alice, content: 'same', channelId: '1', channel, url: 'https://x' });
	await messageDeleted({ guild, author: alice, partial: false, content: 'secret', channelId: '1', channel, attachments: new Collection() });
	await messageDeleted({ guild, author: null, partial: true, content: null, channelId: '1', channel, attachments: new Collection() });
	await messageEdited({ partial: false, content: 'a' }, { guild, author: { ...alice, bot: true }, content: 'b', channelId: '1', channel, url: '' });

	const events = await core.events.query({ category: 'messages' });
	assert.deepEqual(events.map(e => e.type), ['message_delete', 'message_delete', 'message_edit']);
	assert.equal(events[2].details.after, 'bonsoir');
	assert.equal(events[0].details.content, null, 'uncached message');
});

test('bulk delete, member leave, nickname and voice', async () => {
	const { core, guild } = await setup();
	await messagesBulkDeleted(new Collection([['1', { author: alice }], ['2', { author: alice }]]), { id: '1', name: 'general', guild });
	await memberLeft({ id: ALICE, guild, user: alice, joinedTimestamp: Date.now(), roles: { cache: new Collection([[MAIN, { id: MAIN, name: '@everyone' }], ['r1', { id: 'r1', name: 'Modo' }]]) } });
	await memberUpdated({ partial: false, nickname: null }, { id: ALICE, guild, user: alice, nickname: 'Ali' });
	await voiceChanged({ channelId: null, channel: null }, { id: ALICE, guild, member: { user: alice }, channelId: 'v1', channel: { name: 'Vocal' } });

	const types = (await core.events.query()).map(e => e.type).reverse();
	assert.deepEqual(types, ['message_bulk_delete', 'member_leave', 'member_nickname', 'voice_join']);
	assert.deepEqual((await core.events.query({ category: 'members' })).find(e => e.type === 'member_leave').details.roles, ['Modo']);
});

test('audit log entries: role changes of a member, role update', async () => {
	const { core, guild } = await setup();
	await auditEntry({
		action: AuditLogEvent.MemberRoleUpdate,
		target: alice,
		targetId: ALICE,
		executor: { id: '100000000000000001', username: 'owner' },
		executorId: '100000000000000001',
		changes: [{ key: '$add', new: [{ id: 'r1', name: 'Modo' }] }],
	}, guild);
	await auditEntry({
		action: AuditLogEvent.RoleUpdate,
		target: { id: 'r1', name: 'Modo' },
		targetId: 'r1',
		executorId: '100000000000000001',
		changes: [{ key: 'color', old: 0, new: 16711680 }],
	}, guild);
	await auditEntry({ action: AuditLogEvent.MemberBanAdd, targetId: ALICE, changes: [] }, guild);

	const events = await core.events.query();
	assert.deepEqual(events.map(e => e.type), ['member_ban', 'role_update', 'member_roles_update']);
	events.shift();
	assert.equal(events[1].summary, 'Rôles de alice : +Modo');
	assert.equal(events[1].userId, ALICE);
	assert.equal(events[0].actorId, '100000000000000001');
});

test('more sources: Discord moderation (not the bot own), timeouts, voice mutes, threads, webhooks, streams, boosts, profiles', async () => {
	const { core, guild } = await setup();
	const BOT = '999999999999999999';
	guild.client.user = { id: BOT };
	const by = { executorId: '100000000000000001', executor: { id: '100000000000000001', username: 'owner' } };
	await auditEntry({ action: AuditLogEvent.MemberBanAdd, target: alice, targetId: ALICE, ...by, reason: 'Triche', changes: [] }, guild);
	await auditEntry({ action: AuditLogEvent.MemberBanAdd, target: alice, targetId: ALICE, executorId: BOT, changes: [] }, guild);
	await auditEntry({ action: AuditLogEvent.MemberUpdate, target: alice, targetId: ALICE, ...by, changes: [{ key: 'communication_disabled_until', old: null, new: new Date(Date.now() + 3600_000).toISOString() }] }, guild);
	await auditEntry({ action: AuditLogEvent.MemberUpdate, target: alice, targetId: ALICE, ...by, changes: [{ key: 'mute', old: false, new: true }] }, guild);
	await auditEntry({ action: AuditLogEvent.MemberUpdate, target: alice, targetId: ALICE, ...by, changes: [{ key: 'nick', old: 'a', new: 'b' }] }, guild);
	await auditEntry({ action: AuditLogEvent.ThreadCreate, target: { id: 't1', name: 'Aide' }, targetId: 't1', ...by, changes: [{ key: 'name', new: 'Aide' }] }, guild);
	await auditEntry({ action: AuditLogEvent.WebhookCreate, target: { id: 'w1', name: 'Captain Hook' }, targetId: 'w1', ...by, changes: [] }, guild);
	await voiceChanged({ channelId: 'v1', streaming: false }, { id: ALICE, guild, member: { user: alice }, channelId: 'v1', streaming: true });
	await memberUpdated({ partial: false, nickname: null, avatar: null, premiumSinceTimestamp: null }, { id: ALICE, guild, user: alice, nickname: null, avatar: null, premiumSinceTimestamp: Date.now() });
	const guildWithMember = { ...guild, members: { cache: new Map([[ALICE, {}]]) } };
	await userUpdated({ username: 'alice', globalName: null, avatar: null }, { ...alice, username: 'alice2', globalName: null, avatar: null, client: { guilds: { cache: new Map([[MAIN, guildWithMember]]) } } });

	const events = (await core.events.query()).reverse();
	assert.deepEqual(events.map(e => `${e.category}:${e.type}`), [
		'discord_moderation:member_ban', 'discord_moderation:member_timeout', 'voice:voice_server_mute',
		'threads:thread_create', 'integrations:webhook_create', 'voice:voice_stream', 'members:member_boost', 'members:member_username',
	]);
	assert.equal(events[0].userId, ALICE);
	assert.equal(events[0].actorId, '100000000000000001');
	assert.match(events.at(-1).summary, /alice2/);
});
