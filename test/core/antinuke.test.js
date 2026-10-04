import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, OWNER, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { addsDangerousPermissions, createAntinuke, hasDangerousPermissions, normalizeAntinuke } from '../../src/core/antinuke.js';

const ADMIN = String(1n << 3n);
const BAN = String(1n << 2n);
const SEND = String(1n << 11n);
const BOT = '300000000000000001';

async function setup(config = {}) {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	core.network.activate(owner, OTHER);
	const antinuke = createAntinuke({
		db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, logs: core.logs,
		ownerId: OWNER, logger: { warn: () => undefined }, now: () => clock,
	});
	antinuke.save(owner, { enabled: true, ...config });
	// ALICE is a moderator on both servers: an admin role, a ban role and a plain role
	for (const guildId of [MAIN, OTHER]) {
		executor.roles.set(guildId, [
			{ id: `${guildId.slice(0, 3)}1`, name: 'Admin', editable: true, permissions: ADMIN },
			{ id: `${guildId.slice(0, 3)}2`, name: 'Modo', editable: true, permissions: BAN },
			{ id: `${guildId.slice(0, 3)}3`, name: 'Membre', editable: true, permissions: SEND },
		]);
		executor.memberRoles.set(`${guildId}:${ALICE}`, executor.roles.get(guildId).map(r => r.id));
		executor.members.set(guildId, new Set([ALICE, BOT]));
	}
	executor.channels.set('c-antinuke', { guildId: MAIN, name: 'anti-nuke' });
	await core.logs.setRoute(owner, MAIN, 'antinuke', 'c-antinuke');
	const act = (type, guildId = MAIN, executorId = ALICE, extra = {}) => antinuke.record(guildId, { type, executorId, ...extra });
	return { ...ctx, antinuke, act, advance: (ms) => { clock += ms; } };
}

test('permission bitfields: dangerous permissions are recognised', () => {
	assert.equal(hasDangerousPermissions(ADMIN), true);
	assert.equal(hasDangerousPermissions(SEND), false);
	assert.equal(hasDangerousPermissions('not a number'), false);
	assert.equal(addsDangerousPermissions(SEND, String((1n << 11n) | (1n << 28n))), true);
	assert.equal(addsDangerousPermissions(ADMIN, ADMIN), false);
	const config = normalizeAntinuke({ actions: { channel_delete: { limit: 0, windowSeconds: 1 } } });
	assert.equal(config.actions.channel_delete.limit, 1);
	assert.equal(config.actions.channel_delete.windowSeconds, 5);
	assert.equal(config.actions.role_delete.limit, 3);
	assert.equal(config.enabled, false);
});

test('under the limit nothing happens, at the limit the account is quarantined', async () => {
	const { antinuke, act, executor, core } = await setup();
	assert.equal((await act('channel_delete')).incident, null);
	assert.equal((await act('channel_delete')).incident, null);
	const { incident } = await act('channel_delete');
	assert.ok(incident);
	assert.equal(incident.status, 'open');
	assert.equal(incident.trigger, 'channel_delete');
	assert.equal(incident.actions.length, 3);
	// Only the roles with dangerous permissions, on every network server
	assert.deepEqual(incident.removedRoles, { [MAIN]: ['9001', '9002'], [OTHER]: ['9001', '9002'] });
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${ALICE}`), ['9003']);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${ALICE}`), ['9003']);
	// Alert in the log channel and DM to the network owner
	await core.logs.flush();
	assert.ok(executor.sent.some(s => s.channelId === 'c-antinuke' && /quarantaine/.test(s.message.title)));
	assert.equal(executor.dms.length, 1);
	assert.equal(executor.dms[0][0], OWNER);
	assert.equal(antinuke.incidents().length, 1);
});

test('the window slides: old actions stop counting', async () => {
	const { act, advance } = await setup();
	await act('channel_delete');
	await act('channel_delete');
	advance(61_000);
	assert.equal((await act('channel_delete')).incident, null);
	assert.equal((await act('channel_delete')).incident, null);
	assert.ok((await act('channel_delete')).incident);
});

test('actions are summed across every server of the network', async () => {
	const { act } = await setup();
	await act('role_delete', MAIN);
	await act('role_delete', OTHER);
	const { incident } = await act('role_delete', OTHER);
	assert.ok(incident);
	assert.deepEqual([...new Set(incident.actions.map(a => a.guildId))].sort(), [MAIN, OTHER].sort());
});

test('servers outside the network, disabled actions and a disabled protection are ignored', async () => {
	const { antinuke, act, owner, core } = await setup({ actions: { member_kick: { enabled: false } } });
	core.network.upsertSeen({ id: '900000000000000009', name: 'Hors réseau' });
	assert.equal((await act('channel_delete', '900000000000000009')).counted, false);
	for (let i = 0; i < 10; i++) assert.equal((await act('member_kick')).counted, false);
	antinuke.save(owner, { enabled: false });
	for (let i = 0; i < 5; i++) assert.equal((await act('channel_delete')).counted, false);
	assert.equal(antinuke.incidents().length, 0);
});

