import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createRecruitment } from '../../src/core/recruitment.js';
import { createFormChats } from '../../src/core/formChats.js';
import { createAbsences } from '../../src/core/absences.js';
import { absencePayload } from '../../src/bot/absencesUi.js';

const CANDIDATE = '300000000000000001';
const REVIEW = '610000000000000005';

async function setup() {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const formChats = createFormChats({ db: core.db, executor, logger: { warn: () => undefined }, now: () => clock });
	const recruitment = createRecruitment({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, sanctions: core.sanctions, stats: core.stats, logger: { warn: () => undefined }, now: () => clock, formChats });
	const absences = createAbsences({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, logger: { warn: () => undefined }, now: () => clock });
	const helper = await core.ranks.create(owner, { name: 'Helper', level: 10, permissions: ['panel.access', 'absences.declare'] });
	const recruiter = await core.ranks.create(owner, { name: 'Recruteur', level: 40, permissions: ['recruitment.view', 'recruitment.vote', 'absences.manage', 'absences.view', 'members.assign'] });
	await core.ranks.assignDirect(owner, ALICE, recruiter.id);
	await core.ranks.assignDirect(owner, BOB, helper.id);
	executor.memberRoles.set(`${MAIN}:${CANDIDATE}`, []);
	return { ...ctx, recruitment, formChats, absences, helper, advance: (ms) => { clock += ms; } };
}

async function apply(recruitment, positionId, values) {
	let { step } = await recruitment.startApplication(positionId, CANDIDATE, MAIN);
	let result;
	for (const v of values) {
		result = await recruitment.submitStep(positionId, CANDIDATE, step, v);
		step = result.next;
	}
	return await recruitment.submit({ positionId, guildId: MAIN, userId: CANDIDATE, userName: 'lea', answers: result.answers });
}

test('application: two-step form, review message with a thread, staff votes, DM', async () => {
	const { recruitment, owner, executor } = await setup();
	const position = await recruitment.savePosition(owner, MAIN, { name: 'Modérateur', config: { reviewChannelId: REVIEW, pingRoleIds: ['800000000000000077'] } });
	const app = await apply(recruitment, position.id, [
		{ age: '19', availability: 'Soirs', experience: '2 ans sur un autre serveur' },
		{ why: 'J’aime aider', situation: 'Je calme puis sanctionne' },
	]);
	assert.equal(app.answers.length, 5);
	assert.equal(app.threadId, '810000000000000001');
	assert.match(executor.dms.at(-1)[1], /bien été reçue/);
	await assert.rejects(recruitment.startApplication(position.id, CANDIDATE, MAIN), /déjà une candidature/);

	await recruitment.vote(ALICE, app.id, 1, 'Motivé');
	await assert.rejects(recruitment.vote(CANDIDATE, app.id, 1), ForbiddenError);
	const voted = await recruitment.vote(owner.id, app.id, -1);
	assert.deepEqual(voted.score, { for: 1, against: 1, neutral: 0 });
	assert.deepEqual(executor.applications.at(-1).score, { for: 1, against: 1, neutral: 0 });
});

test('decision: interview channel, acceptance gives roles and rank; cooldown before applying again', async () => {
	const { core, recruitment, owner, executor, helper, advance } = await setup();
	const position = await recruitment.savePosition(owner, MAIN, {
		name: 'Helper',
		config: { form: { steps: [{ questions: [{ id: 'why', label: 'Pourquoi ?' }] }] }, acceptRoleIds: ['800000000000000088'], acceptRankId: helper.id, interviewerRoleIds: ['800000000000000099'], cooldownDays: 7 },
	});
	const app = await apply(recruitment, position.id, [{ why: 'Motivé' }]);
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(recruitment.setStatus(alice, app.id, 'accepted'), ForbiddenError);
	await recruitment.setStatus(owner, app.id, 'interview');
	assert.equal(executor.interviews[0].candidateId, CANDIDATE);
	const accepted = await recruitment.setStatus(owner, app.id, 'accepted', { reason: 'Bienvenue !' });
	assert.equal(accepted.decidedBy, owner.id);
	assert.ok(executor.memberRoles.get(`${MAIN}:${CANDIDATE}`).includes('800000000000000088'));
	assert.deepEqual((await core.ranks.resolve(CANDIDATE)).ranks.map(r => r.name), ['Helper']);
	assert.match(executor.dms.at(-1)[1], /acceptée[\s\S]*Bienvenue/);
	await assert.rejects(recruitment.startApplication(position.id, CANDIDATE, MAIN), /dans 7 jour/);
	advance(8 * 86_400_000);
	await recruitment.startApplication(position.id, CANDIDATE, MAIN);
});

