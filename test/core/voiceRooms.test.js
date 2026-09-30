import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createVoiceRooms } from '../../src/core/voiceRooms.js';

const MEMBER = { id: '300000000000000001', username: 'lea', globalName: 'Léa', bot: false };

async function setup(config = {}) {
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const timers = [];
	const setTimer = (fn) => {
		timers.push(fn);
		return null;
	};
	const rooms = createVoiceRooms({ db: core.db, network: core.network, audit: core.audit, executor, logger: { warn: () => undefined }, setTimer });
	const hub = await rooms.createHub(owner, MAIN, { config });
	// Moving someone puts them in the channel
	executor.voiceMove = async (guildId, userId, channelId) => {
		for (const c of executor.voiceChannels.values()) c.members = c.members.filter(m => m !== userId);
		executor.voiceChannels.get(channelId)?.members.push(userId);
	};
	const join = async (member, channelId) => {
		for (const c of executor.voiceChannels.values()) c.members = c.members.filter(m => m !== member.id);
		executor.voiceChannels.get(channelId)?.members.push(member.id);
		return rooms.voiceMoved(MAIN, member, { from: null, to: channelId });
	};
	const leave = async (member, channelId) => {
		const channel = executor.voiceChannels.get(channelId);
		channel.members = channel.members.filter(m => m !== member.id);
		return rooms.voiceMoved(MAIN, member, { from: channelId, to: null });
	};
	return { ...ctx, rooms, hub, join, leave, timers };
}

test('joining the hub creates a room owned by the member, with a control panel', async () => {
	const { rooms, hub, join, executor } = await setup({ nameTemplate: 'Chez {user}', userLimit: 4 });
	const room = await join(MEMBER, hub.channelId);
	assert.equal(room.ownerId, MEMBER.id);
	const channel = executor.voiceChannels.get(room.channelId);
	assert.equal(channel.name, 'Chez Léa');
	assert.equal(channel.state.userLimit, 4);
	assert.deepEqual(channel.members, [MEMBER.id], 'moved into the new room');
	assert.equal(executor.roomPanels[0].ownerId, MEMBER.id);
	// Joining the hub again sends back to the same room
	await join(MEMBER, hub.channelId);
	assert.equal(rooms.rooms(MAIN).length, 1);
});

test('only the owner controls the room; lock, permit, reject; settings remembered', async () => {
	const { rooms, hub, join, leave, executor, timers } = await setup();
	const room = await join(MEMBER, hub.channelId);
	await assert.rejects(rooms.setLocked(BOB, room.channelId, true), ForbiddenError);
	await rooms.setLocked(MEMBER.id, room.channelId, true);
	await rooms.permit(MEMBER.id, room.channelId, [ALICE]);
	executor.voiceChannels.get(room.channelId).members.push(BOB);
	executor.inVoice.add(BOB);
	await rooms.reject(MEMBER.id, room.channelId, [BOB]);
	await rooms.rename(MEMBER.id, room.channelId, 'QG');
	const state = executor.voiceChannels.get(room.channelId).state;
	assert.equal(state.locked, true);
	assert.deepEqual(state.permitted, [ALICE]);
	assert.deepEqual(state.rejected, [BOB]);
	assert.ok(executor.calls.some(c => c[0] === 'voiceDisconnect' && c[2] === BOB), 'the blocked member is disconnected');

	// Empty: deleted after the delay; the next room reuses the settings
	executor.voiceChannels.get(room.channelId).members = [MEMBER.id];
	await leave(MEMBER, room.channelId);
	await timers[0]();
	assert.equal(rooms.rooms(MAIN).length, 0);
	const next = await join(MEMBER, hub.channelId);
	assert.equal(next.state.name, 'QG');
	assert.equal(next.state.locked, true);
});

test('claim when the owner left, transfer to someone inside', async () => {
	const { rooms, hub, join } = await setup();
	const room = await join(MEMBER, hub.channelId);
	const bob = { id: BOB, username: 'bob', bot: false };
	await join(bob, room.channelId);
	await assert.rejects(rooms.claim(BOB, room.channelId), /toujours là/);
	await rooms.transfer(MEMBER.id, room.channelId, BOB);
	assert.equal(rooms.getRoom(room.channelId).ownerId, BOB);
	await assert.rejects(rooms.transfer(MEMBER.id, room.channelId, MEMBER.id), ForbiddenError);
});

test('disabled options and role restrictions of the hub', async () => {
	const { rooms, hub, join, executor } = await setup({ options: { hide: false }, allowedRoleIds: ['800000000000000042'] });
	executor.inVoice.add(MEMBER.id);
	assert.equal(await join(MEMBER, hub.channelId), undefined, 'no room without the role');
	assert.ok(executor.calls.some(c => c[0] === 'voiceDisconnect'));
	executor.memberRoles.set(`${MAIN}:${MEMBER.id}`, ['800000000000000042']);
	const room = await join(MEMBER, hub.channelId);
	await assert.rejects(rooms.setHidden(MEMBER.id, room.channelId, true), /désactivée/);
});
