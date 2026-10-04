import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN } from '../helpers.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/core/errors.js';
import { daysOf, median, ticketStats } from '../../src/core/ticketStats.js';

const MEMBER = '300000000000000001';
const HOUR = 3600_000;

async function setup(config = {}) {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['tickets.handle', 'tickets.view'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	core.tickets.saveSettings(owner, MAIN, { maxOpen: 10 });
	const category = await core.tickets.saveCategory(owner, MAIN, { name: 'Support', rankIds: [modo.id], config });
	executor.channels.set('c-tickets', { guildId: MAIN, name: 'logs-tickets' });
	await core.logs.setRoute(owner, MAIN, 'tickets', 'c-tickets');
	const open = () => core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id, subject: 'Aide' });
	return { ...ctx, category, open };
}

// Moves a column of a ticket back in time (no clock injection in the core)
function age(db, ticketId, column, ms) {
	db.prepare(`UPDATE tickets SET ${column} = ${column} - ? WHERE id = ?`).run(ms, ticketId);
}

test('close request: the opener accepts, the ticket closes', async () => {
	const { core, executor, open } = await setup();
	const ticket = await open();
	await assert.rejects(core.tickets.requestClose(MEMBER, ticket.id), ForbiddenError);
	const asked = await core.tickets.requestClose(ALICE, ticket.id, 'Problème réglé');
	assert.equal(asked.closeRequest.by, ALICE);
	assert.equal(asked.closeRequest.reason, 'Problème réglé');
	assert.ok(executor.notices.some(n => n.kind === 'close_request'));
	// Only the opener answers
	await assert.rejects(core.tickets.answerCloseRequest(ALICE, ticket.id, true), ForbiddenError);
	const closed = await core.tickets.answerCloseRequest(MEMBER, ticket.id, true);
	assert.equal(closed.status, 'closed');
	assert.equal(closed.closeReason, 'Problème réglé');
	assert.equal(closed.closeRequest, null);
	assert.equal(core.audit.query({ action: 'tickets.close_request' }).length, 1);
});

test('close request: accepted even when members cannot close their ticket themselves', async () => {
	const { core, open } = await setup({ close: { openerCanClose: false, requireReason: true } });
	const ticket = await open();
	await assert.rejects(core.tickets.close(MEMBER, ticket.id, 'fini'), ForbiddenError);
	await core.tickets.requestClose(ALICE, ticket.id);
	const closed = await core.tickets.answerCloseRequest(MEMBER, ticket.id, true);
	assert.equal(closed.status, 'closed');
	assert.equal(closed.closeReason, 'Fermeture acceptée par le membre');
});

test('close request: refusal cancels it and tells the staff', async () => {
	const { core, executor, open, db } = await setup();
	const ticket = await open();
	await core.tickets.requestClose(ALICE, ticket.id);
	const still = await core.tickets.answerCloseRequest(MEMBER, ticket.id, false);
	assert.equal(still.status, 'open');
	assert.equal(still.closeRequest, null);
	assert.ok(executor.notices.some(n => n.kind === 'close_refused'));
	assert.equal(core.audit.query({ action: 'tickets.close_refused' }).length, 1);
	await assert.rejects(core.tickets.answerCloseRequest(MEMBER, ticket.id, true), /plus de demande/);
	// No auto close afterwards
	age(db, ticket.id, 'created_at', 48 * HOUR);
	await core.tickets.sweep();
	assert.equal(core.tickets.get(ticket.id).status, 'open');
});

test('close request: closed by the bot after the delay of the type, never with 0', async () => {
	const { core, owner, category, open, db } = await setup({ closeRequest: { autoCloseHours: 2 } });
	const ticket = await open();
	await core.tickets.requestClose(ALICE, ticket.id);
	age(db, ticket.id, 'close_request_at', HOUR);
	await core.tickets.sweep();
	assert.equal(core.tickets.get(ticket.id).status, 'open');
	age(db, ticket.id, 'close_request_at', 2 * HOUR);
	await core.tickets.sweep();
	const closed = core.tickets.get(ticket.id);
	assert.equal(closed.status, 'closed');
	assert.equal(closed.closedBy, 'system');
	assert.match(closed.closeReason, /Pas de réponse/);

	await core.tickets.saveCategory(owner, MAIN, { id: category.id, name: 'Support', rankIds: category.rankIds, config: { ...category.config, closeRequest: { autoCloseHours: 0 } } });
	const other = await open();
	await core.tickets.requestClose(ALICE, other.id);
	age(db, other.id, 'close_request_at', 1000 * HOUR);
	await core.tickets.sweep();
	assert.equal(core.tickets.get(other.id).status, 'open');
});

test('the default delay of a close request is 24 h', async () => {
	const { category } = await setup();
	assert.equal(category.config.closeRequest.autoCloseHours, 24);
	assert.equal(category.config.sla.firstResponseMinutes, 0);
});

