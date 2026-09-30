import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { snowflakeTime } from '../../src/core/memberInsights.js';

test('snowflakes carry their creation date', () => {
	assert.equal(new Date(snowflakeTime('175928847299117063')).toISOString(), '2016-04-30T11:18:25.796Z');
	assert.equal(snowflakeTime('nope'), null);
});

test('insights: activity, who invited whom, name history, tickets, events', async () => {
	const { core } = await withNetwork();
	const today = new Date().toISOString().slice(0, 10);
	const insert = core.db.prepare('INSERT INTO stats_activity (guild_id, day, user_id, channel_id, messages, voice_seconds) VALUES (?, ?, ?, ?, ?, ?)');
	insert.run(MAIN, today, ALICE, '610000000000000001', 40, 0);
	insert.run(MAIN, '2020-01-01', ALICE, '620000000000000001', 2, 7200);
	core.events.record({ guildId: MAIN, category: 'members', type: 'member_join', userId: ALICE, actorId: BOB, summary: 'Arrivée' });
	core.events.record({ guildId: MAIN, category: 'members', type: 'member_nickname', userId: ALICE, summary: 'Pseudo', details: { before: null, after: 'Ali' } });
	core.db.prepare('INSERT INTO tickets (guild_id, number, opener_id, subject, status, created_at) VALUES (?, 1, ?, ?, ?, ?)').run(MAIN, ALICE, 'Aide', 'open', Date.now());

	const data = await core.memberInsights.of(ALICE);
	assert.deepEqual([data.activity.allTime.messages, data.activity.allTime.voiceHours, data.activity.allTime.days, data.activity.allTime.first], [42, 2, 2, '2020-01-01']);
	assert.equal(data.activity.last30.messages, 40);
	assert.equal(data.activity.topChannels[0].channelId, '620000000000000001', 'voice time counts too');
	assert.deepEqual(data.invites.invitedBy.map(i => i.inviterId), [BOB]);
	assert.equal((await core.memberInsights.of(BOB)).invites.invitedPeople, 1);
	assert.equal(data.names[0].details.after, 'Ali');
	assert.deepEqual([data.tickets.total, data.tickets.open, data.tickets.last[0].subject], [1, 1, 'Aide']);
	assert.equal(data.movements.joins, 1);
	assert.equal(data.timeline.length, 2);
	assert.ok(data.accountCreatedAt > 0);
});
