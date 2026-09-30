import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createMusic } from '../../src/core/music/index.js';

const VOICE = '620000000000000001';
const OTHER_VOICE = '620000000000000002';
const TEXT = '610000000000000001';
const DJ = '800000000000000090';

async function setup() {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	const music = createMusic({ network: core.network, audit: core.audit, settings: core.settings, backend: executor.music, resolver: executor.musicResolver, executor, logger: { warn: () => undefined }, now: () => clock });
	// A member in the bot's voice channel, without any rank
	const member = (userId, extra = {}) => ({ actorId: userId, source: 'bot', guildId: MAIN, voiceChannelId: VOICE, textChannelId: TEXT, roleIds: [], can: () => false, ...extra });
	return { ...ctx, music, member, backend: executor.music, advance: (ms) => { clock += ms; } };
}

test('play: joins, starts the first track, queues the next ones; the end of a track moves on; loops', async () => {
	const { music, member, backend } = await setup();
	const first = await music.play(member(ALICE), MAIN, 'Titre A');
	assert.equal(first.startedNow, true);
	assert.equal(backend.joined.get(MAIN), VOICE);
	assert.equal(backend.played.at(-1).target, 'https://audio.example/Titre A');
	await music.play(member(BOB), MAIN, 'playlist:B,C');
	let state = music.state(MAIN);
	assert.deepEqual([state.current.title, state.upcoming.map(t => t.title)], ['Titre A', ['B', 'C']]);
	assert.equal(state.queue[1].requestedBy, BOB);

	await music.trackEnded(MAIN);
	assert.equal(music.state(MAIN).current.title, 'B');

	music.setLoop(member(ALICE), MAIN, 'track');
	await music.trackEnded(MAIN);
	assert.equal(music.state(MAIN).current.title, 'B', 'same track again');
	music.setLoop(member(ALICE), MAIN, 'queue');
	await music.trackEnded(MAIN);
	await music.trackEnded(MAIN);
	assert.equal(music.state(MAIN).current.title, 'Titre A', 'back to the start of the queue');
	music.setLoop(member(ALICE), MAIN, 'off');
	await music.skip(member(ALICE), MAIN, 5);
	state = music.state(MAIN);
	assert.equal(state.current, null, 'end of the queue');
	assert.equal(backend.played.at(-1).stopped, true);
});

test('controls: seek, speed and filters restart where the track is; volume live; previous; jump; move; remove; shuffle keeps the current track', async () => {
	const { music, member, backend } = await setup();
	await music.play(member(ALICE), MAIN, 'playlist:A,B,C,D');
	await music.seek(member(ALICE), MAIN, 90_000);
	assert.equal(backend.played.at(-1).seekMs, 90_000);
	backend.positions.set(MAIN, 100_000);
	await music.setSpeed(member(ALICE), MAIN, 1.5);
	assert.deepEqual([backend.played.at(-1).seekMs, backend.played.at(-1).speed], [100_000, 1.5]);
	await assert.rejects(music.setSpeed(member(ALICE), MAIN, 3), ValidationError);
	await music.setFilters(member(ALICE), MAIN, ['bassboost', 'nightcore', 'vaporwave', 'nope']);
	assert.deepEqual(music.state(MAIN).filters.sort(), ['bassboost', 'nightcore'], 'nightcore and vaporwave exclude each other');
	assert.equal(music.state(MAIN).rate, 1.5 * 1.25);
	await music.setVolume(member(ALICE), MAIN, 150);
	assert.equal(backend.volumes.get(MAIN), 150);
	const plays = backend.played.length;
	await music.setVolume(member(ALICE), MAIN, 999);
	assert.equal(music.state(MAIN).volume, 200);
	assert.equal(backend.played.length, plays, 'volume does not restart the track');

	await music.previous(member(ALICE), MAIN);
	assert.equal(backend.played.at(-1).seekMs, 0, 'past 5 s, previous restarts the track');
	await music.jump(member(ALICE), MAIN, 2);
	assert.equal(music.state(MAIN).current.title, 'C');
	backend.positions.set(MAIN, 0);
	await music.previous(member(ALICE), MAIN);
	assert.equal(music.state(MAIN).current.title, 'B');

	music.move(member(ALICE), MAIN, 3, 0);
	assert.deepEqual(music.state(MAIN).queue.map(t => t.title), ['D', 'A', 'B', 'C']);
	assert.equal(music.state(MAIN).current.title, 'B', 'moving tracks does not change what plays');
	await music.remove(member(ALICE), MAIN, 0);
	assert.equal(music.state(MAIN).current.title, 'B');
	await music.play(member(ALICE), MAIN, 'playlist:E,F,G,H');
	music.shuffle(member(ALICE), MAIN);
	const state = music.state(MAIN);
	assert.equal(state.current.title, 'B');
	assert.deepEqual(state.upcoming.map(t => t.title).sort(), ['C', 'E', 'F', 'G', 'H']);
	music.clear(member(ALICE), MAIN);
	assert.equal(music.state(MAIN).upcoming.length, 0);

	await music.play(member(ALICE), MAIN, 'Z live');
	await assert.rejects(music.jump(member(ALICE), MAIN, 99), ValidationError);
});

test('permissions: same voice channel, DJ roles for the controls, music.use from the panel', async () => {
	const { music, member, owner } = await setup();
	await assert.rejects(music.play(member(ALICE, { voiceChannelId: null }), MAIN, 'A'), /salon vocal/);
	await music.play(member(ALICE), MAIN, 'playlist:A,B');
	await assert.rejects(music.skip(member(BOB, { voiceChannelId: OTHER_VOICE }), MAIN), /Rejoins/);

	music.setConfig(owner, { djRoles: { [MAIN]: [DJ] } });
	await music.play(member(BOB), MAIN, 'C');
	await assert.rejects(music.skip(member(BOB), MAIN), ForbiddenError, 'adding is open, skipping needs DJ');
	await music.skip(member(BOB, { roleIds: [DJ] }), MAIN);
	await music.skip(member(BOB, { voiceChannelId: null, can: (p) => p === 'music.use' }), MAIN);
	await assert.rejects(music.pause({ actorId: ALICE, source: 'panel', can: () => false }, MAIN), ForbiddenError);
	assert.throws(() => music.setConfig({ id: ALICE, can: () => false }, {}), ForbiddenError);
});

test('broken tracks are skipped; the bot leaves when alone or idle for a while', async () => {
	const { music, member, backend, advance, executor } = await setup();
	await music.play(member(ALICE), MAIN, 'playlist:broken one,Bien');
	const state = music.state(MAIN);
	assert.equal(state.current.title, 'Bien');
	assert.equal(state.history[0].error, 'Vidéo indisponible');
	await new Promise(r => setTimeout(r, 10));
	assert.equal(executor.musicMessages.at(-1).channelId, TEXT, 'now-playing message');

	backend.listenerCount.set(MAIN, 0);
	await music.tick();
	assert.equal(music.state(MAIN).connected, true);
	advance(5 * 60_000);
	await music.tick();
	assert.equal(music.state(MAIN).connected, false);
	assert.equal(backend.joined.has(MAIN), false);

	backend.listenerCount.set(MAIN, 1);
	await music.play(member(ALICE), MAIN, 'Seul');
	await music.trackEnded(MAIN);
	advance(6 * 60_000);
	await music.tick();
	assert.equal(music.state(MAIN).connected, false, 'nothing left to play');
});
