import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '../src/rpc/codec.js';
import { musicContext } from '../src/web/routes/music.js';
import { allowed } from '../src/core/music/playlists.js';

// The music runs in the bot process: what the panel sends it is serialized, and a function cannot be.
// (Playing from the panel used to fail with "Functions cannot be sent between the bot and the API".)
test('the music context of the panel crosses the link between the API and the bot', () => {
	const actor = { id: '100000000000000001', can: permission => permission === 'music.use' };
	const ctx = musicContext({ actor });
	assert.doesNotThrow(() => encode([ctx, '200000000000000001', 'daft punk', { channelId: null }]));
	const received = JSON.parse(encode(ctx));
	assert.deepEqual(received, { actorId: actor.id, source: 'panel', grants: { 'music.use': true, 'music.manage': false } });
	assert.equal(allowed(received, 'music.use'), true);
	assert.equal(allowed(received, 'music.manage'), false);
});

test('permissions of a music context: a function from Discord, plain answers from the panel', () => {
	assert.equal(allowed({ can: () => true }, 'music.manage'), true);
	assert.equal(allowed({ can: () => false, grants: { 'music.manage': true } }, 'music.manage'), false, 'the function wins when there is one');
	assert.equal(allowed({ grants: { 'music.use': true } }, 'music.use'), true);
	assert.equal(allowed({}, 'music.use'), false);
	assert.equal(allowed(null, 'music.use'), false);
});