test('exemptions: owner, bot, whitelisted user and whitelisted rank', async () => {
	const { antinuke, act, owner, core, executor } = await setup();
	executor.botUserId = () => BOT;
	for (let i = 0; i < 5; i++) {
		assert.equal((await act('channel_delete', MAIN, OWNER)).exempt, true);
		assert.equal((await act('channel_delete', MAIN, BOT)).exempt, true);
	}
	antinuke.save(owner, { enabled: true, whitelistUserIds: [ALICE] });
	for (let i = 0; i < 5; i++) assert.equal((await act('channel_delete')).exempt, true);

	const rank = core.ranks.create(owner, { name: 'Direction', level: 50 });
	await core.ranks.assignDirect(owner, BOB, rank.id);
	antinuke.save(owner, { enabled: true, whitelistRankIds: [rank.id, 9999] });
	assert.deepEqual(antinuke.get().whitelistRankIds, [rank.id]);
	for (let i = 0; i < 5; i++) assert.equal((await act('channel_delete', MAIN, BOB)).exempt, true);
	assert.equal(antinuke.incidents().length, 0);
});

test('no double quarantine: later actions are added to the open incident', async () => {
	const { antinuke, act, executor } = await setup();
	// A burst arriving all at once
	const results = await Promise.all([1, 2, 3, 4, 5].map(() => act('channel_delete')));
	assert.equal(results.filter(r => r.incident).length, 1);
	await act('role_delete');
	assert.equal(antinuke.incidents().length, 1);
	assert.equal(antinuke.incidents()[0].actions.length, 6);
	assert.equal(executor.calls.filter(c => c[0] === 'removeRole').length, 4);
	assert.equal(executor.dms.length, 1);
});

test('restore gives every removed role back and closes the incident', async () => {
	const { antinuke, act, owner, executor, core } = await setup({ timeoutMinutes: 10 });
	await act('member_ban');
	await act('member_ban');
	await act('member_ban');
	await act('member_ban');
	const { incident } = await act('member_ban');
	assert.equal(incident.timedOut, true);
	assert.ok(executor.calls.some(c => c[0] === 'timeout' && c[3] === 600_000));

	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(antinuke.restore(alice, incident.id), ForbiddenError);

	const restored = await antinuke.restore(owner, incident.id);
	assert.equal(restored.status, 'restored');
	assert.equal(restored.given, 4);
	assert.equal(restored.resolvedBy, OWNER);
	assert.deepEqual([...executor.memberRoles.get(`${MAIN}:${ALICE}`)].sort(), ['9001', '9002', '9003']);
	assert.ok(executor.calls.some(c => c[0] === 'timeout' && c[3] === null));
	await assert.rejects(antinuke.restore(owner, incident.id), ValidationError);

	// After a restore, a new burst opens a new incident
	for (let i = 0; i < 4; i++) await act('member_ban');
	assert.ok((await act('member_ban')).incident);
	assert.equal(antinuke.incidents().length, 2);
});

test('dismiss closes without giving anything back', async () => {
	const { antinuke, act, owner, executor } = await setup();
	for (let i = 0; i < 2; i++) await act('guild_update');
	const [incident] = antinuke.incidents();
	const dismissed = antinuke.dismiss(owner, incident.id);
	assert.equal(dismissed.status, 'dismissed');
	assert.equal(executor.calls.filter(c => c[0] === 'addRole').length, 0);
	assert.throws(() => antinuke.dismiss(owner, incident.id), ValidationError);
});

test('removeAllRoles takes every role, roles above the bot are reported', async () => {
	const { antinuke, act, executor } = await setup({ removeAllRoles: true });
	executor.roles.get(OTHER)[0].editable = false;
	for (let i = 0; i < 3; i++) await act('channel_delete');
	const [incident] = antinuke.incidents();
	assert.deepEqual(incident.removedRoles[MAIN], ['9001', '9002', '9003']);
	assert.deepEqual(incident.removedRoles[OTHER], ['9002', '9003']);
	assert.equal(incident.failures.length, 1);
	assert.equal(incident.failures[0].guildId, OTHER);
	assert.equal(incident.failures[0].name, 'Admin');
});

test('a bot added by someone untrusted is kicked', async () => {
	const { act, executor, antinuke, owner } = await setup();
	await act('bot_add', MAIN, ALICE, { targetId: BOT, targetName: 'NukeBot' });
	assert.ok(executor.calls.some(c => c[0] === 'kick' && c[2] === BOT));
	executor.calls.length = 0;
	antinuke.save(owner, { enabled: true, kickBots: false });
	await act('bot_add', MAIN, BOB, { targetId: BOT });
	assert.equal(executor.calls.filter(c => c[0] === 'kick').length, 0);
});

test('only antinuke.manage can change the settings', async () => {
	const { antinuke, core } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => antinuke.save(alice, { enabled: false }), ForbiddenError);
	assert.throws(() => antinuke.dismiss(alice, 1), ForbiddenError);
});
