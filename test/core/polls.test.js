import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createPolls } from '../../src/core/polls.js';

const C_MAIN = '610000000000000001';
const C_OTHER = '620000000000000001';
const U3 = '300000000000000003';

async function setup() {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	core.network.activate(owner, OTHER);
	const polls = createPolls({ db: core.db, network: core.network, audit: core.audit, executor, logger: { warn: () => undefined }, now: () => clock });
	const make = (settings = {}, extra = {}) => polls.create(owner, {
		question: 'Prochain event ?',
		options: [{ label: 'Course' }, { label: 'Casino' }, { label: 'Braquage' }],
		settings,
		targets: [{ guildId: MAIN, channelId: C_MAIN, ping: 'none' }, { guildId: OTHER, channelId: C_OTHER, ping: 'none' }],
		...extra,
	});
	return { ...ctx, polls, make, advance: (ms) => { clock += ms; } };
}

test('votes from two servers are counted together; single choice can change', async () => {
	const { polls, make, owner, executor } = await setup();
	const poll = make();
	const opened = await polls.publish(owner, poll.id);
	assert.equal(opened.messages.length, 2);
	assert.equal(executor.polls.length, 2);
	await polls.vote(poll.id, ALICE, MAIN, ['o1']);
	await polls.vote(poll.id, BOB, OTHER, ['o1']);
	await polls.vote(poll.id, U3, OTHER, ['o2']);
	assert.deepEqual(polls.results(poll.id).options.map(o => o.votes), [2, 1, 0]);
	await polls.vote(poll.id, U3, OTHER, ['o3']);
	const r = polls.results(poll.id);
	assert.deepEqual(r.options.map(o => o.votes), [2, 0, 1]);
	assert.equal(r.voters, 3);
	assert.equal(r.options[0].percent, 66.7);
	assert.deepEqual(polls.get(poll.id).byGuild.filter(b => b.guildId === OTHER).map(b => b.choice).sort(), ['o1', 'o3']);
});

test('multiple choices with limits, no change allowed, anonymous voters hidden', async () => {
	const { polls, make, owner } = await setup();
	const poll = make({ multiple: true, maxChoices: 2, allowChange: false });
	await polls.publish(owner, poll.id);
	await assert.rejects(polls.vote(poll.id, ALICE, MAIN, ['o1', 'o2', 'o3']), /2 choix maximum/);
	await polls.vote(poll.id, ALICE, MAIN, ['o1', 'o2']);
	await assert.rejects(polls.vote(poll.id, ALICE, MAIN, ['o3']), /ne permet pas de changer/);
	assert.throws(() => polls.voters(poll.id, 'o1'), ForbiddenError);
	assert.deepEqual(polls.voters(poll.id, 'o1', { own: ALICE }), [ALICE]);
});

test('closes at its end date or at the vote limit, results posted, scheduled start', async () => {
	const { polls, make, owner, executor, advance } = await setup();
	const timed = make({}, { endsAt: Date.now() + 3600_000 });
	await polls.publish(owner, timed.id);
	advance(3600_000 + 60_000);
	await polls.tick();
	assert.equal(polls.get(timed.id).status, 'closed');
	assert.equal(executor.pollResults.length, 2);
	await assert.rejects(polls.vote(timed.id, ALICE, MAIN, ['o1']), /fermé/);

	const limited = make({ maxVotes: 2 });
	await polls.publish(owner, limited.id);
	await polls.vote(limited.id, ALICE, MAIN, ['o1']);
	await polls.vote(limited.id, BOB, MAIN, ['o2']);
	assert.equal(polls.get(limited.id).status, 'closed');

	const scheduled = make({}, { startsAt: Date.now() + 5 * 3600_000 + 120_000 });
	assert.equal((await polls.publish(owner, scheduled.id)).status, 'scheduled');
	advance(6 * 3600_000);
	await polls.tick();
	assert.equal(polls.get(scheduled.id).status, 'open');
});

test('conditions to vote and validation', async () => {
	const { core, polls, make, owner, executor } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => polls.create(alice, { question: 'x', options: [{ label: 'a' }, { label: 'b' }] }), ForbiddenError);
	assert.throws(() => polls.create(owner, { question: 'x', options: [{ label: 'seul' }] }), /2 choix/);
	const poll = make({ requiredRoleIds: ['800000000000000011'] });
	await polls.publish(owner, poll.id);
	await assert.rejects(polls.vote(poll.id, ALICE, MAIN, ['o1']), ValidationError);
	executor.memberRoles.set(`${MAIN}:${ALICE}`, ['800000000000000011']);
	await polls.vote(poll.id, ALICE, MAIN, ['o1']);
	await assert.rejects(polls.update(owner, poll.id, { question: 'x', options: [{ label: 'a' }, { label: 'b' }] }), /ne peuvent plus changer/);
});

test('a scheduled poll is posted once even when two ticks overlap', async () => {
	const { polls, make, owner, executor, advance } = await setup();
	const poll = make({}, { startsAt: Date.now() + 3600_000 });
	await polls.publish(owner, poll.id);
	advance(3600_000 + 60_000);
	await Promise.all([polls.tick(), polls.tick()]);
	assert.equal(executor.polls.length, 2, 'one message per target, not two');
	assert.equal(polls.get(poll.id).messages.length, 2);
});

test('a vote arriving while the poll closes is refused', async () => {
	const { polls, make, owner, executor } = await setup();
	const poll = make({ requiredRoleIds: ['800000000000000001'] });
	await polls.publish(owner, poll.id);
	executor.memberRoles.set(`${MAIN}:${ALICE}`, ['800000000000000001']);
	// The role check awaits Discord: the poll is closed meanwhile
	const voting = polls.vote(poll.id, ALICE, MAIN, ['o1']);
	await polls.close(owner, poll.id);
	await assert.rejects(voting, /fermé/);
	assert.equal(polls.results(poll.id).total, 0);
});

test('a poll needing several choices at once is shown with a menu, never with buttons', async () => {
	const { polls, make, core } = await setup();
	assert.equal(make({ multiple: true, minChoices: 2, style: 'buttons' }).settings.style, 'select');
	assert.equal(make({ multiple: true, maxChoices: 2, allowChange: false, style: 'buttons' }).settings.style, 'select');
	assert.equal(make({ multiple: true, maxChoices: 2, style: 'buttons' }).settings.style, 'buttons');
	assert.equal(make({ multiple: false, allowChange: false, style: 'buttons' }).settings.style, 'buttons');
	// A poll saved before the fix is shown with a menu too
	const old = make({ multiple: true, maxChoices: 3, style: 'buttons' });
	core.db.prepare('UPDATE polls SET settings = ? WHERE id = ?').run(JSON.stringify({ ...old.settings, minChoices: 2 }), old.id);
	assert.equal(polls.get(old.id).settings.style, 'select');
});