test('saved replies: managed with tickets.replies, sent with variables filled', async () => {
	const { core, owner, executor, category, open } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => core.tickets.saveReply(alice, MAIN, { name: 'Salut', content: 'x' }), ForbiddenError);
	const reply = core.tickets.saveReply(owner, MAIN, { name: 'Salut', content: 'Bonjour {user}, ticket #{number} ({type}) : {subject}. {staff} s’en occupe. {nope}' });
	assert.throws(() => core.tickets.saveReply(owner, MAIN, { name: 'salut', content: 'doublon' }), ValidationError);
	assert.throws(() => core.tickets.saveReply(owner, MAIN, { name: 'Vide', content: '  ' }), ValidationError);
	const other = await core.tickets.saveCategory(owner, MAIN, { name: 'Autre' });
	const scoped = core.tickets.saveReply(owner, MAIN, { name: 'Autre type', content: 'x', categoryId: other.id });

	const ticket = await open();
	assert.deepEqual(core.tickets.ticketReplies(ticket.id).map(r => r.id), [reply.id]);
	await assert.rejects(core.tickets.sendSavedReply(ALICE, ticket.id, scoped.id), NotFoundError);
	await assert.rejects(core.tickets.sendSavedReply(MEMBER, ticket.id, reply.id), ForbiddenError);

	const text = await core.tickets.sendSavedReply(ALICE, ticket.id, reply.id);
	assert.equal(text, `Bonjour <@${MEMBER}>, ticket #1 (Support) : Aide. <@${ALICE}> s’en occupe. {nope}`);
	assert.equal(executor.replies.at(-1).content, text);
	assert.equal(core.tickets.replies(MAIN).find(r => r.id === reply.id).uses, 1);
	assert.equal(core.audit.query({ action: 'tickets.saved_reply' }).length, 1);
	// A saved reply counts as the first response
	assert.equal(core.tickets.get(ticket.id).firstResponderId, ALICE);
	assert.ok(category);
});

test('saved replies from the panel: the edited text is filled, FiveM keys only from the saved reply', async () => {
	const { core, owner, executor, open } = await setup();
	core.fivemData.discordVars = async () => ({ 'fivem.linked': 'Oui', 'fivem.dbid': 42, 'fivem.citizenid': 'ABC123' });
	core.fivemData.settingsView = () => ({ enabled: true });
	const reply = core.tickets.saveReply(owner, MAIN, { name: 'Dossier', content: 'Ton dbid : {fivem.dbid}' });
	// Without fivemdata.view, nobody adds FiveM data to a saved reply
	const manager = core.ranks.create(owner, { name: 'Gestion', level: 30, permissions: ['tickets.replies', 'tickets.handle'] });
	await core.ranks.assignDirect(owner, '100000000000000005', manager.id);
	const actor = await core.ranks.resolve('100000000000000005');
	assert.throws(() => core.tickets.saveReply(actor, MAIN, { name: 'Leak', content: '{fivem.citizenid}' }), ForbiddenError);

	const ticket = await open();
	const sent = await core.tickets.reply(actor, ticket.id, { content: 'Ton dbid : {fivem.dbid}, citizen {fivem.citizenid}, n°{number}', replyId: reply.id });
	assert.equal(sent.content, 'Ton dbid : 42, citizen {fivem.citizenid}, n°1');
	assert.equal(executor.replies.at(-1).content, sent.content);
	// Plain panel replies are sent as typed
	const plain = await core.tickets.reply(actor, ticket.id, { content: 'Texte {number}' });
	assert.equal(plain.content, 'Texte {number}');
});

test('first response: the first message of someone else than the opener, not the bot', async () => {
	const { core, open } = await setup();
	const ticket = await open();
	const at = Date.now();
	core.tickets.recordMessage(ticket.channelId, { id: 'm1', authorId: MEMBER, content: 'allô', createdAt: at });
	core.tickets.recordMessage(ticket.channelId, { id: 'm2', authorId: '1', bot: true, content: 'bot', createdAt: at + 10 });
	assert.equal(core.tickets.get(ticket.id).firstResponseAt, null);
	core.tickets.recordMessage(ticket.channelId, { id: 'm3', authorId: ALICE, content: 'Je regarde', createdAt: at + 5000 });
	core.tickets.recordMessage(ticket.channelId, { id: 'm4', authorId: '100000000000000009', content: 'moi aussi', createdAt: at + 9000 });
	const after = core.tickets.get(ticket.id);
	assert.equal(after.firstResponseAt, at + 5000);
	assert.equal(after.firstResponderId, ALICE);
});

test('SLA: one alert in the tickets logs when nobody answered in time', async () => {
	const { core, executor, open, db } = await setup({ sla: { firstResponseMinutes: 30 } });
	const ticket = await open();
	await core.tickets.sweep();
	assert.equal(core.audit.query({ action: 'tickets.sla_breach' }).length, 0);
	age(db, ticket.id, 'created_at', 31 * 60_000);
	await core.tickets.sweep();
	await core.tickets.sweep();
	assert.equal(core.audit.query({ action: 'tickets.sla_breach' }).length, 1);
	assert.ok(core.tickets.get(ticket.id).slaBreachedAt > 0);
	await core.logs.flush();
	await new Promise(r => setImmediate(r));
	assert.ok(executor.sent.some(s => s.channelId === 'c-tickets' && s.message.title === 'Délai de première réponse dépassé'));
});