test('requirements are explained and closed positions refuse applications', async () => {
	const { recruitment, owner } = await setup();
	const closed = await recruitment.savePosition(owner, MAIN, { name: 'Dev', config: { open: false } });
	await assert.rejects(recruitment.startApplication(closed.id, CANDIDATE, MAIN), /fermées/);
	const strict = await recruitment.savePosition(owner, MAIN, { name: 'Admin', config: { requirements: { requiredRoleIds: ['800000000000000011'], minMessages: 100 } } });
	await assert.rejects(recruitment.startApplication(strict.id, CANDIDATE, MAIN), /rôle requis[\s\S]*100 messages/);
});

test('absences: pending then approved by a higher rank, applied then ended automatically', async () => {
	const { core, absences, owner, executor, advance } = await setup();
	await absences.setConfig(owner, { requireApproval: true, roleByGuild: { [MAIN]: '800000000000000066' }, nicknamePrefix: '[ABS]', announce: { guildId: MAIN, channelId: '610000000000000009' } });
	executor.memberRoles.set(`${MAIN}:${BOB}`, []);
	const bob = await core.ranks.resolve(BOB);
	const alice = await core.ranks.resolve(ALICE);
	const absence = await absences.declare(bob, { endAt: Date.now() + 3 * 86_400_000, reason: 'Vacances' });
	assert.equal(absence.status, 'pending');
	await assert.rejects(absences.declare(bob, { endAt: Date.now() + 86_400_000 }), /déjà prévue/);
	await assert.rejects(absences.declare(bob, { userId: ALICE, endAt: Date.now() + 86_400_000 }), ForbiddenError);

	const approved = await absences.review(alice, absence.id, true);
	assert.equal(approved.status, 'active');
	assert.ok(executor.memberRoles.get(`${MAIN}:${BOB}`).includes('800000000000000066'));
	assert.ok(executor.calls.some(c => c[0] === 'nickname' && c[3].startsWith('[ABS]')));
	assert.equal(executor.absenceMessages.at(-1).view.kind, 'away');
	assert.equal((await absences.current()).length, 1);

	advance(2 * 86_400_000 + 3600_000);
	await absences.tick();
	assert.match(executor.dms.at(-1)[1], /se termine/);
	advance(86_400_000);
	await absences.tick();
	assert.equal((await absences.current()).length, 0);
	assert.ok(!executor.memberRoles.get(`${MAIN}:${BOB}`).includes('800000000000000066'));
	assert.equal(executor.absenceMessages.at(-1).view.kind, 'back');
});

test('a position can be closed and reopened in one click; its Discord panel follows', async () => {
	const { recruitment, owner } = await setup();
	const position = await recruitment.savePosition(owner, MAIN, { name: 'Helper', panelChannelId: '610000000000000008' });
	await recruitment.publishPanel(owner, MAIN, '610000000000000008');
	const closed = await recruitment.setOpen(owner, position.id, false);
	assert.equal(closed.config.open, false);
	await assert.rejects(recruitment.startApplication(position.id, CANDIDATE, MAIN), /fermées/);
	assert.equal((await recruitment.setOpen(owner, position.id, true)).config.open, true);
	await recruitment.startApplication(position.id, CANDIDATE, MAIN);
});

