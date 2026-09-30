import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createStats, dayOf } from '../../src/core/stats.js';

// 30/09/2026 10:00 Paris time (08:00 UTC)
const START = Date.UTC(2026, 8, 30, 8, 0);

async function setup() {
	let clock = START;
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const stats = createStats({ db: core.db, network: core.network, audit: core.audit, executor, logger: { warn: () => undefined }, now: () => clock });
	return { ...ctx, stats, owner, advance: (ms) => { clock += ms; } };
}

test('messages are counted per member, channel and day; bots and other servers are ignored', async () => {
	const { stats, advance } = await setup();
	stats.message(MAIN, 'c1', ALICE, false);
	stats.message(MAIN, 'c1', ALICE, false);
	stats.message(MAIN, 'c2', BOB, false);
	stats.message(MAIN, 'c1', '999999999999999999', true);
	stats.message(OTHER, 'c9', ALICE, false);
	await stats.flush();
	advance(86_400_000);
	stats.message(MAIN, 'c1', BOB, false);
	await stats.flush();

	const overview = await stats.overview({ guildIds: [MAIN], from: START - 86_400_000, to: START + 86_400_000 });
	assert.equal(overview.totals.messages, 4);
	assert.equal(overview.totals.active, 2);
	assert.deepEqual(overview.days.map(d => d.messages), [0, 3, 1]);
	const top = await stats.topMembers({ guildIds: [MAIN], from: START, to: START + 86_400_000 });
	assert.deepEqual(top.map(t => [t.userId, t.messages]).sort(), [[ALICE, 2], [BOB, 2]]);
	const channels = await stats.topChannels({ guildIds: [MAIN], from: START, to: START + 86_400_000 });
	assert.equal(channels[0].channelId, 'c1');
});

test('voice time only counts with someone else, AFK excluded, peak recorded', async () => {
	const { stats, advance } = await setup();
	stats.voiceState(MAIN, ALICE, 'v1');
	advance(10 * 60_000);
	// Alone for 10 minutes: nothing
	stats.voiceState(MAIN, BOB, 'v1');
	advance(30 * 60_000);
	stats.voiceState(MAIN, BOB, null);
	stats.voiceState(MAIN, ALICE, 'afk', { afk: true });
	advance(30 * 60_000);
	await stats.flush();
	const alice = await stats.member(ALICE, { guildIds: [MAIN], from: START, to: START + 3600_000 });
	assert.equal(alice.voice, 30 * 60);
	const overview = await stats.overview({ guildIds: [MAIN], from: START, to: START + 3600_000 });
	assert.equal(overview.totals.voiceHours, 1);
	assert.equal(overview.days[0].memberCount, 100);
});

test('heat map in Paris time; joins and leaves per day', async () => {
	const { stats } = await setup();
	stats.message(MAIN, 'c1', ALICE, false);
	stats.memberJoined(MAIN);
	stats.memberJoined(MAIN);
	stats.memberLeft(MAIN);
	await stats.flush();
	const grid = stats.heatmap({ guildIds: [MAIN], from: START, to: START + 3600_000 });
	// 30/09/2026 is a Wednesday, 10:00 in Paris
	assert.equal(grid[2][10].messages, 1);
	const overview = await stats.overview({ guildIds: [MAIN], from: START, to: START });
	assert.deepEqual([overview.totals.joins, overview.totals.leaves], [2, 1]);
	assert.equal(dayOf(Date.UTC(2026, 8, 30, 22, 30)), '2026-10-01', 'after midnight in Paris');
});

test('staff statistics: sanctions per moderator and tickets handled', async () => {
	const { core, stats, owner, executor } = await setup();
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['sanctions.warn', 'tickets.handle'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	const alice = await core.ranks.resolve(ALICE);
	executor.channels.set('610000000000000001', { guildId: MAIN, name: 'x' });
	await core.sanctions.create(alice, { type: 'warn', userId: '300000000000000001', reason: 'x', originGuildId: MAIN });
	await core.sanctions.create(alice, { type: 'warn', userId: '300000000000000002', reason: 'y', originGuildId: MAIN });
	const staff = await stats.staff({ guildIds: [MAIN], from: Date.now() - 86_400_000, to: Date.now() });
	const row = staff.find(s => s.userId === ALICE);
	assert.equal(row.sanctions.warn, 2);
	assert.equal(row.sanctionsTotal, 2);
});

test('counter channels: created, renamed only when the text changes, permission needed', async () => {
	const { core, stats, owner, executor } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(stats.createCounter(alice, MAIN, { template: 'Membres : {members}' }), ForbiddenError);
	await assert.rejects(stats.createCounter(owner, MAIN, { template: 'Pas de variable' }), /variable/);
	const counter = await stats.createCounter(owner, MAIN, { template: 'Membres : {members}' });
	assert.equal(executor.createdCounters[0].name, 'Membres : 120');
	assert.deepEqual(executor.renamed, [[counter.channelId, 'Membres : 120']]);
	await stats.updateCounters();
	assert.equal(executor.renamed.length, 1, 'same name: no rename');
	executor.guildCounts.set(MAIN, { members: 1234, humans: 1200, bots: 34, voice: 9, boosts: 7 });
	await stats.updateCounters();
	assert.deepEqual(executor.renamed.at(-1), [counter.channelId, `Membres : ${(1234).toLocaleString('fr-FR')}`]);
	stats.addVariables(async () => ({ 'fivem.players': 42 }));
	await stats.updateCounter(owner, counter.id, 'En jeu : {fivem.players}');
	assert.deepEqual(executor.renamed.at(-1), [counter.channelId, 'En jeu : 42']);
	stats.counterDeleted(counter.channelId);
	assert.equal(stats.counters(MAIN).length, 0);
});
