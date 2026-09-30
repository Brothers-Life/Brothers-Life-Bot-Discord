import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createRpEvents } from '../../src/core/rpEvents.js';
import { rpEventPayload } from '../../src/bot/rpEventsUi.js';

const CHANNEL = '610000000000000001';
const PARTICIPANT = '800000000000000033';
const CAROL = '300000000000000041';
const HOUR = 3_600_000;

async function setup() {
	let clock = Date.UTC(2026, 9, 10, 18, 0);
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	for (const id of [ALICE, BOB, CAROL]) executor.memberRoles.set(`${MAIN}:${id}`, []);
	const rpEvents = createRpEvents({ db: core.db, network: core.network, audit: core.audit, executor, logger: { warn: () => undefined }, now: () => clock });
	return { ...ctx, rpEvents, advance: (ms) => { clock += ms; }, at: () => clock };
}

test('sign-ups: capacity and waiting list, a freed seat goes to the first waiting, message kept up to date', async () => {
	const { rpEvents, owner, executor, at } = await setup();
	const e = await rpEvents.save(owner, {
		title: 'Course de rue', description: 'Départ au port', location: 'Port de Los Santos',
		startsAt: at() + 2 * HOUR, endsAt: at() + 4 * HOUR, capacity: 2, reminders: [60, 10],
		targets: [{ guildId: MAIN, channelId: CHANNEL, ping: 'here' }], roles: { [MAIN]: PARTICIPANT },
	});
	assert.equal(executor.eventMessages[0].options.target.ping, 'here');
	assert.equal((await rpEvents.rsvp(ALICE, e.id, 'going')).status, 'going');
	assert.equal((await rpEvents.rsvp(BOB, e.id, 'going')).status, 'going');
	assert.equal((await rpEvents.rsvp(CAROL, e.id, 'going')).status, 'waitlist', 'full');
	const left = await rpEvents.rsvp(ALICE, e.id, 'leave');
	assert.equal(left.promoted, CAROL);
	assert.match(executor.dms.at(-1)[1], /place s’est libérée/);
	assert.deepEqual(left.event.counts, { going: 2, maybe: 0, waitlist: 0 });
	const last = executor.eventMessages.at(-1);
	assert.equal(executor.eventMessages[0].messageId, null, 'created once');
	assert.equal(last.messageId, '860000000000000001', 'then the same message is edited');

	const payload = rpEventPayload({ ...left.event, imageUrl: null }).embeds[0].toJSON();
	assert.match(payload.fields.find(f => f.name.startsWith('Participants')).name, /2\/2/);
});

test('reminders once, participant role while it lasts, ended at the end; cancel warns the participants', async () => {
	const { rpEvents, owner, executor, advance, at } = await setup();
	const e = await rpEvents.save(owner, { title: 'Soirée casino', startsAt: at() + 2 * HOUR, endsAt: at() + 3 * HOUR, reminders: [60], targets: [{ guildId: MAIN, channelId: CHANNEL }], roles: { [MAIN]: PARTICIPANT } });
	await rpEvents.rsvp(ALICE, e.id, 'going');
	await rpEvents.rsvp(BOB, e.id, 'maybe');
	advance(HOUR + 60_000);
	await rpEvents.tick();
	await rpEvents.tick();
	assert.equal(executor.dms.filter(d => /Rappel/.test(d[1])).length, 2, 'going and maybe, once');
	advance(HOUR);
	await rpEvents.tick();
	assert.equal(rpEvents.get(e.id).status, 'live');
	assert.ok(executor.memberRoles.get(`${MAIN}:${ALICE}`).includes(PARTICIPANT));
	assert.ok(!executor.memberRoles.get(`${MAIN}:${BOB}`).includes(PARTICIPANT), 'maybe gets no role');
	advance(HOUR);
	await rpEvents.tick();
	assert.equal(rpEvents.get(e.id).status, 'ended');
	assert.ok(!executor.memberRoles.get(`${MAIN}:${ALICE}`).includes(PARTICIPANT));
	await assert.rejects(rpEvents.rsvp(BOB, e.id, 'going'), /fermées/);

	const next = await rpEvents.save(owner, { title: 'Rallye', startsAt: at() + HOUR, endsAt: at() + 2 * HOUR, targets: [{ guildId: MAIN, channelId: CHANNEL }] });
	await rpEvents.rsvp(BOB, next.id, 'going');
	await rpEvents.cancel(owner, next.id, 'Météo');
	assert.match(executor.dms.at(-1)[1], /annulé[\s\S]*Météo/);
	await assert.rejects(rpEvents.save({ id: '1', can: () => false }, { title: 'x' }), ForbiddenError);
	await assert.rejects(rpEvents.save(owner, { title: 'x', startsAt: at() + HOUR, endsAt: at(), targets: [{ guildId: MAIN, channelId: CHANNEL }] }), /après le début/);
});