test('absences: request posted as an embed with Valider / Refuser, only the reviewer roles can decide, never for oneself', async () => {
	const { core, absences, owner, executor } = await setup();
	const STAFF = '610000000000000010';
	const REVIEWER_ROLE = '800000000000000077';
	await absences.setConfig(owner, { requireApproval: true, review: { guildId: MAIN, channelId: STAFF }, reviewerRoleIds: [REVIEWER_ROLE], pingReviewers: true });
	const bob = await core.ranks.resolve(BOB);
	const absence = await absences.declare(bob, { endAt: Date.now() + 2 * 86_400_000, reason: 'Examens' });
	const posted = executor.absenceMessages.at(-1);
	assert.deepEqual([posted.channelId, posted.messageId, posted.view.kind, posted.options.pingRoleIds], [STAFF, null, 'review', [REVIEWER_ROLE]]);
	assert.equal((await absences.list(owner, {}))[0].reviewMessageId, '870000000000000001');

	await assert.rejects(absences.reviewByButton(ALICE, [], absence.id, true), /Seuls les rôles/, 'absences.manage is not enough once roles are set');
	await assert.rejects(absences.reviewByButton(BOB, [REVIEWER_ROLE], absence.id, true), /propre absence/);
	const done = await absences.reviewByButton(ALICE, [REVIEWER_ROLE], absence.id, false);
	assert.equal(done.status, 'rejected');
	const edited = executor.absenceMessages.at(-1);
	assert.deepEqual([edited.messageId, edited.view.absence.status, edited.view.absence.reviewedBy, edited.options.pingRoleIds], ['870000000000000001', 'rejected', ALICE, []]);
	await assert.rejects(absences.reviewByButton(ALICE, [REVIEWER_ROLE], absence.id, true), /déjà été traitée/);
	const buttons = (a) => absencePayload({ kind: 'review', absence: a }).components.flatMap(row => row.toJSON().components.map(c => c.custom_id));
	assert.deepEqual(buttons(absence), [`abs:approve:${absence.id}`, `abs:reject:${absence.id}`]);
	assert.deepEqual(buttons(done), [], 'no buttons once decided');
	assert.match(absencePayload({ kind: 'review', absence: done }).embeds[0].toJSON().fields.at(-1).value, /Refusée par/);

	// Without reviewer roles: whoever has absences.manage
	await absences.setConfig(owner, { requireApproval: true, review: { guildId: MAIN, channelId: STAFF } });
	const next = await absences.declare(bob, { startAt: Date.now() + 5 * 86_400_000, endAt: Date.now() + 6 * 86_400_000 });
	assert.equal((await absences.reviewByButton(ALICE, [], next.id, true)).status, 'approved');
	assert.match(executor.dms.at(-1)[1], /validée/);
});

test('decision: the candidate leaves the interview channel; the delay counts from the decision and ignores a withdrawal', async () => {
	const { recruitment, owner, executor, advance } = await setup();
	const removed = [];
	executor.removeChannelMember = async (channelId, userId) => {
		removed.push([channelId, userId]);
	};
	const position = await recruitment.savePosition(owner, MAIN, { name: 'Helper', config: { form: { steps: [{ questions: [{ id: 'why', label: 'Pourquoi ?' }] }] }, cooldownDays: 7 } });

	// Withdrawn: no delay, and the interview channel is closed to the candidate
	const first = await apply(recruitment, position.id, [{ why: 'Motivé' }]);
	await recruitment.setStatus(owner, first.id, 'interview');
	await recruitment.setStatus({ id: CANDIDATE, can: () => false }, first.id, 'withdrawn');
	assert.deepEqual(removed, [['830000000000000001', CANDIDATE]]);

	// Decided 10 days after applying: the 7 days count from the decision
	const second = await apply(recruitment, position.id, [{ why: 'Encore motivé' }]);
	advance(10 * 86_400_000);
	await recruitment.setStatus(owner, second.id, 'interview');
	await recruitment.setStatus(owner, second.id, 'rejected', { reason: 'Pas assez d’expérience' });
	assert.equal(removed.length, 2);
	assert.match(executor.dms.at(-1)[1], /pas été retenue[\s\S]*Pas assez d’expérience/);
	await assert.rejects(recruitment.startApplication(position.id, CANDIDATE, MAIN), /dans 7 jour/);
	advance(7 * 86_400_000 + 60_000);
	await recruitment.startApplication(position.id, CANDIDATE, MAIN);
});

