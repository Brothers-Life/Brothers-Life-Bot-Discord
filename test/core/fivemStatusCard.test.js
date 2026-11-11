import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadImage } from '@napi-rs/canvas';
import { DEFAULT_STATUS_IMAGE, formatDuration, normalizeStatusImage, renderStatusCard } from '../../src/core/fivem/statusCard.js';

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

test('status picture: the design from the panel is cleaned up', () => {
	assert.deepEqual(normalizeStatusImage(undefined), DEFAULT_STATUS_IMAGE);
	const d = normalizeStatusImage({ title: `  ${'x'.repeat(80)} `, background: 'mars', darkness: 3, logo: 'custom', logoImage: 'http://exemple.fr/a.png', chartHours: 5, stats: { ping: false }, gauge: 'oui' });
	assert.equal(d.title.length, 40);
	assert.equal(d.background, 'road');
	assert.equal(d.darkness, 30);
	assert.equal(d.logoImage, null, 'only https or a picture sent from the panel');
	assert.equal(d.chartHours, 6);
	assert.deepEqual(d.stats, { ping: false, peak: true, fill: true });
	assert.equal(d.gauge, true);
	assert.equal(normalizeStatusImage({ backgroundImage: `upload:${'b'.repeat(32)}.webp` }).backgroundImage, `upload:${'b'.repeat(32)}.webp`);
});

test('status picture: its height follows the blocks shown, a custom picture is used or replaced', async () => {
	const status = { online: true, players: 20, max: 64, list, onlineSince: NOW - 3_600_000 };
	const size = async design => {
		const image = await loadImage(await renderStatusCard({ server, status, history, now: NOW, design, loadSource: async () => null }));
		return [image.width, image.height];
	};
	assert.deepEqual(await size({ chart: false }), [1200, 380], 'the gauge keeps its room');
	assert.deepEqual(await size({ chart: false, gauge: false }), [1200, 340]);
	assert.deepEqual(await size({ chart: false, gauge: false, stats: { ping: false, peak: false, fill: false } }), [1200, 230]);
	assert.deepEqual(await size({ stats: { ping: false, peak: false, fill: false } }), [1200, 500]);

	const custom = await renderStatusCard({ server, status, history, now: NOW });
	let asked = null;
	const loadSource = async (src) => {
		asked = src;
		return custom;
	};
	const png = await renderStatusCard({ server, status, history, now: NOW, design: { background: 'custom', backgroundImage: 'https://exemple.fr/fond.png', logo: 'none' }, loadSource });
	assert.equal(asked, 'https://exemple.fr/fond.png');
	assert.equal(png.subarray(1, 4).toString(), 'PNG');
	const broken = await renderStatusCard({ server, status, history, now: NOW, design: { background: 'custom', backgroundImage: 'https://exemple.fr/x.png' }, loadSource: async () => Buffer.from('pas une image') });
	assert.equal(broken.subarray(1, 4).toString(), 'PNG', 'an unreadable picture falls back to the default one');
});

test('status picture: durations read like a person would say them', () => {
	assert.equal(formatDuration(5 * 60_000), '5 min');
	assert.equal(formatDuration((3 * 60 + 7) * 60_000), '3 h 07');
	assert.equal(formatDuration(26 * 3_600_000), '1 j 2 h');
	assert.equal(formatDuration(-1), '0 min');
});
