import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { createStaffActivity, scoreOf } from '../../src/core/staffActivity.js';
import { dayOf } from '../../src/core/stats.js';

const CHANNEL = '610000000000000001';

test('report: tickets, sanctions, presence and absences per staff member, ranked by score; monthly post once', async () => {
	// 1st of November 2026, 10:30 in Paris: October's report is due
	let clock = Date.UTC(2026, 10, 1, 9, 30);
	const { core, owner, executor } = await withNetwork();
	const staff = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['panel.access'] });
	await core.ranks.assignDirect(owner, ALICE, staff.id);
	await core.ranks.assignDirect(owner, BOB, staff.id);
	const oct = Date.UTC(2026, 9, 15, 12);
	const db = core.db;
	for (let i = 1; i <= 3; i++) db.prepare('INSERT INTO tickets (guild_id, number, opener_id, created_at, claimed_by, closed_by, closed_at, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(MAIN, i, '300000000000000001', oct, ALICE, ALICE, oct + 3600_000, 4 + (i % 2));
	db.prepare('INSERT INTO sanctions (type, user_id, moderator_id, source, scope, created_at) VALUES (\'warn\', ?, ?, \'bot\', \'network\', ?)').run('300000000000000002', BOB, oct);
	db.prepare('INSERT INTO stats_activity (guild_id, day, user_id, channel_id, messages, voice_seconds) VALUES (?, ?, ?, ?, ?, ?)').run(MAIN, dayOf(oct), BOB, CHANNEL, 200, 7200);
	db.prepare('INSERT INTO absences (user_id, start_at, end_at, reason, status, declared_by, created_at) VALUES (?, ?, ?, NULL, \'ended\', ?, ?)').run(BOB, oct, oct + 2 * 86_400_000, BOB, oct);

	const activity = createStaffActivity({ db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, logs: core.logs, now: () => clock });
	const { members } = await activity.report({ from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 10, 1) - 1 });
	const alice = members.find(m => m.userId === ALICE);
	const bob = members.find(m => m.userId === BOB);
	assert.deepEqual([alice.ticketsClosed, alice.ticketsClaimed, alice.rating], [3, 3, 4.7]);
	assert.deepEqual([bob.sanctions, bob.sanctionsDetail.warns, bob.messages, bob.voiceHours, bob.absentDays], [1, 1, 200, 2, 2]);
	assert.equal(alice.score, scoreOf(alice));
	assert.deepEqual(members.map(m => m.score), members.map(m => m.score).sort((a, b) => b - a), 'ranked by score');
	const first = members[0].userId;

	activity.setConfig(owner, { enabled: true, guildId: MAIN, channelId: CHANNEL });
	assert.equal(await activity.tick(), true);
	const post = executor.messages.at(-1);
	assert.equal(post.channelId, CHANNEL);
	assert.match(post.payload.embed.title, /octobre 2026/);
	assert.match(post.payload.embed.description, new RegExp(`🥇 <@${first}>`));
	clock += 3_600_000;
	assert.equal(await activity.tick(), false, 'once a month');
	assert.throws(() => activity.setConfig({ id: '1', can: () => false }, { enabled: false }), /staffactivity.manage/);
});
