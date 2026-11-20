import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { NETWORK } from '../../src/core/automod/index.js';
import { ForbiddenError } from '../../src/core/errors.js';

const SPAMMER = '300000000000000001';
let nextMessage = 1;
const facts = (over = {}) => ({
	guildId: MAIN, channelId: 'c1', messageId: String(nextMessage++), userId: SPAMMER, userName: 'spammer',
	content: 'hello', mentionCount: 0, attachmentCount: 0, hasEveryone: false, roleIds: [], isBot: false, ...over,
});

async function setup() {
	const ctx = await withNetwork();
	await ctx.core.network.activate(ctx.owner, OTHER);
	ctx.executor.members.set(MAIN, new Set([SPAMMER]));
	ctx.executor.calls.length = 0;
	return ctx;
}

test('a scam link: message deleted and network ban', async () => {
	const { core, executor } = await setup();
	const result = await core.automod.handleMessage(facts({ content: 'Free nitro https://dlscord-gift.com/claim' }));
	assert.equal(result.rule, 'scam');
	assert.equal(executor.deleted.length, 1);
	assert.deepEqual(executor.calls.map(c => [c[0], c[1]]).sort(), [['ban', MAIN], ['ban', OTHER]]);
	assert.equal(result.sanction.source, 'automod');
	assert.equal(result.sanction.moderatorId, 'automod');
	const entry = (await core.audit.query({ action: 'automod.trigger' }))[0];
	assert.equal(entry.actorId, 'automod');
	assert.equal(entry.details.rule, 'scam');
});

test('spam: timeout on the server only, then a cooldown', async () => {
	const { core, executor } = await setup();
	let result = null;
	for (let i = 0; i < 8 && !result; i++) result = await core.automod.handleMessage(facts({ content: `spam ${i}` }));
	assert.equal(result.rule, 'spam');
	assert.deepEqual(executor.calls.map(c => [c[0], c[1], c[3]]), [['timeout', MAIN, 600_000]]);

	// Right after the sanction: messages still deleted, no second sanction
	const again = await core.automod.handleMessage(facts({ content: 'https://dlscord-gift.com' }));
	assert.equal(again.throttled, true);
	assert.equal(executor.calls.length, 1);
});

test('staff with automod.bypass, exempt channels and roles are ignored', async () => {
	const { core, owner, executor } = await setup();
	const staff = await core.ranks.create(owner, { name: 'Staff', level: 10, permissions: ['automod.bypass'] });
	await core.ranks.assignDirect(owner, ALICE, staff.id);
	assert.equal(await core.automod.handleMessage(facts({ userId: ALICE, content: 'https://dlscord-gift.com' })), null);

	await core.automod.setConfig(owner, MAIN, { exemptChannels: ['c-memes'], exemptRoles: ['r-vip'] });
	assert.equal(await core.automod.handleMessage(facts({ channelId: 'c-memes', content: 'https://dlscord-gift.com' })), null);
	assert.equal(await core.automod.handleMessage(facts({ roleIds: ['r-vip'], content: 'https://dlscord-gift.com' })), null);
	assert.equal(executor.deleted.length, 0);
});

test('servers outside the network and bots are ignored', async () => {
	const { core } = await setup();
	assert.equal(await core.automod.handleMessage(facts({ guildId: '900000000000000009', content: 'https://dlscord-gift.com' })), null);
	assert.equal(await core.automod.handleMessage(facts({ isBot: true, content: 'https://dlscord-gift.com' })), null);
});

test('network defaults, server overrides and reset', async () => {
	const { core, owner } = await setup();
	await core.automod.setConfig(owner, NETWORK, { scam: { action: 'kick' }, exemptRoles: ['ignored-at-network-level'] });
	assert.equal((await core.automod.getConfig(OTHER)).scam.action, 'kick');
	assert.deepEqual((await core.automod.getConfig(OTHER)).exemptRoles, []);

	await core.automod.setConfig(owner, OTHER, { scam: { action: 'delete' } });
	assert.equal((await core.automod.getConfig(OTHER)).scam.action, 'delete');
	assert.equal((await core.automod.describe()).guilds.find(g => g.id === OTHER).custom, true);

	await core.automod.resetGuild(owner, OTHER);
	assert.equal((await core.automod.getConfig(OTHER)).scam.action, 'kick');
});

