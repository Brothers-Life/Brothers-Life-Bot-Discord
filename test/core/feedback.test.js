import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createFeedback } from '../../src/core/feedback.js';

const MEMBER = '300000000000000001';
const C_PUBLIC = '610000000000000001';
const C_STAFF = '610000000000000002';
const C_REVIEW = '610000000000000003';

async function setup() {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const feedback = createFeedback({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, logger: { warn: () => undefined }, now: () => clock });
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['feedback.manage', 'feedback.staff'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	const submit = async (box, userId, values, options) => {
		const { step } = await feedback.startSubmit(box.id, userId, MAIN, options);
		const result = feedback.submitStep(box.id, userId, step, values);
		return feedback.create({ boxId: box.id, guildId: MAIN, userId, userName: 'lea', answers: result.answers, anonymous: result.anonymous });
	};
	return { ...ctx, feedback, submit, advance: (ms) => { clock += ms; } };
}

test('suggestion: form, publication with a thread, votes, status with reason, DM, thread locked', async () => {
	const { feedback, submit, owner, executor } = await setup();
	const box = feedback.createBox(owner, MAIN, { preset: 'suggestions', config: { channelId: C_PUBLIC, cooldownMinutes: 10 } });
	const item = await submit(box, MEMBER, { title: 'Un casino en ville', details: 'Avec des jeux de cartes' });
	assert.equal(item.number, 1);
	assert.equal(item.title, 'Un casino en ville');
	assert.equal(item.threadId, '770000000000000001');
	await assert.rejects(feedback.startSubmit(box.id, MEMBER, MAIN), /Attends encore/);

	await feedback.vote(item.id, ALICE, 1);
	await feedback.vote(item.id, BOB, 1);
	const { item: voted } = await feedback.vote(item.id, '300000000000000009', -1);
	assert.deepEqual([voted.up, voted.down], [2, 1]);
	assert.equal((await feedback.vote(item.id, BOB, 1)).removed, true, 'the same vote twice removes it');

	await assert.rejects(feedback.setStatus(MEMBER, item.id, 'accepted'), ForbiddenError);
	const accepted = await feedback.setStatus(ALICE, item.id, 'accepted', { reason: 'Prévu pour la v2' });
	assert.equal(accepted.statusReason, 'Prévu pour la v2');
	assert.match(executor.dms.at(-1)[1], /Acceptée[\s\S]*Prévu pour la v2/);
	assert.deepEqual(executor.lockedThreads, ['770000000000000001']);
	await assert.rejects(feedback.vote(item.id, ALICE, 1), /close/);
});

test('review before publication, anonymous posts', async () => {
	const { feedback, submit, owner, executor } = await setup();
	const box = feedback.createBox(owner, MAIN, { preset: 'suggestions', config: { channelId: C_PUBLIC, reviewChannelId: C_REVIEW, anonymousAllowed: true, cooldownMinutes: 0 } });
	const item = await submit(box, MEMBER, { title: 'Idée' }, { anonymous: true });
	assert.equal(item.approved, false);
	assert.equal(item.anonymous, true);
	assert.equal(executor.reviews.length, 1);
	const published = await feedback.review(ALICE, item.id, true);
	assert.equal(published.channelId, C_PUBLIC);
	const other = await submit(box, BOB, { title: 'Mauvaise idée' });
	assert.equal(await feedback.review(ALICE, other.id, false), null);
	assert.equal(feedback.list(owner, { boxId: box.id }).length, 1);
});

test('staff bugs: reserved to the staff, urgency ping, assignment, reminder after the delay', async () => {
	const { feedback, submit, owner, executor, advance } = await setup();
	const box = feedback.createBox(owner, MAIN, {
		preset: 'staff',
		config: { channelId: C_STAFF, urgencies: [{ key: 'critical', label: 'Critique', color: '#e5484d', slaMinutes: 30, pingRoleIds: ['800000000000000099'] }, { key: 'low', label: 'Basse', slaMinutes: 0 }] },
	});
	await assert.rejects(feedback.startSubmit(box.id, MEMBER, MAIN), ForbiddenError);
	const bug = await submit(box, ALICE, { title: 'Le bot ne répond plus', details: 'Depuis 10 h', urgency: ['critical'] });
	assert.equal(bug.urgency, 'critical');
	assert.deepEqual(executor.feedbackMessages.at(-1).pingRoleIds, ['800000000000000099']);
	assert.throws(() => feedback.list({ can: () => false }, { boxId: box.id }), ForbiddenError);

	advance(31 * 60_000);
	await feedback.tick();
	assert.match(executor.messages.at(-1).payload.content, /Critique.*toujours sans personne/);
	await feedback.tick();
	assert.equal(executor.messages.length, 1, 'only one reminder');

	const assigned = await feedback.assign(ALICE, bug.id);
	assert.equal(assigned.assigneeId, ALICE);
	assert.equal(assigned.status, 'assigned');
});
