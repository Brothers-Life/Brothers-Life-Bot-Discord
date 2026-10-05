import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createMeetings } from '../../src/core/meetings.js';
import { meetingPayload, summaryPayload } from '../../src/bot/meetingsUi.js';

const VOICE = '620000000000000101';
const STAFF = '610000000000000101';
const CAROL = '300000000000000071';
const DAVE = '300000000000000072';
const ROLE = '800000000000000171';
const MINUTE = 60_000;

async function setup() {
	let clock = Date.UTC(2026, 9, 10, 18, 0);
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	const meetings = createMeetings({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, logs: core.logs, logger: { warn: () => undefined }, now: () => clock });
	const staff = core.ranks.create(ctx.owner, { name: 'Modo', level: 20, permissions: ['panel.access'] });
	await core.ranks.assignDirect(ctx.owner, ALICE, staff.id);
	await core.ranks.assignDirect(ctx.owner, BOB, staff.id);
	executor.memberRoles.set(`${MAIN}:${CAROL}`, [ROLE]);
	return { ...ctx, meetings, staff, at: () => clock, advance: (ms) => { clock += ms; } };
}

test('meeting: convocation by rank and role, answers (absent with a reason), reminders, start, attendance, end with a summary', async () => {
	const { meetings, owner, executor, staff, at, advance } = await setup();
	const m = await meetings.create(owner, {
		guildId: MAIN, title: 'Réunion hebdo', startsAt: at() + 2 * 60 * MINUTE, durationMinutes: 60, voiceChannelId: VOICE, announceChannelId: STAFF,
		invites: { rankIds: [staff.id], roleIds: [ROLE], userIds: [] }, agenda: ['Bilan de la semaine', 'Nouveaux arrivants'], reminders: [60, 10],
	});
	assert.deepEqual(m.invitees.map(i => i.userId).sort(), [ALICE, BOB, CAROL].sort());
	assert.equal(executor.meetingMessages[0].channelId, STAFF);
	assert.equal(executor.meetingDMs.filter(d => d.kind === 'invite').length, 3);

	await meetings.rsvp(ALICE, m.id, 'yes');
	await assert.rejects(meetings.rsvp(BOB, m.id, 'no'), /pourquoi/);
	await meetings.rsvp(BOB, m.id, 'no', 'Au travail');
	await assert.rejects(meetings.rsvp(DAVE, m.id, 'yes'), ForbiddenError);
	assert.deepEqual(meetings.get(m.id).answers, { yes: 1, maybe: 0, no: 1, pending: 1 });

	advance(60 * MINUTE + MINUTE);
	await meetings.tick();
	await meetings.tick();
	assert.equal(executor.meetingDMs.filter(d => d.kind === 'reminder').length, 2, 'once, to the ones not absent');

	// Alice already there at the start, Carol late, Dave not invited drops by
	executor.voice.set(VOICE, [ALICE]);
	advance(60 * MINUTE);
	await meetings.tick();
	assert.equal(meetings.get(m.id).status, 'live');
	assert.match(executor.messages.at(-1).payload.content, /commence/);
	advance(10 * MINUTE);
	meetings.voiceChanged(MAIN, CAROL, null, VOICE);
	meetings.voiceChanged(MAIN, DAVE, null, VOICE);
	advance(20 * MINUTE);
	meetings.voiceChanged(MAIN, DAVE, VOICE, null);
	meetings.addNote(owner, m.id, 'Recrutement ouvert jusqu’à dimanche');
	meetings.addAction(owner, m.id, { text: 'Mettre à jour le règlement', assigneeId: CAROL });
	advance(30 * MINUTE);
	const { meeting } = await meetings.end(owner, m.id);
	const people = Object.fromEntries(meeting.report.people.map(p => [p.userId, [p.status, p.minutes]]));
	assert.deepEqual(people, { [ALICE]: ['present', 60], [BOB]: ['excused', 0], [CAROL]: ['late', 50], [DAVE]: ['guest', 20] });
	assert.equal(executor.summaries.length, 1);
	assert.match(executor.dms.at(-1)[1], /Mettre à jour le règlement/, 'task sent to its owner');
	const embed = summaryPayload(meeting).embeds[0].toJSON();
	assert.ok(embed.fields.some(f => f.name.startsWith('⏰ En retard (1)')));
	assert.equal(meetingPayload(meeting).components.length, 0, 'no answer buttons once over');

	const stats = meetings.stats();
	assert.equal(stats.meetings, 1);
	assert.deepEqual(stats.people.find(p => p.userId === BOB), { userId: BOB, invited: 1, present: 0, late: 0, excused: 1, absent: 0, minutes: 0, rate: 100 }, 'being excused does not lower the rate');
});

