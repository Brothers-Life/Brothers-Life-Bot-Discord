import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { isWithinHours, normalizeCategoryConfig } from '../../src/core/ticketConfig.js';
import { normalizeForm, nextStep, readStep } from '../../src/core/forms.js';

const MEMBER = '300000000000000001';
const CAT_OPEN = '620000000000000001';
const CAT_WAIT = '620000000000000002';
const CAT_ARCHIVE = '620000000000000003';

async function setup(config = {}) {
	const ctx = await withNetwork();
	const { core, owner } = ctx;
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['tickets.handle'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	const category = await core.tickets.saveCategory(owner, MAIN, { name: 'Support', parentChannelId: CAT_OPEN, rankIds: [modo.id], config });
	return { ...ctx, category };
}

async function openWithForm(core, category, values) {
	const start = await core.tickets.startOpening({ guildId: MAIN, userId: MEMBER, categoryId: category.id });
	let step = start.step;
	let result;
	for (const stepValues of values) {
		result = core.tickets.submitFormStep({ guildId: MAIN, userId: MEMBER, categoryId: category.id, step, values: stepValues });
		step = result.next;
	}
	return core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id, answers: result.answers });
}

test('forms: several steps, choices and conditional steps', async () => {
	const form = normalizeForm({
		steps: [
			{ questions: [{ id: 'kind', type: 'select', label: 'Type', options: [{ label: 'Bug' }, { label: 'Question' }] }] },
			{ when: { field: 'kind', equals: 'Bug' }, questions: [{ id: 'steps', label: 'Étapes pour reproduire' }] },
			{ questions: [{ id: 'more', type: 'short', label: 'Autre chose ?', required: false }] },
		],
	});
	assert.equal(form.steps[0].questions[0].options[0].value, 'Bug');
	const bug = readStep(form.steps[0], { kind: ['Bug'] });
	assert.equal(nextStep(form, 1, bug), 1);
	const question = readStep(form.steps[0], { kind: ['Question'] });
	assert.equal(nextStep(form, 1, question), 2);
	assert.throws(() => readStep(form.steps[1], { steps: '' }), ValidationError);
	assert.throws(() => normalizeForm({ steps: [{ questions: [] }] }), ValidationError);
});

test('a multi-step form fills the answers of the ticket and its welcome message', async () => {
	const { core, executor, category } = await setup({
		form: { steps: [
			{ questions: [{ id: 'pseudo', type: 'short', label: 'Pseudo en jeu' }] },
			{ questions: [{ id: 'details', label: 'Détails' }] },
		] },
		welcome: { title: 'Ticket {number}', message: 'Salut {user}' },
	});
	const ticket = await openWithForm(core, category, [{ pseudo: 'Bob_RP' }, { details: 'Je suis bloqué' }]);
	assert.deepEqual(ticket.answers.map(a => a.value), ['Bob_RP', 'Je suis bloqué']);
	assert.equal(ticket.subject, 'Bob_RP');
	const welcome = executor.ticketChannels.get(ticket.channelId).welcome;
	assert.equal(welcome.title, 'Ticket 1');
	assert.equal(welcome.message, `Salut <@${MEMBER}>`);
	assert.equal(welcome.answers.length, 2);
});

test('an expired or skipped form step is refused', async () => {
	const { core, category } = await setup();
	assert.throws(() => core.tickets.submitFormStep({ guildId: MAIN, userId: MEMBER, categoryId: category.id, step: 0, values: { subject: 'x' } }), /expiré/);
});