test('application in private messages: one question at a time, choices by number, optional and invalid answers', async () => {
	const { recruitment, owner, executor, advance } = await setup();
	const long = 'Un joueur t’insulte en vocal pendant une scène alors que tu es seul en service : comment réagis-tu et dans quel ordre ?';
	const position = await recruitment.savePosition(owner, MAIN, { name: 'Modérateur', config: { mode: 'chat', reviewChannelId: REVIEW, form: { steps: [
		{ questions: [
			{ id: 'age', type: 'short', label: 'Ton âge', maxLength: 3 },
			{ id: 'kind', type: 'select', label: 'Tu vises quel pôle ?', options: [{ label: 'Modération' }, { label: 'Animation' }] },
		] },
		{ when: { field: 'kind', equals: 'Animation' }, questions: [{ id: 'idea', label: 'Une idée d’événement ?' }] },
		{ questions: [{ id: 'case', label: long, maxLength: 1500 }, { id: 'more', label: 'Autre chose ?', required: false }] },
	] } } });
	assert.equal(position.config.mode, 'chat');
	const say = content => recruitment.chatMessage({ userId: CANDIDATE, content });
	const last = () => executor.dms.at(-1)[1];

	// Nothing in progress: the message is an ordinary private message
	assert.equal(await say('bonjour'), false);
	assert.equal((await recruitment.startChat(position.id, CANDIDATE, MAIN, 'lea')).sent, true);
	assert.match(last(), /Candidature : Modérateur[\s\S]*Question 1\*\* — Ton âge/);

	assert.equal(await say('dix-neuf ans'), true);
	assert.match(last(), /maximum est 3/);
	await say('19');
	assert.match(last(), /Question 2\*\* — Tu vises quel pôle[\s\S]*`1` Modération[\s\S]*`2` Animation/);
	await say('Animation');
	assert.match(last(), /numéro entre 1 et 2/);
	await say('1');
	// The step for "Animation" is skipped, the long question is written in full
	assert.ok(last().includes(long));
	await say('Je calme, je préviens, puis je sanctionne.');
	assert.match(last(), /Autre chose \?[\s\S]*passer/);
	await say('passer');
	assert.match(last(), /bien été reçue/);
	assert.equal(await say('merci'), false);

	const [application] = await recruitment.list(owner, { guildId: MAIN });
	assert.deepEqual(application.answers.map(a => a.value), ['19', 'Modération', 'Je calme, je préviens, puis je sanctionne.', '']);
	assert.equal(application.answers[2].label, long);
	assert.equal(application.userName, 'lea');
	await assert.rejects(recruitment.startChat(position.id, CANDIDATE, MAIN), /déjà une candidature/);

	// Cancelled, expired, private messages closed
	const other = await recruitment.savePosition(owner, MAIN, { name: 'Helper', config: { mode: 'chat', form: { steps: [{ questions: [{ id: 'why', label: 'Pourquoi ?' }] }] } } });
	await recruitment.startChat(other.id, CANDIDATE, MAIN, 'lea');
	await say('Annuler');
	assert.match(last(), /annulée/);
	assert.equal(await say('trop tard'), false);
	await recruitment.startChat(other.id, CANDIDATE, MAIN, 'lea');
	advance(61 * 60_000);
	assert.equal(await say('Motivé'), true);
	assert.match(last(), /expiré/);
	executor.sendDM = async () => {
		throw new Error('Cannot send messages to this user');
	};
	assert.equal((await recruitment.startChat(other.id, CANDIDATE, MAIN, 'lea')).sent, false);
	assert.equal(await say('Motivé'), false);
	assert.equal((await recruitment.list(owner, { guildId: MAIN })).length, 1);
});

