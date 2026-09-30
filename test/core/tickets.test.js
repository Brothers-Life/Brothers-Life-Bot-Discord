import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';

const MEMBER = '300000000000000001';

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['tickets.handle'] });
	core.ranks.setRoleLinks(owner, modo.id, ['800000000000000001']);
	core.tickets.saveSettings(owner, MAIN, { panelChannelId: '610000000000000001', maxOpen: 1 });
	const category = core.tickets.saveCategory(owner, MAIN, { name: 'Support', emoji: '🛟', description: 'Une question', rankIds: [modo.id], roleIds: ['800000000000000009'] });
	executor.channels.set('c-tickets', { guildId: MAIN, name: 'logs-tickets' });
	await core.logs.setRoute(owner, MAIN, 'tickets', 'c-tickets');
	return { ...ctx, modo, category };
}

test('opening a ticket creates a private channel with the category staff', async () => {
	const { core, executor, category } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id, subject: 'Mon grade' });
	assert.equal(ticket.number, 1);
	assert.equal(ticket.status, 'open');
	const channel = executor.ticketChannels.get(ticket.channelId);
	assert.equal(channel.name, 'ticket-0001-bob');
	assert.deepEqual(channel.staffRoleIds.sort(), ['800000000000000001', '800000000000000009']);
	assert.deepEqual(channel.messages, ['welcome']);
	assert.equal(core.audit.query({ action: 'tickets.open' }).length, 1);
});

test('one open ticket per member by default', async () => {
	const { core, category } = await setup();
	await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	await assert.rejects(core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id }), /déjà un ticket/);
	const second = await core.tickets.open({ guildId: MAIN, userId: '300000000000000002', userName: 'eve', categoryId: category.id });
	assert.equal(second.number, 2);
});

test('only staff can claim or add members; the opener can close', async () => {
	const { core, executor, category, owner, modo } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	await assert.rejects(core.tickets.claim(MEMBER, ticket.id), ForbiddenError);

	await core.ranks.assignDirect(owner, ALICE, modo.id);
	const claimed = await core.tickets.claim(ALICE, ticket.id);
	assert.equal(claimed.claimedBy, ALICE);

	// A member with a staff role of the category on Discord, without panel rank
	executor.memberRoles.set(`${MAIN}:${BOB}`, ['800000000000000009']);
	await core.tickets.addMember(BOB, ticket.id, '300000000000000003');
	assert.ok(executor.ticketChannels.get(ticket.channelId).members.includes('300000000000000003'));

	const closed = await core.tickets.close(MEMBER, ticket.id, 'Résolu');
	assert.equal(closed.status, 'closed');
	assert.match(core.tickets.get(ticket.id, { withTranscript: true }).transcript, /alice: bonjour/);
});

test('closing: transcript to the logs and to the opener, channel deleted later', async () => {
	const { core, executor, category } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	executor.sent.length = 0;
	await core.tickets.close(MEMBER, ticket.id);
	await core.logs.flush();
	const log = executor.sent.find(s => s.channelId === 'c-tickets');
	assert.equal(log.message.files[0].name, 'ticket-1.txt');
	assert.equal(executor.dms.at(-1)[0], MEMBER);
	await assert.rejects(core.tickets.close(MEMBER, ticket.id), ValidationError);
});

test('a stranger cannot close someone else’s ticket', async () => {
	const { core, category } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	await assert.rejects(core.tickets.close('300000000000000002', ticket.id), ForbiddenError);
});

test('configuration needs tickets.manage and a network server', async () => {
	const { core } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => core.tickets.saveCategory(alice, MAIN, { name: 'X' }), ForbiddenError);
	const owner = await core.ranks.resolve('100000000000000001');
	assert.throws(() => core.tickets.saveCategory(owner, '900000000000000009', { name: 'X' }), ValidationError);
	assert.throws(() => core.tickets.saveCategory(owner, MAIN, { name: '' }), ValidationError);
});

test('publishing the panel stores the message and reuses it', async () => {
	const { core, owner, executor } = await setup();
	await core.tickets.publishPanel(owner, MAIN);
	await core.tickets.publishPanel(owner, MAIN);
	assert.deepEqual(executor.calls.filter(c => c[0] === 'panel').map(c => c[2]), [null, '600000000000000001']);
});

test('a manually deleted ticket channel closes the ticket', async () => {
	const { core, category } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	core.tickets.markChannelDeleted(ticket.channelId);
	assert.equal(core.tickets.get(ticket.id).status, 'closed');
});
