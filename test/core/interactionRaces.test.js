import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { createFeedback } from '../../src/core/feedback.js';
import { createAbsences } from '../../src/core/absences.js';

// Double clicks on Discord buttons: two interactions run at the same time, only one may act

const MEMBER = '300000000000000001';

const fulfilled = results => results.filter(r => r.status === 'fulfilled').length;

async function ticketSetup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['tickets.handle'] });
	core.tickets.saveSettings(owner, MAIN, { maxOpen: 1 });
	const category = await core.tickets.saveCategory(owner, MAIN, { name: 'Support', rankIds: [modo.id] });
	executor.channels.set('c-tickets', { guildId: MAIN, name: 'logs-tickets' });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	return { ...ctx, category };
}

test('tickets: a double click on the panel opens one ticket, not two (limit per member)', async () => {
	const { core, category } = await ticketSetup();
	const open = () => core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	const results = await Promise.allSettled([open(), open()]);
	assert.equal(fulfilled(results), 1);
	assert.match(results.find(r => r.status === 'rejected').reason.message, /déjà un ticket/);
	assert.equal(core.tickets.list({ guildId: MAIN, openerId: MEMBER, status: 'open' }).length, 1);
});

test('tickets: what the staff actions return never holds the opening variables (FiveM data)', async () => {
	const { core, category } = await ticketSetup();
	const ticket = await core.tickets.open({ guildId: MAIN, userId: MEMBER, userName: 'bob', categoryId: category.id });
	assert.equal(typeof ticket.vars, 'object', 'kept for the bot itself');
	for (const result of [
		await core.tickets.claim(ALICE, ticket.id),
		await core.tickets.setPriority(ALICE, ticket.id, 'high'),
		await core.tickets.setStatus(ALICE, ticket.id, 'open'),
		await core.tickets.close(ALICE, ticket.id, 'ok'),
	]) {
		assert.equal(result.vars, undefined);
	}
});

test('absences: two reviewers clicking at once decide only once', async () => {
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const absences = createAbsences({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, logger: { warn: () => undefined } });
	const helper = core.ranks.create(owner, { name: 'Helper', level: 10, permissions: ['panel.access', 'absences.declare'] });
	await core.ranks.assignDirect(owner, BOB, helper.id);
	const ROLE = '800000000000000077';
	absences.setConfig(owner, { requireApproval: true, review: { guildId: MAIN, channelId: '610000000000000010' }, reviewerRoleIds: [ROLE] });
	const absence = await absences.declare(await core.ranks.resolve(BOB), { endAt: Date.now() + 2 * 86_400_000 });
	const dms = executor.dms.length;
	const results = await Promise.allSettled([
		absences.reviewByButton(ALICE, [ROLE], absence.id, true),
		absences.reviewByButton('100000000000000099', [ROLE], absence.id, false),
	]);
	assert.equal(fulfilled(results), 1);
	assert.equal(executor.dms.length - dms, 1, 'the member gets one answer');
});

test('feedback: a double click on "Publier" publishes once', async () => {
	const { core, executor, owner } = await withNetwork();
	const feedback = createFeedback({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, logger: { warn: () => undefined } });
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['feedback.manage', 'feedback.staff'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	const box = feedback.createBox(owner, MAIN, { preset: 'suggestions', config: { channelId: '610000000000000001', reviewChannelId: '610000000000000003', cooldownMinutes: 0 } });
	const { step } = await feedback.startSubmit(box.id, MEMBER, MAIN);
	const { answers } = feedback.submitStep(box.id, MEMBER, step, { title: 'Idée' });
	const item = await feedback.create({ boxId: box.id, guildId: MAIN, userId: MEMBER, userName: 'lea', answers });
	const results = await Promise.allSettled([feedback.review(ALICE, item.id, true), feedback.review(ALICE, item.id, true)]);
	assert.equal(fulfilled(results), 1);
	const rejected = await Promise.allSettled([feedback.review(ALICE, item.id, false)]);
	assert.equal(fulfilled(rejected), 0, 'an approved item cannot be refused afterwards');
	assert.equal(feedback.get(owner, item.id).approved, true);
});

test('appeals: accepted and refused at the same time: only the first decision counts', async () => {
	const { core, owner, executor } = await withNetwork();
	const TARGET = '300000000000000061';
	executor.members.set(MAIN, new Set([TARGET]));
	core.appeals.setConfig(owner, { enabled: true, guildId: MAIN, channelId: '610000000000000700', types: ['ban'] });
	const sanction = await core.sanctions.create(owner, { type: 'ban', userId: TARGET, reason: 'Triche', durationMs: null });
	const appeal = await core.appeals.submit(TARGET, sanction.id, ['Je ne trichais pas']);
	const dms = executor.dms.length;
	const results = await Promise.allSettled([core.appeals.decide(owner, appeal.id, true), core.appeals.decide(owner, appeal.id, false, 'Non')]);
	assert.equal(fulfilled(results), 1);
	assert.equal(core.appeals.get(appeal.id).status, 'accepted');
	assert.equal(executor.dms.filter((d, i) => i >= dms && d[0] === TARGET && /appel/.test(d[1])).length, 1);
});
