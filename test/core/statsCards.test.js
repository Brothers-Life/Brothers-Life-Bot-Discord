import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLeaderboard, renderMemberStats, renderServerStats } from '../../src/core/statsCards.js';
import { renderMosaic } from '../../src/core/serverLinkMosaic.js';
import { renderMemberFile, since } from '../../src/core/memberCard.js';

// Width and height of a PNG, read from its header
function size(buffer) {
	assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// No picture is fetched here: an avatar that cannot be loaded becomes initials
const offline = { fetchImpl: async () => { throw new Error('offline'); } };

test('ranking: a podium then rows, taller with more people, readable when empty', async () => {
	const entries = Array.from({ length: 10 }, (_, i) => ({ name: `Membre ${i}`, avatar: i % 2 ? 'https://cdn.discordapp.com/a.png' : null, value: 100 - i, label: `${100 - i} messages` }));
	const full = size(await renderLeaderboard({ title: 'Les plus bavards', subtitle: '7 derniers jours', entries }, offline));
	const short = size(await renderLeaderboard({ title: 'Les plus bavards', entries: entries.slice(0, 2) }, offline));
	const empty = size(await renderLeaderboard({ title: 'Les plus bavards', entries: [] }, offline));
	assert.equal(full.width, 1000);
	assert.ok(full.height > short.height && short.height > empty.height);
	// More than ten people: the picture stays the size of ten
	assert.deepEqual(size(await renderLeaderboard({ title: 'x', entries: [...entries, ...entries] }, offline)), full);
});

test('member and server pictures: with or without favourite channels, with or without a chart', async () => {
	const member = { name: 'Un pseudo vraiment très très long pour une carte', avatar: null, messages: 0, voiceHours: 0, days: 0, periodDays: 7, rank: 0, channels: [] };
	const plain = size(await renderMemberStats(member, offline));
	const withChannels = size(await renderMemberStats({ ...member, messages: 12, rank: 3, channels: [{ name: 'général', messages: 9 }, { name: 'rp', messages: 3 }] }, offline));
	assert.equal(plain.width, 1000);
	assert.ok(withChannels.height > plain.height);

	const totals = { messages: 10, voiceHours: 2.5, active: 3, joins: 1, leaves: 0, memberCount: null, memberGrowth: 0 };
	const noChart = size(await renderServerStats({ name: 'Brothers Life', icon: null, periodDays: 7, totals, days: [] }, offline));
	const chart = size(await renderServerStats({ name: 'Brothers Life', icon: null, periodDays: 7, totals, days: [{ messages: 0 }, { messages: 4 }, { messages: 6 }] }, offline));
	assert.ok(chart.height > noChart.height);
});

test('member file: grows with ranks, servers and temporary roles; a banned or unknown member still draws', async () => {
	const now = Date.UTC(2026, 10, 20);
	const day = 86_400_000;
	assert.equal(since(now - 3 * 3600_000, now), 'aujourd’hui');
	assert.equal(since(now - day, now), 'il y a 1 jour');
	assert.equal(since(now - 70 * day, now), 'il y a 2 mois');
	assert.equal(since(now - 800 * day, now), 'il y a 2 ans');

	const file = {
		name: 'Pedro', username: 'pedro', id: '123456789012345678', avatar: null, createdAt: now - 900 * day, joinedAt: null, isOwner: false,
		ranks: [], guilds: [], sanctions: { total: 0, warns: 0, active: 0, banned: false }, tempRoles: [],
	};
	const empty = size(await renderMemberFile(file, { ...offline, now }));
	const full = size(await renderMemberFile({
		...file,
		isOwner: true,
		joinedAt: now - 10 * day,
		guilds: Array.from({ length: 30 }, (_, i) => `Serveur numéro ${i}`),
		sanctions: { total: 9, warns: 2, active: 1, banned: true },
		tempRoles: [{ name: 'VIP', expiresAt: now + 3 * day }],
	}, { ...offline, now }));
	assert.equal(empty.width, 1000);
	assert.ok(full.height > empty.height);
});

test('server pictures: every style is 1000 px wide, long names never break the drawing', async () => {
	const tiles = [
		{ name: 'Los Santos Police Department Brigade Spéciale d’Intervention', icon: null, description: 'Protéger et servir', members: 212, voice: 3, boosts: 1 },
		{ name: 'EMS', icon: 'https://cdn.discordapp.com/b.png' },
		{ name: '', icon: null },
	];
	for (const style of ['tiles', 'slices', 'rows', 'banner']) {
		for (const stats of [true, false]) {
			assert.equal(size(await renderMosaic(tiles, { ...offline, style, stats, columns: 3, accent: '#aa0000' })).width, 1000, style);
		}
	}
	// One server, and an unknown style falling back on the tiles
	assert.equal(size(await renderMosaic(tiles.slice(0, 1), { ...offline, style: 'inconnu', names: false })).width, 1000);
});