test('SLA: answered late counts as a breach without alert, answered in time is fine', async () => {
	const { core, open, db } = await setup({ sla: { firstResponseMinutes: 30 } });
	const late = await open();
	age(db, late.id, 'created_at', 40 * 60_000);
	core.tickets.recordMessage(late.channelId, { id: 'l1', authorId: ALICE, content: 'désolé', createdAt: Date.now() });
	const fast = await open();
	core.tickets.recordMessage(fast.channelId, { id: 'f1', authorId: ALICE, content: 'ok', createdAt: Date.now() });
	await core.tickets.sweep();
	assert.ok(core.tickets.get(late.id).slaBreachedAt > 0);
	assert.equal(core.tickets.get(fast.id).slaBreachedAt, null);
	assert.equal(core.audit.query({ action: 'tickets.sla_breach' }).length, 0);
	const stats = core.tickets.stats({ guildId: MAIN });
	assert.equal(stats.totals.slaTracked, 2);
	assert.equal(stats.totals.slaBreaches, 1);
});

test('stats: averages, medians, SLA, ratings and per staff', () => {
	const T = Date.UTC(2026, 5, 10, 10);
	const rows = [
		{ id: 1, categoryId: 1, openerId: 'm1', createdAt: T, closedAt: T + 4 * HOUR, closedBy: 'a', claimedBy: 'a', firstResponseAt: T + 10 * 60_000, firstResponderId: 'a', slaBreachedAt: null, rating: 5 },
		{ id: 2, categoryId: 1, openerId: 'm2', createdAt: T + HOUR, closedAt: T + 3 * HOUR, closedBy: 'm2', claimedBy: null, firstResponseAt: T + HOUR + 50 * 60_000, firstResponderId: 'b', slaBreachedAt: T + HOUR + 30 * 60_000, rating: 2 },
		{ id: 3, categoryId: 2, openerId: 'm3', createdAt: T + 2 * HOUR, closedAt: T + 26 * HOUR, closedBy: 'system', claimedBy: 'a', firstResponseAt: T + 2 * HOUR + 30 * 60_000, firstResponderId: 'a', slaBreachedAt: null, rating: null },
		{ id: 4, categoryId: 2, openerId: 'm4', createdAt: T + 25 * HOUR, closedAt: null, closedBy: null, claimedBy: null, firstResponseAt: null, firstResponderId: null, slaBreachedAt: 0, rating: null },
	];
	const stats = ticketStats(rows, { from: T - HOUR, to: T + 30 * HOUR, slaMinutes: id => (id === 1 ? 30 : 0) });
	assert.equal(stats.totals.opened, 4);
	assert.equal(stats.totals.closed, 3);
	assert.equal(stats.totals.answered, 3);
	assert.equal(stats.totals.firstResponseAvg, 30 * 60_000);
	assert.equal(stats.totals.firstResponseMedian, 30 * 60_000);
	assert.equal(stats.totals.resolutionMedian, 4 * HOUR);
	assert.equal(stats.totals.slaTracked, 2);
	assert.equal(stats.totals.slaBreaches, 1);
	assert.equal(stats.totals.ratingAvg, 3.5);
	assert.deepEqual(stats.volume.map(d => [d.day, d.opened, d.closed]), [['2026-06-10', 3, 2], ['2026-06-11', 1, 1]]);
	const a = stats.staff.find(s => s.userId === 'a');
	assert.deepEqual([a.claimed, a.closed, a.answered, a.firstResponseAvg, a.ratingAvg], [2, 1, 2, 20 * 60_000, 5]);
	const b = stats.staff.find(s => s.userId === 'b');
	assert.deepEqual([b.claimed, b.closed, b.answered, b.ratingAvg], [0, 0, 1, 2]);
	assert.equal(stats.staff.some(s => s.userId === 'system' || s.userId === 'm2'), false);
	assert.deepEqual(stats.categories.map(c => [c.categoryId, c.opened, c.slaBreaches]), [[1, 2, 1], [2, 2, 0]]);
});

test('stats helpers: median and days of a period', () => {
	assert.equal(median([]), null);
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([4, 1, 2, 3]), 3);
	const days = daysOf(Date.UTC(2026, 2, 28, 12), Date.UTC(2026, 2, 31, 12));
	assert.deepEqual(days, ['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
});

test('stats from the service: filters by type and refuses an empty period', async () => {
	const { core, owner, open } = await setup();
	const t = await open();
	await core.tickets.claim(ALICE, t.id);
	await core.tickets.close(ALICE, t.id, 'ok');
	const other = await core.tickets.saveCategory(owner, MAIN, { name: 'Autre' });
	assert.equal(core.tickets.stats({ guildId: MAIN }).totals.closed, 1);
	assert.equal(core.tickets.stats({ guildId: MAIN, categoryId: other.id }).totals.opened, 0);
	assert.equal(core.tickets.stats({ guildId: MAIN }).staff[0].userId, ALICE);
	assert.throws(() => core.tickets.stats({ from: Date.now() + 10 * HOUR }), ValidationError);
});