test('access rules: blocked roles, per-type limit and cooldown', async () => {
	const { core, executor, category, owner } = await setup({ access: { blockedRoleIds: ['800000000000000066'], maxOpen: 1, cooldownMinutes: 60 } });
	executor.memberRoles.set(`${MAIN}:${MEMBER}`, ['800000000000000066']);
	await assert.rejects(core.tickets.startOpening({ guildId: MAIN, userId: MEMBER, categoryId: category.id }), /ne peux pas/);
	executor.memberRoles.set(`${MAIN}:${MEMBER}`, []);
	core.tickets.saveSettings(owner, MAIN, { maxOpen: 5 });
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	await assert.rejects(core.tickets.startOpening({ guildId: MAIN, userId: MEMBER, categoryId: category.id }), /déjà 1 ticket/);
	await core.tickets.close(MEMBER, ticket.id);
	await assert.rejects(core.tickets.startOpening({ guildId: MAIN, userId: MEMBER, categoryId: category.id }), /Attends encore/);
});

test('opening hours, with a range spanning midnight', () => {
	const hours = normalizeCategoryConfig({ access: { hours: { enabled: true, timezone: 'UTC', days: Array.from({ length: 7 }, () => ({ open: true, from: '22:00', to: '02:00' })) } } }).access.hours;
	assert.equal(isWithinHours(hours, Date.UTC(2026, 8, 30, 23, 0)), true);
	assert.equal(isWithinHours(hours, Date.UTC(2026, 8, 30, 1, 30)), true);
	assert.equal(isWithinHours(hours, Date.UTC(2026, 8, 30, 12, 0)), false);
});

test('statuses move the channel to their Discord category and keep a history', async () => {
	const { core, executor, category, owner } = await setup({ statusParents: { waiting: CAT_WAIT } });
	core.tickets.saveStatuses(owner, MAIN, [{ key: 'waiting', label: 'En attente du membre', emoji: '⏳' }]);
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	assert.equal(executor.ticketChannels.get(ticket.channelId).parentId, CAT_OPEN);
	await assert.rejects(core.tickets.setStatus(MEMBER, ticket.id, 'waiting'), ForbiddenError);
	const updated = await core.tickets.setStatus(ALICE, ticket.id, 'waiting');
	await new Promise(r => setImmediate(r));
	assert.equal(updated.statusKey, 'waiting');
	assert.deepEqual(updated.statusHistory.map(h => h.key), ['open', 'waiting']);
	const channel = executor.ticketChannels.get(ticket.channelId);
	assert.equal(channel.parentId, CAT_WAIT);
	assert.equal(channel.name, '⏳┃ticket-0001-bob');
	// Built-in statuses are always there
	assert.deepEqual(core.tickets.statuses(MAIN).map(s => s.key), ['waiting', 'open', 'claimed', 'closed']);
});

test('claim with exclusive writing, priority and transfer', async () => {
	const { core, executor, category, owner } = await setup({ claim: { exclusiveWrite: true } });
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	const claimed = await core.tickets.claim(ALICE, ticket.id);
	assert.equal(claimed.statusKey, 'claimed');
	assert.ok(executor.calls.some(c => c[0] === 'writers' && c[2] === ALICE));
	await core.tickets.setPriority(ALICE, ticket.id, 'urgent');
	assert.equal(core.tickets.get(ticket.id).priority, 'urgent');
	await assert.rejects(core.tickets.transfer(ALICE, ticket.id, MEMBER), /staff/);
	const transferred = await core.tickets.transfer(ALICE, ticket.id, owner.id);
	assert.equal(transferred.claimedBy, owner.id);
});

test('close rules: required reason, opener not allowed, archive then reopen', async () => {
	const { core, executor, category, owner } = await setup({ close: { requireReason: true, openerCanClose: false, mode: 'archive' }, statusParents: { closed: CAT_ARCHIVE }, rating: { enabled: true } });
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	await assert.rejects(core.tickets.close(MEMBER, ticket.id, 'fini'), ForbiddenError);
	await assert.rejects(core.tickets.close(ALICE, ticket.id, ''), /raison est obligatoire/);
	const closed = await core.tickets.close(ALICE, ticket.id, 'Résolu');
	await new Promise(r => setImmediate(r));
	assert.equal(closed.archived, true);
	const channel = executor.ticketChannels.get(ticket.channelId);
	assert.ok(channel, 'the channel is kept');
	assert.equal(channel.parentId, CAT_ARCHIVE);
	assert.ok(!channel.members.includes(MEMBER));
	assert.deepEqual(executor.notices.map(n => n.kind), ['archived']);
	assert.deepEqual(executor.ratings, [[MEMBER, ticket.id]]);

	const reopened = await core.tickets.reopen(ALICE, ticket.id);
	assert.equal(reopened.status, 'open');
	assert.ok(executor.ticketChannels.get(ticket.channelId).members.includes(MEMBER));
	await core.tickets.close(ALICE, ticket.id, 'Encore résolu');
	await core.tickets.deleteArchived(owner.id, ticket.id);
	assert.equal(executor.ticketChannels.has(ticket.channelId), false);
});

