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

test('report: tickets credited to the claimer or the close requester, revoked sanctions and API key actions ignored, absence flag', async () => {
	const { core, owner, executor } = await withNetwork();
	const staff = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: ['panel.access'] });
	await core.ranks.assignDirect(owner, ALICE, staff.id);
	await core.ranks.assignDirect(owner, BOB, staff.id);
	const db = core.db;
	const at = Date.UTC(2026, 9, 15, 12);
	const opener = '300000000000000001';
	const ticket = db.prepare('INSERT INTO tickets (guild_id, number, opener_id, created_at, claimed_by, closed_by, close_request_by, closed_at, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
	// Claimed by Alice, closed by Bob: Alice
	ticket.run(MAIN, 1, opener, at, ALICE, BOB, null, at + 1, 5);
	// Close request of Bob accepted by the opener, then expired: Bob
	ticket.run(MAIN, 2, opener, at, null, opener, BOB, at + 1, 3);
	ticket.run(MAIN, 3, opener, at, null, 'system', BOB, at + 1, null);
	// Closed for inactivity, or by the opener: nobody
	ticket.run(MAIN, 4, opener, at, null, 'system', null, at + 1, null);
	ticket.run(MAIN, 5, opener, at, null, opener, null, at + 1, 1);
	const sanction = db.prepare('INSERT INTO sanctions (type, user_id, moderator_id, source, scope, created_at, revoked_at) VALUES (\'warn\', ?, ?, \'bot\', \'network\', ?, ?)');
	sanction.run(opener, ALICE, at, null);
	sanction.run(opener, ALICE, at, at + 10);
	const audit = db.prepare('INSERT INTO audit_log (at, actor_id, source, action, details) VALUES (?, ?, \'panel\', \'x.y\', ?)');
	audit.run(at, ALICE, JSON.stringify({ a: 1 }));
	audit.run(at, ALICE, null);
	audit.run(at, ALICE, JSON.stringify({ 'Clé d’API': 'script' }));
	db.prepare('INSERT INTO absences (user_id, start_at, end_at, reason, status, declared_by, created_at) VALUES (?, ?, ?, NULL, \'approved\', ?, ?)').run(ALICE, at, at + 86_400_000, ALICE, at);
	db.prepare('INSERT INTO absences (user_id, start_at, end_at, reason, status, declared_by, created_at) VALUES (?, ?, ?, NULL, \'rejected\', ?, ?)').run(BOB, at, at + 86_400_000, BOB, at);

	const activity = createStaffActivity({ db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, logs: core.logs });
	const { members } = await activity.report({ from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 10, 1) - 1 });
	const alice = members.find(m => m.userId === ALICE);
	const bob = members.find(m => m.userId === BOB);
	assert.deepEqual([alice.ticketsClosed, alice.rating], [1, 5]);
	assert.deepEqual([bob.ticketsClosed, bob.rating], [2, 3]);
	assert.equal(alice.sanctions, 1);
	assert.equal(alice.panelActions, 2);
	assert.deepEqual([alice.absent, bob.absent], [true, false]);
});