test('application in a private channel: the questions are asked there, then it is the interview channel', async () => {
	const { core, recruitment, formChats, owner, executor, advance } = await setup();
	const CHANNEL = '830000000000000001';
	const deleted = [];
	executor.deleteChannel = async (channelId) => {
		deleted.push(channelId);
	};
	const position = await recruitment.savePosition(owner, MAIN, { name: 'Modérateur', config: { interviewerRoleIds: ['800000000000000099'], form: { steps: [{ questions: [{ id: 'why', label: 'Pourquoi toi ?' }, { id: 'age', type: 'short', label: 'Ton âge' }] }] } } });
	assert.equal(position.config.mode, 'channel');
	const say = (content, userId = CANDIDATE) => formChats.message({ channelId: CHANNEL, userId, content });
	const last = () => executor.messages.at(-1).payload.content;

	const started = await recruitment.startChat(position.id, CANDIDATE, MAIN, 'lea');
	assert.equal(started.channelId, CHANNEL);
	assert.equal(executor.interviews.at(-1).name, 'candidature-lea');
	assert.deepEqual(executor.interviews.at(-1).staffRoleIds, ['800000000000000099']);
	assert.match(last(), /Question 1\/2\*\* — Pourquoi toi/);
	// A second click goes back to the same channel, and only the candidate answers
	assert.equal((await recruitment.startChat(position.id, CANDIDATE, MAIN, 'lea')).channelId, CHANNEL);
	assert.equal(executor.interviews.length, 1);
	assert.equal(await say('Il a l’air bien', ALICE), false);

	// Given up or left without an answer: the channel is deleted
	await say('annuler');
	assert.deepEqual(deleted, [CHANNEL]);
	await recruitment.startChat(position.id, CANDIDATE, MAIN, 'lea');
	advance(61 * 60_000);
	await formChats.tick();
	assert.deepEqual(deleted, [CHANNEL, CHANNEL]);
	assert.equal(await say('Motivé'), false);

	// The progress survives a restart of the bot
	await recruitment.startChat(position.id, CANDIDATE, MAIN, 'lea');
	assert.equal(await say('Motivé'), true);
	assert.match(last(), /Question 2\/2\*\* — Ton âge/);
	const restarted = createFormChats({ db: core.db, executor, logger: { warn: () => undefined } });
	const again = createRecruitment({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, sanctions: core.sanctions, stats: core.stats, logger: { warn: () => undefined }, formChats: restarted });
	await restarted.init();
	assert.equal(await restarted.message({ channelId: CHANNEL, userId: CANDIDATE, content: '19' }), true);
	assert.match(last(), /candidature est envoyée/);

	const [application] = await again.list(owner, { guildId: MAIN });
	assert.deepEqual(application.answers.map(a => a.value), ['Motivé', '19']);
	assert.equal(application.interviewChannelId, CHANNEL);
	const created = executor.interviews.length;
	await again.setStatus(owner, application.id, 'interview');
	assert.equal(executor.interviews.length, created);
});

