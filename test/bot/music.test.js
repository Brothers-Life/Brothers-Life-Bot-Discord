import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePosition } from '../../src/bot/commands/community/musique.js';
import { clock, musicPayload, queuePayload, watchUrl } from '../../src/bot/musicUi.js';

const track = { id: 1, title: 'One More Time', author: 'Daft Punk', url: 'https://www.youtube.com/watch?v=FGBhQbmPwH8', durationMs: 320_000, thumbnail: null, source: 'youtube', live: false, requestedBy: '100000000000000002' };

test('positions typed in /musique aller', () => {
	assert.equal(parsePosition('1:30', 0), 90_000);
	assert.equal(parsePosition('90', 0), 90_000);
	assert.equal(parsePosition('1:02:03', 0), 3_723_000);
	assert.equal(parsePosition('+30', 60_000), 90_000);
	assert.equal(parsePosition('-90', 60_000), 0);
	assert.equal(parsePosition('abc', 0), null);
	assert.deepEqual([clock(65_000), clock(3_725_000), clock(null)], ['1:05', '1:02:05', '0:00']);
});

test('now-playing message: controls, clip link at the current time, queue pages', () => {
	const view = { connected: true, current: track, position: 75_000, paused: false, volume: 80, speed: 1, loop: 'off', filters: [], index: 0, queue: [track, { ...track, id: 2, title: 'Aerodynamic' }], upcoming: [{ ...track, id: 2, title: 'Aerodynamic' }] };
	const payload = musicPayload(view);
	const embed = payload.embeds[0].toJSON();
	assert.match(embed.title, /One More Time/);
	assert.match(embed.description, /1:15 \/ 5:20/);
	const buttons = payload.components.flatMap(r => r.toJSON().components);
	assert.ok(buttons.some(b => b.custom_id === 'mu:toggle'));
	assert.equal(buttons.find(b => b.label === 'Voir le clip').url, 'https://www.youtube.com/watch?v=FGBhQbmPwH8&t=75');
	assert.equal(watchUrl({ ...track, source: 'spotify', url: 'https://open.spotify.com/track/x' }), null, 'no clip before the YouTube match is known');
	assert.deepEqual(musicPayload({ connected: false, ended: true, reason: 'file terminée' }).components, []);
	assert.match(queuePayload(view).toJSON().description, /Aerodynamic/);
});
