import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch } from '../../src/core/music/platforms.js';

test('search prefixes and fallbacks', () => {
	assert.deepEqual(parseSearch('sc: daft punk'), { platform: 'soundcloud', text: 'daft punk' });
	assert.deepEqual(parseSearch('YTM:one more time'), { platform: 'ytmusic', text: 'one more time' });
	assert.deepEqual(parseSearch('youtube : x'), { platform: 'youtube', text: 'x' });
	assert.deepEqual(parseSearch('daft punk', { platform: 'soundcloud' }), { platform: 'soundcloud', text: 'daft punk' });
	assert.deepEqual(parseSearch('daft punk', { platform: 'nope', fallback: 'ytmusic' }), { platform: 'ytmusic', text: 'daft punk' });
	// Links and unknown words before a colon stay as typed
	assert.deepEqual(parseSearch('https://youtu.be/x'), { platform: 'youtube', text: 'https://youtu.be/x' });
	assert.deepEqual(parseSearch('Artiste: Titre'), { platform: 'youtube', text: 'Artiste: Titre' });
});
