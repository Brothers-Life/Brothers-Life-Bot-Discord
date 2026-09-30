import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createModeration } from '../../src/core/moderation.js';

const MEMBER = '300000000000000001';
const ROLE = '800000000000000005';

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	core.network.activate(owner, OTHER);
	executor.roles.set(MAIN, [
		{ id: ROLE, name: 'VIP', position: 3, editable: true, dangerous: false },
		{ id: '800000000000000006', name: 'Admin', position: 9, editable: true, dangerous: true },
	]);
	executor.memberRoles.set(`${MAIN}:${MEMBER}`, []);
	const modo = core.ranks.create(owner, { name: 'Modo', level: 30, permissions: ['commands.clear', 'commands.lock', 'commands.lockdown', 'commands.slowmode', 'commands.roles', 'commands.voice', 'sanctions.restrict', 'sanctions.revoke'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	const alice = { ...(await core.ranks.resolve(ALICE)), source: 'bot' };
	return { ...ctx, alice };
}

test('clear, lock, slowmode need their permission and are audited', async () => {
	const { core, executor, alice } = await setup();
	const bob = { ...(await core.ranks.resolve(BOB)), source: 'bot' };
	await assert.rejects(core.moderation.clear(bob, { guildId: MAIN, channelId: '1', count: 10 }), ForbiddenError);
	assert.equal(await core.moderation.clear(alice, { guildId: MAIN, channelId: '610000000000000001', count: 10, userId: MEMBER }), 10);
	await assert.rejects(core.moderation.clear(alice, { guildId: MAIN, channelId: '1', count: 0 }), ValidationError);
	await core.moderation.lock(alice, { guildId: MAIN, channelId: '610000000000000001', locked: true });
	await core.moderation.slowmode(alice, { guildId: MAIN, channelId: '610000000000000001', seconds: 30 });
	await assert.rejects(core.moderation.slowmode(alice, { guildId: MAIN, channelId: '1', seconds: 99999 }), ValidationError);
	assert.deepEqual(executor.calls.map(c => c[0]).filter(c => ['purge', 'lock', 'slowmode'].includes(c)), ['purge', 'lock', 'slowmode']);
	assert.equal(core.audit.query({ action: 'moderation.clear' }).length, 1);
});

test('lockdown remembers the locked channels and only reopens those', async () => {
	const { core, executor, alice } = await setup();
	assert.equal(await core.moderation.lockdown(alice, MAIN, true), 2);
	await assert.rejects(core.moderation.lockdown(alice, MAIN, true), /déjà verrouillé/);
	assert.equal(core.moderation.isLockedDown(MAIN), true);
	assert.equal(await core.moderation.lockdown(alice, MAIN, false), 2);
	assert.deepEqual(executor.calls.find(c => c[0] === 'unlockChannels')[1], ['610000000000000001', '610000000000000002']);
	await assert.rejects(core.moderation.lockdown(alice, MAIN, false), /pas verrouillé/);
});

test('voice moderation fails clearly when the member is not in voice', async () => {
	const { core, executor, alice } = await setup();
	await assert.rejects(core.moderation.voice(alice, { guildId: MAIN, userId: MEMBER, action: 'disconnect' }), /pas en vocal/);
	executor.inVoice.add(MEMBER);
	await core.moderation.voice(alice, { guildId: MAIN, userId: MEMBER, action: 'mute' });
	assert.ok(executor.calls.some(c => c[0] === 'voiceMute' && c[3] === true));
});

test('roles: dangerous roles refused, hierarchy checked from Discord', async () => {
	const { core, executor, alice } = await setup();
	await assert.rejects(core.moderation.giveRole(alice, { guildId: MAIN, userId: MEMBER, roleId: '800000000000000006' }), /seul le chef/);
	executor.topRolePositions.set(`${MAIN}:${ALICE}`, 2);
	await assert.rejects(core.moderation.giveRole(alice, { guildId: MAIN, userId: MEMBER, roleId: ROLE }), /au-dessus/);
	executor.topRolePositions.set(`${MAIN}:${ALICE}`, 5);
	await core.moderation.giveRole(alice, { guildId: MAIN, userId: MEMBER, roleId: ROLE });
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER}`), [ROLE]);
});

test('temporary roles: given, extended, then removed when due', async () => {
	let clock = Date.now();
	const ctx = await setup();
	const { core, executor, alice } = ctx;
	const moderation = createModeration({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, settings: core.settings, members: core.members, logs: core.logs, logger: { warn: () => undefined }, now: () => clock });
	const temp = await moderation.giveRole(alice, { guildId: MAIN, userId: MEMBER, roleId: ROLE, durationMs: 3600_000 });
	assert.equal(temp.expiresAt, clock + 3600_000);
	// Giving it again for a duration moves the end, without a second row
	await moderation.giveRole(alice, { guildId: MAIN, userId: MEMBER, roleId: ROLE, durationMs: 7200_000 });
	assert.equal(moderation.listTempRoles({ userId: MEMBER }).length, 1);
	await moderation.extendTempRole(alice, temp.id, 3600_000);
	assert.equal(moderation.listTempRoles({ userId: MEMBER })[0].expiresAt, clock + 3 * 3600_000);
	await assert.rejects(moderation.giveRole(alice, { guildId: MAIN, userId: MEMBER, roleId: ROLE, durationMs: 1000 }), /entre 1 minute/);

	clock += 2 * 3600_000;
	assert.equal(await moderation.expireTempRoles(), 0);
	clock += 2 * 3600_000;
	assert.equal(await moderation.expireTempRoles(), 1);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER}`), []);
	assert.equal(moderation.listTempRoles({ userId: MEMBER }).length, 0);
	assert.equal(core.audit.query({ action: 'temproles.expire' }).length, 1);
});

