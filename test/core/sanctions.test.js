import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, OWNER, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { parseDuration, formatDuration } from '../../src/core/duration.js';

const TARGET = '300000000000000001';
const THIRD = '900000000000000003';

async function setup() {
	const ctx = await withNetwork();
	const { core, owner } = ctx;
	core.network.activate(owner, OTHER);
	core.network.upsertSeen({ id: THIRD, name: 'Third' });
	const modo = core.ranks.create(owner, { name: 'Modo', level: 40, permissions: ['sanctions.warn', 'sanctions.timeout', 'sanctions.kick'] });
	const admin = core.ranks.create(owner, { name: 'Admin', level: 80, permissions: ['sanctions.warn', 'sanctions.ban', 'sanctions.revoke', 'sanctions.kick'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	await core.ranks.assignDirect(owner, BOB, admin.id);
	const alice = { ...(await core.ranks.resolve(ALICE)), source: 'bot' };
	const bob = { ...(await core.ranks.resolve(BOB)), source: 'bot' };
	alice.can = (await core.ranks.resolve(ALICE)).can;
	bob.can = (await core.ranks.resolve(BOB)).can;
	ctx.executor.calls.length = 0;
	return { ...ctx, alice, bob };
}

test('durations', () => {
	assert.equal(parseDuration('10m'), 600_000);
	assert.equal(parseDuration('1h30m'), 5_400_000);
	assert.equal(parseDuration('7j'), 7 * 86_400_000);
	assert.equal(parseDuration('2w'), 14 * 86_400_000);
	assert.equal(parseDuration('abc'), null);
	assert.equal(parseDuration('10x'), null);
	assert.equal(formatDuration(5_400_000), '1 h 30 min');
	assert.equal(formatDuration(null), 'définitif');
});

test('a network ban applies on every active server, DMs first, and is audited', async () => {
	const { core, executor, bob } = await setup();
	const ban = await core.sanctions.create(bob, { type: 'ban', userId: TARGET, reason: 'Arnaque', originGuildId: OTHER });
	assert.deepEqual(executor.calls.map(c => [c[0], c[1]]).sort(), [['ban', MAIN], ['ban', OTHER]]);
	assert.equal(executor.calls.some(c => c[1] === THIRD), false, 'pending servers are not touched');
	assert.equal(executor.dms[0][0], TARGET);
	assert.ok(ban.active);
	assert.equal(core.sanctions.isBanned(TARGET), true);
	const entry = core.audit.query({ action: 'sanctions.ban' })[0];
	assert.equal(entry.details.reason, 'Arnaque');
	assert.equal(Object.keys(entry.results).length, 2);
});

test('a local ban only touches its server', async () => {
	const { core, executor, bob } = await setup();
	await core.sanctions.create(bob, { type: 'ban', userId: TARGET, scope: 'local', originGuildId: OTHER });
	assert.deepEqual(executor.calls.map(c => c[1]), [OTHER]);
});

test('one failing server does not block the others', async () => {
	const { core, executor, bob } = await setup();
	executor.failOn.add(OTHER);
	const ban = await core.sanctions.create(bob, { type: 'ban', userId: TARGET });
	assert.equal(ban.results[MAIN].ok, true);
	assert.equal(ban.results[OTHER].ok, false);
	assert.equal(ban.results[OTHER].code, 50013);
});

test('permissions per action', async () => {
	const { core, alice } = await setup();
	await assert.rejects(core.sanctions.create(alice, { type: 'ban', userId: TARGET }), ForbiddenError);
	await core.sanctions.create(alice, { type: 'warn', userId: TARGET, reason: 'Spam' });
});

test('staff at or above your level and the owner are protected', async () => {
	const { core, alice, bob } = await setup();
	await assert.rejects(core.sanctions.create(alice, { type: 'warn', userId: BOB }), ForbiddenError);
	await assert.rejects(core.sanctions.create(bob, { type: 'ban', userId: OWNER }), ForbiddenError);
	await assert.rejects(core.sanctions.create(bob, { type: 'ban', userId: BOB }), ForbiddenError);
	await core.sanctions.create(bob, { type: 'warn', userId: ALICE });
});

test('kick and timeout skip servers where the user is not a member', async () => {
	const { core, executor, alice } = await setup();
	executor.members.set(MAIN, new Set([TARGET]));
	const kick = await core.sanctions.create(alice, { type: 'kick', userId: TARGET });
	assert.deepEqual(kick.results[OTHER], { ok: true, skipped: 'not_member' });
	assert.deepEqual(executor.calls.map(c => [c[0], c[1]]), [['kick', MAIN]]);
});

test('timeouts need a duration of at most 28 days', async () => {
	const { core, alice } = await setup();
	await assert.rejects(core.sanctions.create(alice, { type: 'timeout', userId: TARGET }), ValidationError);
	await assert.rejects(core.sanctions.create(alice, { type: 'timeout', userId: TARGET, durationMs: 29 * 86_400_000 }), ValidationError);
	const t = await core.sanctions.create(alice, { type: 'timeout', userId: TARGET, durationMs: 600_000 });
	assert.ok(t.expiresAt > t.createdAt);
});

test('revoking a ban unbans everywhere', async () => {
	const { core, executor, bob } = await setup();
	const ban = await core.sanctions.create(bob, { type: 'ban', userId: TARGET });
	executor.calls.length = 0;
	const revoked = await core.sanctions.revoke(bob, ban.id, 'Erreur');
	assert.ok(revoked.revokedAt);
	assert.equal(revoked.active, false);
	assert.deepEqual(executor.calls.map(c => c[0]), ['unban', 'unban']);
	await assert.rejects(core.sanctions.revoke(bob, ban.id), ValidationError);
});

test('unbanning a user without known ban still unbans on the network', async () => {
	const { core, executor, bob } = await setup();
	await core.sanctions.unbanUser(bob, TARGET, 'Appel accepté');
	assert.deepEqual(executor.calls.map(c => c[0]), ['unban', 'unban']);
});

test('temporary bans expire', async () => {
	const { core, executor, bob } = await setup();
	const ban = await core.sanctions.create(bob, { type: 'ban', userId: TARGET, durationMs: 1000 });
	core.db.prepare('UPDATE sanctions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, ban.id);
	executor.calls.length = 0;
	assert.equal(await core.sanctions.expireDue(), 1);
	assert.deepEqual(executor.calls.map(c => c[0]), ['unban', 'unban']);
	assert.equal(core.sanctions.get(ban.id).revokedBy, 'system');
});

test('a native ban by an allowed staff member is propagated to the other servers', async () => {
	const { core, executor } = await setup();
	const sanction = await core.sanctions.handleNative({ kind: 'ban', guildId: OTHER, userId: TARGET, executorId: BOB, reason: 'Clic droit' });
	assert.equal(sanction.scope, 'network');
	assert.equal(sanction.source, 'native');
	assert.deepEqual(executor.calls.map(c => [c[0], c[1]]), [['ban', MAIN]], 'not re-applied on the origin server');
	assert.equal(executor.dms.length, 0);
});

test('a native ban by someone without the right stays local', async () => {
	const { core, executor } = await setup();
	const sanction = await core.sanctions.handleNative({ kind: 'ban', guildId: OTHER, userId: TARGET, executorId: ALICE });
	assert.equal(sanction.scope, 'local');
	assert.deepEqual(executor.calls, []);
});

test('a native unban by an allowed member lifts the network ban', async () => {
	const { core, executor, bob } = await setup();
	await core.sanctions.create(bob, { type: 'ban', userId: TARGET });
	executor.calls.length = 0;
	await core.sanctions.handleNative({ kind: 'unban', guildId: OTHER, userId: TARGET, executorId: BOB });
	assert.equal(core.sanctions.isBanned(TARGET), false);
	assert.deepEqual(executor.calls.map(c => [c[0], c[1]]), [['unban', MAIN]]);
});

test('native actions on servers outside the network are ignored', async () => {
	const { core } = await setup();
	assert.equal(await core.sanctions.handleNative({ kind: 'ban', guildId: THIRD, userId: TARGET, executorId: BOB }), null);
});

test('a server joining the network receives network bans and hands over its own', async () => {
	const { core, executor, owner, bob } = await setup();
	await core.sanctions.create(bob, { type: 'ban', userId: TARGET });
	executor.bans.set(THIRD, [{ userId: '300000000000000009', username: 'raider', reason: 'Raid' }]);
	executor.calls.length = 0;

	core.network.activate(owner, THIRD);
	await new Promise(r => setTimeout(r, 20));

	assert.deepEqual(executor.calls.map(c => [c[0], c[1], c[2]]), [['ban', THIRD, TARGET]]);
	const imported = core.sanctions.list({ userId: '300000000000000009' })[0];
	assert.equal(imported.scope, 'local');
	assert.equal(imported.originGuildId, THIRD);
	assert.equal(core.audit.query({ action: 'sanctions.sync' })[0].details.imported, 1);
});

test('list filters', async () => {
	const { core, alice, bob } = await setup();
	await core.sanctions.create(alice, { type: 'warn', userId: TARGET });
	await core.sanctions.create(bob, { type: 'ban', userId: TARGET });
	assert.equal(core.sanctions.list({ userId: TARGET }).length, 2);
	assert.equal(core.sanctions.list({ type: 'warn' }).length, 1);
	assert.equal(core.sanctions.list({ active: true }).length, 1);
});
