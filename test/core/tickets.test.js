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
	const category = await core.tickets.saveCategory(owner, MAIN, { name: 'Support', emoji: '🛟', description: 'Une question', rankIds: [modo.id], roleIds: ['800000000000000009'] });
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
	assert.equal(channel.name, '🟢┃ticket-0001-bob');
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
	await assert.rejects(core.tickets.saveCategory(alice, MAIN, { name: 'X' }), ForbiddenError);
	const owner = await core.ranks.resolve('100000000000000001');
	await assert.rejects(core.tickets.saveCategory(owner, '900000000000000009', { name: 'X' }), ValidationError);
	await assert.rejects(core.tickets.saveCategory(owner, MAIN, { name: '' }), ValidationError);
});

test('publishing a panel stores the message and reuses it', async () => {
	const { core, owner, executor, category } = await setup();
	executor.channels.set('610000000000000001', { guildId: MAIN, name: 'support' });
	const panel = await core.tickets.savePanel(owner, MAIN, { name: 'Support', channelId: '610000000000000001', style: 'select', categoryIds: [category.id] });
	await core.tickets.publishPanel(owner, MAIN, panel.id);
	await core.tickets.publishPanel(owner, MAIN, panel.id);
	assert.deepEqual(executor.calls.filter(c => c[0] === 'panel').map(c => c[2]), [null, '600000000000000001']);
	assert.equal(executor.lastPanel.style, 'select');
	assert.deepEqual(executor.lastPanel.categories.map(c => c.id), [category.id]);
});

test('a manually deleted ticket channel closes the ticket', async () => {
	const { core, category } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	core.tickets.markChannelDeleted(ticket.channelId);
	assert.equal(core.tickets.get(ticket.id).status, 'closed');
});

test('each category can send its transcripts to its own channel', async () => {
	const { core, executor, owner } = await setup();
	executor.channels.set('c-transcripts-support', { guildId: MAIN, name: 'transcripts-support' });
	await assert.rejects(core.tickets.saveCategory(owner, MAIN, { name: 'Bad', transcriptChannelId: '123456789012345678' }), ValidationError);
	const support = await core.tickets.saveCategory(owner, MAIN, { name: 'Support 2', transcriptChannelId: 'c-transcripts-support' });
	assert.equal(support.transcriptChannelId, 'c-transcripts-support');

	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: support.id });
	executor.sent.length = 0;
	await core.tickets.close(MEMBER, ticket.id);
	await core.logs.flush();
	await new Promise(r => setImmediate(r));
	assert.deepEqual(executor.sent.map(s => s.channelId).sort(), ['c-tickets', 'c-transcripts-support']);
	const transcript = executor.sent.find(s => s.channelId === 'c-transcripts-support');
	assert.equal(transcript.message.files[0].name, `ticket-${ticket.number}.txt`);
	assert.equal(transcript.message.fields[0].value, 'Support 2');
});

test('no duplicate when the category channel is the tickets log channel', async () => {
	const { core, executor, owner } = await setup();
	const cat = await core.tickets.saveCategory(owner, MAIN, { name: 'Same', transcriptChannelId: 'c-tickets' });
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: cat.id });
	executor.sent.length = 0;
	await core.tickets.close(MEMBER, ticket.id);
	await core.logs.flush();
	await new Promise(r => setImmediate(r));
	assert.deepEqual(executor.sent.map(s => s.channelId), ['c-tickets']);
});

test('ticket texts get member, form and linked FiveM account variables', async () => {
	const { core, owner, executor, category } = await setup();
	core.fivemData.discordVars = async id => (id === MEMBER ? { 'fivem.linked': 'Oui', 'fivem.dbid': 42, 'fivem.citizenid': 'ABC123' } : null);
	await core.tickets.saveCategory(owner, MAIN, {
		id: category.id, name: 'Support', emoji: '🛟', description: 'Une question',
		config: { nameTemplate: '{type}-{fivem.dbid}-{number}', welcome: { title: 'Ticket #{number}', message: '{user} dbid {fivem.dbid} · {fivem.citizenid} · pseudo {answer.pseudo} · inconnu {nope}' } },
	});
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id, answers: [{ id: 'pseudo', label: 'Pseudo', type: 'short', value: 'John_Doe' }] });
	assert.equal(ticket.vars['fivem.dbid'], 42);
	assert.equal(ticket.vars['user.id'], MEMBER);
	assert.equal(ticket.vars['tickets.count'], 0);
	assert.equal(executor.ticketChannels.get(ticket.channelId).name, '🟢┃support-42-0001');
	const welcome = core.tickets.welcomeData(ticket);
	assert.equal(welcome.message, `<@${MEMBER}> dbid 42 · ABC123 · pseudo John_Doe · inconnu {nope}`);
});

test('a slow or broken FiveM database never blocks a ticket', async () => {
	const { core, category } = await setup();
	core.fivemData.discordVars = async () => { throw new Error('ECONNREFUSED'); };
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	assert.equal(ticket.status, 'open');
	assert.equal(ticket.vars['fivem.dbid'], undefined);
});