test('configuring needs automod.manage', async () => {
	const { core } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(async () => core.automod.setConfig(alice, NETWORK, {}), ForbiddenError);
});

test('action "delete" only removes the message', async () => {
	const { core, owner, executor } = await setup();
	await core.automod.setConfig(owner, NETWORK, { scam: { action: 'delete' } });
	const result = await core.automod.handleMessage(facts({ content: 'https://dlscord-gift.com' }));
	assert.equal(result.sanction, null);
	assert.equal(executor.deleted.length, 1);
	assert.equal(executor.calls.length, 0);
});

test('invites: network servers allowed by default, extra codes allowed, others removed', async () => {
	const { core, owner, executor } = await setup();
	executor.invites.set('brotherslife', MAIN);
	executor.invites.set('roleplay', OTHER);
	executor.invites.set('ailleurs', '900000000000000099');
	await core.automod.setConfig(owner, NETWORK, { invites: { enabled: true, allowedCodes: ['https://discord.gg/partenaire'] } });

	assert.equal(await core.automod.handleMessage(facts({ content: 'rejoins discord.gg/brotherslife' })), null);
	assert.equal(await core.automod.handleMessage(facts({ content: 'et https://discord.com/invite/roleplay' })), null);
	assert.equal(await core.automod.handleMessage(facts({ content: 'discord.gg/partenaire' })), null, 'extra code, even written as a link');
	const blocked = await core.automod.handleMessage(facts({ userId: '300000000000000002', content: 'discord.gg/ailleurs' }));
	assert.equal(blocked.rule, 'invite');

	await core.automod.setConfig(owner, NETWORK, { invites: { enabled: true, allowNetwork: false } });
	const strict = await core.automod.handleMessage(facts({ userId: '300000000000000003', content: 'discord.gg/brotherslife' }));
	assert.equal(strict.rule, 'invite', 'network invites blocked when the option is off');
});

test('pings: protected ranks, their roles and listed people; replies and plain members pass', async () => {
	const { core, owner, executor } = await setup();
	const STAFF_ROLE = '800000000000000001';
	const VIP = '300000000000000009';
	const modo = await core.ranks.create(owner, { name: 'Modo', level: 40, permissions: [] });
	await core.ranks.setRoleLinks(owner, modo.id, [STAFF_ROLE]);
	executor.memberRoles.set(`${MAIN}:${ALICE}`, [STAFF_ROLE]);
	await core.automod.setConfig(owner, NETWORK, { pings: { enabled: true, protectedRanks: [String(modo.id), 'pas un rang'], protectedUsers: [VIP] } });
	assert.deepEqual((await core.automod.getConfig(MAIN)).pings.protectedRanks, [String(modo.id)]);
	const ping = (userId, over) => core.automod.handleMessage(facts({ userId, content: 'coucou', ...over }));

	const blocked = await ping('300000000000000002', { mentionedUserIds: [ALICE] });
	assert.equal(blocked.rule, 'ping');
	assert.match(blocked.reason, new RegExp(`<@${ALICE}>`));
	assert.equal((await ping('300000000000000003', { mentionedRoleIds: [STAFF_ROLE] })).rule, 'ping');
	assert.equal((await ping('300000000000000004', { mentionedUserIds: [VIP] })).rule, 'ping');

	// A reply to the staff, someone who is not protected, one's own mention, an edited message: nothing
	assert.equal(await ping('300000000000000005', { mentionedUserIds: [ALICE], repliedUserId: ALICE }), null);
	assert.equal(await ping('300000000000000005', { mentionedUserIds: ['300000000000000006'], mentionedRoleIds: ['810000000000000777'] }), null);
	assert.equal(await ping(VIP, { mentionedUserIds: [VIP] }), null);
	assert.equal(await core.automod.handleMessage(facts({ userId: '300000000000000005', mentionedUserIds: [ALICE] }), { edited: true }), null);

	await core.automod.setConfig(owner, NETWORK, { pings: { enabled: true, protectedRanks: [String(modo.id)], allowReplies: false } });
	assert.equal((await ping('300000000000000007', { mentionedUserIds: [ALICE], repliedUserId: ALICE })).rule, 'ping');
});