test('restrictions: a role per profile and server, lifted on revoke, reapplied on join', async () => {
	const { core, executor, alice } = await setup();
	executor.memberRoles.set(`${OTHER}:${MEMBER}`, []);
	const sanction = await core.sanctions.create(alice, { type: 'restrict', profile: 'mute_voice', userId: MEMBER, reason: 'Cris en vocal', durationMs: 3600_000, originGuildId: MAIN });
	assert.equal(sanction.active, true);
	assert.equal(sanction.profile, 'mute_voice');
	const mainRole = executor.restrictionRoles.get(`${MAIN}:Restreint · Muet vocal`);
	const otherRole = executor.restrictionRoles.get(`${OTHER}:Restreint · Muet vocal`);
	assert.ok(mainRole && otherRole && mainRole !== otherRole);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER}`), [mainRole]);

	// Leaves and comes back: the role is given again
	executor.memberRoles.set(`${MAIN}:${MEMBER}`, []);
	assert.equal(await core.sanctions.reapplyOnJoin(MAIN, MEMBER), 1);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER}`), [mainRole]);

	await assert.rejects(core.sanctions.create(alice, { type: 'restrict', profile: 'nope', userId: MEMBER, originGuildId: MAIN }), /inconnu/);
	const lifted = await core.sanctions.unrestrictUser(alice, MEMBER);
	assert.equal(lifted.length, 1);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER}`), []);
	await assert.rejects(core.sanctions.unrestrictUser(alice, MEMBER), /Aucune restriction/);
});

test('restriction profiles are validated; the reason of a sanction can be edited', async () => {
	const { core, owner, alice } = await setup();
	assert.throws(() => core.restrictions.saveProfiles(alice, []), ForbiddenError);
	assert.throws(() => core.restrictions.saveProfiles(owner, [{ key: 'x', label: 'X', deny: ['Administrator'] }]), /n’interdit rien/);
	const profiles = core.restrictions.saveProfiles(owner, [{ key: 'no_reactions', label: 'Pas de réactions', deny: ['AddReactions', 'Bogus'] }]);
	assert.deepEqual(profiles.map(p => p.deny), [['AddReactions']]);

	const warn = await core.sanctions.create(owner, { type: 'warn', userId: MEMBER, reason: 'Spamm', originGuildId: MAIN });
	assert.throws(() => core.sanctions.setReason(alice, warn.id, 'Spam'), ForbiddenError);
	assert.equal(core.sanctions.setReason(owner, warn.id, 'Spam').reason, 'Spam');
});