test('meeting: an invitee on a validated absence is excused; a new date resets the answers and asks everyone again', async () => {
	const { core, meetings, owner, executor, at, advance } = await setup();
	const { createAbsences } = await import('../../src/core/absences.js');
	const absences = createAbsences({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, logger: { warn: () => undefined }, now: at });
	await absences.declare(owner, { userId: BOB, startAt: at(), endAt: at() + 2 * 86_400_000, reason: 'Vacances' });
	const planned = await absences.declare(owner, { userId: CAROL, startAt: at() + 10 * MINUTE, endAt: at() + 2 * 86_400_000 });
	assert.equal(planned.status, 'approved');
	await absences.cancel(owner, planned.id);

	const m = await meetings.create(owner, { guildId: MAIN, title: 'Point', startsAt: at() + 60 * MINUTE, durationMinutes: 30, voiceChannelId: VOICE, invites: { userIds: [ALICE, BOB, CAROL] } });
	assert.equal(meetings.get(m.id).invitees.find(i => i.userId === BOB).onLeave, true);
	await meetings.rsvp(ALICE, m.id, 'yes');
	await meetings.rsvp(CAROL, m.id, 'no', 'Malade');

	executor.meetingDMs.length = 0;
	const moved = await meetings.update(owner, m.id, { ...m, startsAt: at() + 120 * MINUTE });
	assert.deepEqual(moved.answers, { yes: 0, maybe: 0, no: 0, pending: 3 }, 'answers back to pending');
	assert.deepEqual(executor.meetingDMs.filter(d => d.kind === 'moved').map(d => d.userId).sort(), [ALICE, BOB, CAROL].sort(), 'even the ones who had said no');

	executor.voice.set(VOICE, [ALICE]);
	advance(120 * MINUTE);
	await meetings.tick();
	advance(30 * MINUTE);
	const { meeting } = await meetings.end(owner, m.id);
	const people = Object.fromEntries(meeting.report.people.map(p => [p.userId, p.status]));
	assert.deepEqual(people, { [ALICE]: 'present', [BOB]: 'excused', [CAROL]: 'absent' });
	assert.match(meeting.report.people.find(p => p.userId === BOB).reason, /En absence · Vacances/);
	assert.equal(meetings.stats().people.find(p => p.userId === BOB).rate, 100);
	assert.equal(meetings.stats().people.find(p => p.userId === CAROL).rate, 0);
});

test('meeting: changes, cancellation, a series planned again, the end once the channel is empty, checks', async () => {
	const { meetings, owner, executor, at, advance } = await setup();
	await assert.rejects(meetings.create(owner, { guildId: MAIN, title: 'X', startsAt: at() - 60 * MINUTE, voiceChannelId: VOICE, invites: { userIds: [ALICE] } }), /passé/);
	await assert.rejects(meetings.create(owner, { guildId: MAIN, title: 'X', startsAt: at() + MINUTE, voiceChannelId: VOICE, invites: {} }), ValidationError);
	await assert.rejects(meetings.create({ id: ALICE, can: () => false }, {}), ForbiddenError);

	const m = await meetings.create(owner, { guildId: MAIN, title: 'Point', startsAt: at() + 60 * MINUTE, durationMinutes: 30, voiceChannelId: VOICE, invites: { userIds: [ALICE] } });
	await meetings.update(owner, m.id, { ...m, startsAt: at() + 120 * MINUTE, invites: { userIds: [ALICE, BOB] } });
	assert.ok(executor.meetingDMs.some(d => d.kind === 'moved'));
	assert.ok(executor.meetingDMs.some(d => d.kind === 'invite' && d.userId === BOB), 'the new invitee gets the convocation');
	await meetings.cancel(owner, m.id, 'Trop peu de monde');
	assert.equal(meetings.get(m.id).status, 'cancelled');
	assert.ok(executor.meetingDMs.some(d => d.kind === 'cancelled'));

	// Weekly: the next one is planned at the end; the end comes by itself once over and empty
	const weekly = await meetings.create(owner, { guildId: MAIN, title: 'Hebdo', startsAt: at() + 10 * MINUTE, durationMinutes: 30, voiceChannelId: VOICE, invites: { userIds: [ALICE] }, recurrence: { type: 'weekly', days: [6], time: '20:10' } });
	advance(10 * MINUTE);
	await meetings.tick();
	executor.voice.set(VOICE, [ALICE]);
	advance(50 * MINUTE);
	await meetings.tick();
	assert.equal(meetings.get(weekly.id).status, 'live', 'people still talking');
	executor.voice.set(VOICE, []);
	await meetings.tick();
	assert.equal(meetings.get(weekly.id).status, 'ended');
	const next = meetings.list().find(x => x.title === 'Hebdo' && x.status === 'scheduled');
	assert.ok(next && next.startsAt > weekly.startsAt, 'next one planned');
});
