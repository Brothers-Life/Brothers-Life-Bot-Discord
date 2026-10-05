import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createAbsences } from '../../src/core/absences.js';
import { rejectModal } from '../../src/bot/absencesUi.js';

const DAY = 86_400_000;
const ABS_ROLE = '800000000000000066';
const REVIEWER_ROLE = '800000000000000077';
const STAFF = '610000000000000010';

async function setup() {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const absences = createAbsences({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, logger: { warn: () => undefined }, now: () => clock });
	const helper = core.ranks.create(owner, { name: 'Helper', level: 10, permissions: ['panel.access', 'absences.declare'] });
	const manager = core.ranks.create(owner, { name: 'Responsable', level: 40, permissions: ['absences.manage', 'absences.view'] });
	await core.ranks.assignDirect(owner, ALICE, manager.id);
	await core.ranks.assignDirect(owner, BOB, helper.id);
	executor.memberRoles.set(`${MAIN}:${BOB}`, []);
	return { ...ctx, absences, at: () => clock, advance: (ms) => { clock += ms; }, bob: () => core.ranks.resolve(BOB), alice: () => core.ranks.resolve(ALICE) };
}

test('the list of absent staff (with reasons) needs absences.view', async () => {
	const { absences, owner, bob, alice } = await setup();
	await absences.declare(owner, { userId: BOB, endAt: Date.now() + 2 * DAY, reason: 'Vacances' });
	const member = await bob();
	assert.throws(() => absences.currentFor(member), ForbiddenError);
	assert.throws(() => absences.currentFor({ id: '1', can: () => false }), /absences\.view/);
	assert.equal(absences.currentFor(await alice()).length, 1);
});

test('cancel: only an absence not started yet, one\'s own', async () => {
	const { absences, at, bob } = await setup();
	const me = await bob();
	const later = await absences.declare(me, { startAt: at() + 3 * DAY, endAt: at() + 5 * DAY });
	const sooner = await absences.declare(me, { startAt: at() + DAY, endAt: at() + 2 * DAY });
	assert.deepEqual(absences.upcomingFor(BOB).map(a => a.id), [sooner.id, later.id], 'soonest first');
	await assert.rejects(absences.cancel({ id: '100000000000000099', can: () => false }, later.id), ForbiddenError);
	assert.equal((await absences.cancel(me, sooner.id)).status, 'cancelled');
	await assert.rejects(absences.cancel(me, sooner.id), /déjà terminée ou annulée/);
	await assert.rejects(absences.declare(me, { endAt: at() + 4 * DAY }), ValidationError, 'overlaps the later one');
	await absences.cancel(me, later.id);
	const current = await absences.declare(me, { endAt: at() + DAY });
	assert.equal(current.status, 'active');
	await assert.rejects(absences.cancel(me, current.id), /déjà commencé/);
	assert.equal(absences.upcomingFor(BOB).length, 0);
});

test('extending a validated absence when validation is required: a new request after it, overlap checked', async () => {
	const { absences, owner, executor, at, advance, bob, alice } = await setup();
	absences.setConfig(owner, { requireApproval: true, roleByGuild: { [MAIN]: ABS_ROLE }, nicknamePrefix: '[ABS]' });
	const me = await bob();
	const first = await absences.declare(me, { endAt: at() + 2 * DAY });
	await absences.review(await alice(), first.id, true);
	const other = await absences.declare(me, { startAt: at() + 5 * DAY, endAt: at() + 6 * DAY });

	await assert.rejects(absences.extend(me, first.id, at() + 5 * DAY + 3600_000), /Une autre absence/);
	const request = await absences.extend(me, first.id, at() + 4 * DAY);
	assert.notEqual(request.id, first.id);
	assert.deepEqual([request.status, request.startAt, request.endAt], ['pending', first.endAt, at() + 4 * DAY]);
	assert.equal(absences.list(owner, { userId: BOB }).find(a => a.id === first.id).endAt, first.endAt, 'the validated absence is unchanged');
	await absences.review(await alice(), request.id, true);

	// A manager extends directly
	const direct = await absences.extend(await alice(), other.id, at() + 7 * DAY);
	assert.equal(direct.id, other.id);

	// The first ends and the follow-up starts in the same minute: the role stays
	advance(2 * DAY + 60_000);
	await absences.tick();
	assert.ok(executor.memberRoles.get(`${MAIN}:${BOB}`).includes(ABS_ROLE));
	assert.equal(absences.activeFor(BOB).id, request.id);
});

test('validating an absence already over closes it silently; a refusal sends its reason and names the server', async () => {
	const { core, absences, owner, executor, at, advance, bob } = await setup();
	core.network.upsertSeen({ id: MAIN, name: 'Brothers Life' });
	absences.setConfig(owner, { requireApproval: true, roleByGuild: { [MAIN]: ABS_ROLE }, announce: { guildId: MAIN, channelId: '610000000000000009' }, review: { guildId: MAIN, channelId: STAFF }, reviewerRoleIds: [REVIEWER_ROLE] });
	const me = await bob();
	const late = await absences.declare(me, { endAt: at() + 2 * 3600_000 });
	advance(3 * 3600_000);
	const announcesBefore = executor.absenceMessages.filter(m => m.view.kind !== 'review').length;
	const done = await absences.reviewByButton(ALICE, [REVIEWER_ROLE], late.id, true);
	assert.equal(done.status, 'ended');
	assert.equal(executor.absenceMessages.filter(m => m.view.kind !== 'review').length, announcesBefore, 'no departure nor return announced');
	assert.ok(!executor.memberRoles.get(`${MAIN}:${BOB}`).includes(ABS_ROLE));
	assert.match(executor.dms.at(-1)[1], /déjà terminée/);

	const next = await absences.declare(me, { endAt: at() + 2 * DAY });
	await assert.rejects(absences.assertCanReviewByButton(ALICE, [], next.id), /Seuls les rôles/);
	await absences.assertCanReviewByButton(ALICE, [REVIEWER_ROLE], next.id);
	const refused = await absences.reviewByButton(ALICE, [REVIEWER_ROLE], next.id, false, 'Pas pendant l’événement');
	assert.equal(refused.status, 'rejected');
	assert.match(executor.dms.at(-1)[1], /sur \*\*Brothers Life\*\* n’a pas été validée[\s\S]*Raison : Pas pendant l’événement/);
	assert.equal(rejectModal(next.id).toJSON().custom_id, `abs:rejectform:${next.id}`);
});