test('application channel: closed and reopened by the recruiters, closed by the decision, deleted by hand or after the delay', async () => {
	const { core, recruitment, owner, executor, advance } = await setup();
	const CHANNEL = '830000000000000001';
	const RECRUITER_ROLE = '800000000000000099';
	const deleted = [];
	const access = [];
	const files = [];
	executor.deleteChannel = async (channelId) => {
		deleted.push(channelId);
	};
	executor.removeChannelMember = async (channelId, userId) => {
		access.push(['remove', userId]);
	};
	executor.addChannelMember = async (channelId, userId) => {
		access.push(['add', userId]);
	};
	executor.sendLog = async (channelId, message) => {
		files.push(...message.files ?? []);
	};
	executor.history.set(CHANNEL, [{ id: '1', authorId: CANDIDATE, authorName: 'lea', authorAvatar: null, bot: false, content: 'Bonjour le staff', createdAt: 1_700_000_000_000, attachments: [], embeds: [] }]);
	executor.memberRoles.set(`${MAIN}:${BOB}`, [RECRUITER_ROLE]);
	const position = await recruitment.savePosition(owner, MAIN, {
		name: 'Helper',
		config: { reviewChannelId: REVIEW, interviewerRoleIds: [RECRUITER_ROLE], channelDeleteMinutes: 120, form: { steps: [{ questions: [{ id: 'why', label: 'Pourquoi ?' }] }] } },
	});
	assert.equal(position.config.channelDeleteMinutes, 120);
	const alice = await core.ranks.resolve(ALICE);
	const bob = await core.ranks.resolve(BOB);
	const state = async id => (await recruitment.get(owner, id)).interviewState;

	const app = await apply(recruitment, position.id, [{ why: 'Motivé' }]);
	assert.equal(await state(app.id), null);
	await assert.rejects(recruitment.closeChannel(alice, app.id), /pas de salon/);
	await recruitment.setStatus(owner, app.id, 'interview');
	assert.equal(await state(app.id), 'open');
	assert.equal(executor.interviewNotices.at(-1).kind, 'interview');

	// Closed by a recruiter (rank or recruiter role of the position), never by the candidate
	await assert.rejects(recruitment.closeChannel({ id: CANDIDATE, can: () => false }, app.id), ForbiddenError);
	await assert.rejects(recruitment.deleteChannel(alice, app.id), /Ferme d’abord/);
	assert.equal((await recruitment.closeChannel(alice, app.id)).interviewState, 'closed');
	assert.deepEqual(access.at(-1), ['remove', CANDIDATE]);
	assert.equal(executor.interviewNotices.at(-1).kind, 'closed');
	assert.ok(executor.interviewNotices.at(-1).deleteAt);
	await assert.rejects(recruitment.closeChannel(alice, app.id), /déjà fermé/);

	// Reopened: the candidate is back, and nothing is deleted while it is open
	assert.equal((await recruitment.reopenChannel(bob, app.id)).interviewState, 'open');
	assert.deepEqual(access.at(-1), ['add', CANDIDATE]);
	await assert.rejects(recruitment.reopenChannel(bob, app.id), /déjà ouvert/);
	advance(5 * 3600_000);
	await recruitment.tick();
	assert.deepEqual(deleted, []);

	// The decision closes it; it is deleted 2 hours later, the conversation kept as a file
	await recruitment.setStatus(owner, app.id, 'rejected');
	assert.equal(await state(app.id), 'closed');
	advance(3600_000);
	await recruitment.tick();
	assert.deepEqual(deleted, []);
	advance(3600_000 + 60_000);
	await recruitment.tick();
	assert.deepEqual(deleted, [CHANNEL]);
	assert.match(files.at(-1).content, /Bonjour le staff/);
	const after = await recruitment.get(owner, app.id);
	assert.equal(after.interviewChannelId, null);
	assert.equal(after.interviewState, null);
	await assert.rejects(recruitment.reopenChannel(alice, app.id), /plus de salon/);

	// Delay at 0: kept until a recruiter deletes it
	await recruitment.savePosition(owner, MAIN, { ...position, config: { ...position.config, channelDeleteMinutes: 0, cooldownDays: 0 } });
	const second = await apply(recruitment, position.id, [{ why: 'Encore' }]);
	await recruitment.setStatus(owner, second.id, 'interview');
	await recruitment.setStatus(owner, second.id, 'rejected');
	advance(30 * 86_400_000);
	await recruitment.tick();
	assert.equal(deleted.length, 1);
	// Refused by Discord: said to the recruiter, and the channel stays closed (it can be deleted again)
	executor.deleteChannel = async () => {
		throw new Error('Missing Permissions');
	};
	await assert.rejects(recruitment.deleteChannel(alice, second.id), /Discord a refusé[\s\S]*Missing Permissions/);
	assert.equal(await state(second.id), 'closed');
	assert.deepEqual(await recruitment.deleteClosedChannels(owner, MAIN).then(r => [r.deleted, r.failed]), [0, 1]);
	executor.deleteChannel = async (channelId) => {
		deleted.push(channelId);
	};
	await assert.rejects(recruitment.deleteClosedChannels(alice, MAIN), ForbiddenError);
	assert.deepEqual(await recruitment.deleteClosedChannels(owner, MAIN).then(r => [r.deleted, r.failed]), [1, 0]);
	assert.equal(deleted.length, 2);
	await assert.rejects(recruitment.deleteChannel(alice, second.id), /plus de salon/);

	// The automatic deletion does not insist when Discord refuses
	await recruitment.savePosition(owner, MAIN, { ...position, config: { ...position.config, channelDeleteMinutes: 5, cooldownDays: 0 } });
	const third = await apply(recruitment, position.id, [{ why: 'Toujours' }]);
	await recruitment.setStatus(owner, third.id, 'interview');
	await recruitment.setStatus(owner, third.id, 'rejected');
	let tries = 0;
	executor.deleteChannel = async () => {
		tries += 1;
		throw new Error('Missing Permissions');
	};
	advance(6 * 60_000);
	await recruitment.tick();
	advance(6 * 60_000);
	await recruitment.tick();
	assert.equal(tries, 1);
	assert.equal(await state(third.id), 'closed');
});
