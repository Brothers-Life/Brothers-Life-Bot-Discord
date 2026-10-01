import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cohorts, coverage, gini, median, pearson } from '../../src/core/fivem/insights.js';

test('fivem insights: inequality, correlation and median', () => {
	assert.equal(gini([10, 10, 10, 10]), 0);
	assert.ok(gini([0, 0, 0, 100]) > 0.7);
	assert.equal(gini([]), 0);
	assert.equal(Math.round(pearson([1, 2, 3, 4], [2, 4, 6, 8]) * 100), 100);
	assert.equal(Math.round(pearson([1, 2, 3, 4], [8, 6, 4, 2]) * 100), -100);
	assert.equal(pearson([1, 2], [1, 2]), null, 'too few points');
	assert.equal(median([5, 1, 3]), 3);
	assert.equal(median([4, 1, 3, 2]), 2.5);
	assert.equal(median([]), null);
});

test('fivem insights: players at once per 10-minute slot, weekly retention', () => {
	const from = Date.UTC(2026, 8, 1);
	const min = 60_000;
	const slots = coverage([[from, from + 25 * min], [from + 15 * min, from + 35 * min]], from, from + 60 * min);
	assert.deepEqual(slots, [1, 2, 2, 1, 0, 0]);

	const week = 7 * 86_400_000;
	const monday = Date.UTC(2026, 8, 7);
	const sessions = [
		{ user_id: 1, joined_at: new Date(monday) }, { user_id: 1, joined_at: new Date(monday + week) },
		{ user_id: 2, joined_at: new Date(monday + 3600_000) },
	];
	const rows = cohorts(sessions, monday + week + 86_400_000, 2);
	assert.deepEqual(rows[0], { week: '2026-09-07', players: 2, back: [50] });
	assert.equal(rows[1].players, 0);
});
