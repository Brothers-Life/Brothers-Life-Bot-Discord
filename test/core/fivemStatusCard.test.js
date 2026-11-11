import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadImage } from '@napi-rs/canvas';
import { formatDuration, renderStatusCard } from '../../src/core/fivem/statusCard.js';

const NOW = Date.UTC(2026, 10, 11, 21, 0);
const server = { name: 'Brothers Life RP', config: { color: '#ff9628' }, maintenance: null };
const history = Array.from({ length: 361 }, (_, i) => ({ at: NOW - (360 - i) * 60_000, players: i > 150 && i < 160 ? null : 10 + (i % 40) }));
const list = [{ id: 1, name: 'Léa', ping: 40 }, { id: 2, name: 'Tom', ping: null }];

test('status picture: every state gives a 1200 × 600 PNG', async () => {
	const cases = [
		{ server, status: { online: true, players: 2, max: 64, list, onlineSince: NOW - 3_600_000 }, history },
		{ server, status: { online: false, players: 0, max: 64, list: [] }, history },
		{ server: { ...server, maintenance: { since: NOW - 60_000 } }, status: null, history: [] },
		{ server: { ...server, name: 'x'.repeat(60), config: {} }, status: { online: true, players: 900, max: 0, list: [] }, history: history.slice(-1) },
	];
	for (const input of cases) {
		const png = await renderStatusCard({ ...input, now: NOW });
		assert.equal(png.subarray(1, 4).toString(), 'PNG');
		const image = await loadImage(png);
		assert.deepEqual([image.width, image.height], [1200, 600]);
	}
});

test('status picture: durations read like a person would say them', () => {
	assert.equal(formatDuration(5 * 60_000), '5 min');
	assert.equal(formatDuration((3 * 60 + 7) * 60_000), '3 h 07');
	assert.equal(formatDuration(26 * 3_600_000), '1 j 2 h');
	assert.equal(formatDuration(-1), '0 min');
});