test('rating: only the opener, once, after closing', async () => {
	const { core, category } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	assert.throws(() => core.tickets.rate(MEMBER, ticket.id, 5), /pas fermé/);
	await core.tickets.close(MEMBER, ticket.id);
	assert.throws(() => core.tickets.rate(ALICE, ticket.id, 5), ForbiddenError);
	core.tickets.rate(MEMBER, ticket.id, 4);
	assert.throws(() => core.tickets.rate(MEMBER, ticket.id, 5), /déjà noté/);
	assert.equal(core.tickets.rateComment(MEMBER, ticket.id, 'Rapide').ratingComment, 'Rapide');
});

test('inactivity: reminder then automatic close', async () => {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	core.tickets.saveSettings(owner, MAIN, {});
	// A service with a controllable clock, on the same database
	const { createTickets } = await import('../../src/core/tickets.js');
	const tickets = createTickets({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, logs: core.logs, logger: { warn: () => undefined, error: () => undefined }, now: () => clock });
	const category = await tickets.saveCategory(owner, MAIN, { name: 'Support', config: { inactivity: { reminderHours: 2, closeHours: 5 } } });
	const ticket = await tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	clock += 3 * 3600_000;
	await tickets.sweep();
	assert.deepEqual(executor.notices.map(n => n.kind), ['reminder']);
	await tickets.sweep();
	assert.equal(executor.notices.length, 1, 'only one reminder');
	clock += 3 * 3600_000;
	await tickets.sweep();
	assert.equal(tickets.get(ticket.id).status, 'closed');
	assert.match(tickets.get(ticket.id).closeReason, /Inactif/);
});

test('live conversation: messages recorded, edited, deleted, panel reply and internal note', async () => {
	const { core, executor, category } = await setup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	const events = [];
	const unsubscribe = core.tickets.subscribe(e => events.push(e.type));

	core.tickets.recordMessage(ticket.channelId, { id: '1', authorId: MEMBER, authorName: 'bob', content: 'Bonjour', createdAt: Date.now() });
	assert.equal(core.tickets.recordMessage('999', { id: '2', content: 'autre salon' }), null);
	core.tickets.updateMessage(ticket.channelId, { id: '1', content: 'Bonjour !' });
	await assert.rejects(core.tickets.reply({ id: MEMBER }, ticket.id, { content: 'x' }), ForbiddenError);
	const alice = await core.ranks.resolve(ALICE);
	await core.tickets.reply(alice, ticket.id, { content: 'On regarde' });
	await core.tickets.reply(alice, ticket.id, { content: 'Joueur connu', internal: true });
	core.tickets.removeMessage(ticket.channelId, '1');

	const messages = core.tickets.messages(ticket.id);
	assert.equal(messages.length, 3);
	assert.equal(messages[0].content, 'Bonjour !');
	assert.ok(messages[0].deletedAt);
	assert.equal(messages[1].panelUser, ALICE);
	assert.equal(messages[2].internal, true);
	assert.equal(executor.replies.length, 1, 'the note is not sent to Discord');
	assert.match(executor.replies[0].username, /· Panel$/);
	assert.deepEqual(events.filter(e => e.startsWith('message')), ['message', 'message_update', 'message', 'message', 'message_delete']);
	unsubscribe();
});
