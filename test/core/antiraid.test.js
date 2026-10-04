import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createAntiraid } from '../../src/core/antiraid.js';

const OLD_ACCOUNT = { createdAt: Date.UTC(2020, 0, 1) };

async function setup(config) {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const antiraid = createAntiraid({ db: core.db, network: core.network, audit: core.audit, executor, sanctions: core.sanctions, logs: core.logs, logger: { warn: () => undefined }, now: () => clock });
	antiraid.save(owner, MAIN, { enabled: true, joinThreshold: 3, joinWindowSeconds: 10, raidMinutes: 5, ...config });
	executor.members.set(MAIN, new Set());
	const join = async (n) => {
		const id = String(400000000000000000n + BigInt(n));
		executor.members.get(MAIN).add(id);
		return antiraid.handleJoin(MAIN, { id, username: `u${n}`, bot: false, ...OLD_ACCOUNT });
	};
	return { ...ctx, antiraid, join, advance: (ms) => { clock += ms; } };
}

test('a join flood starts the raid mode: locks, action on newcomers, then it ends by itself', async () => {
	const { antiraid, executor, join, advance } = await setup({ actionOnJoin: 'kick', includeWindow: true });
	assert.equal((await join(1)).blocked, false);
	await join(2);
	// Third join in 10 s: raid, the three are kicked (includeWindow)
	assert.equal((await join(3)).blocked, true);
	assert.equal(executor.raidLocks[0][0], 'lock');
	assert.equal(executor.calls.filter(c => c[0] === 'kick').length, 3);
	assert.equal(antiraid.state(MAIN).raid.actioned, 3);

	// Joins keep the raid going
	advance(4 * 60_000);
	await join(4);
	advance(2 * 60_000);
	await antiraid.tick();
	assert.ok(antiraid.state(MAIN).raid, 'prolonged by the last join');
	advance(4 * 60_000);
	await antiraid.tick();
	assert.equal(antiraid.state(MAIN).raid, null);
	assert.deepEqual(executor.raidLocks.at(-1), ['restore', MAIN, { verificationLevel: 1, invitesDisabled: false }]);
});

test('joins spread over time do not trigger anything', async () => {
	const { antiraid, join, advance } = await setup({});
	for (let i = 0; i < 6; i++) {
		await join(i);
		advance(11_000);
	}
	assert.equal(antiraid.state(MAIN).raid, null);
});

test('recent accounts: quarantine role, and the manual raid mode needs its permission', async () => {
	const { core, antiraid, executor, owner } = await setup({ newAccount: { enabled: true, minAgeDays: 7, action: 'role', roleId: '800000000000000077' } });
	const fresh = String((BigInt(Date.now() - 1420070400000) << 22n));
	const result = await antiraid.handleJoin(MAIN, { id: fresh, username: 'fresh', bot: false });
	assert.equal(result.blocked, false);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${fresh}`), ['800000000000000077']);

	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(antiraid.setRaid(alice, MAIN, true), ForbiddenError);
	await antiraid.setRaid(owner, MAIN, true);
	await assert.rejects(antiraid.setRaid(owner, MAIN, true), /déjà actif/);
	const ended = await antiraid.setRaid(owner, MAIN, false);
	assert.equal(ended.actioned, 0);
	assert.throws(() => antiraid.save(owner, MAIN, { newAccount: { enabled: true, action: 'role' } }), /quarantaine/);
});

test('simultaneous joins start a single raid (the restore state is the one from before the raid)', async () => {
	const { antiraid, executor, join } = await setup({ actionOnJoin: 'none' });
	await join(1);
	await join(2);
	await Promise.all([join(3), join(4), join(5)]);
	assert.equal(executor.raidLocks.filter(l => l[0] === 'lock').length, 1);
	assert.ok(antiraid.state(MAIN).raid);
});

test('a raid survives a restart: its locks are still restored at the end', async () => {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const make = () => createAntiraid({ db: core.db, network: core.network, audit: core.audit, executor, sanctions: core.sanctions, logs: core.logs, logger: { warn: () => undefined }, now: () => clock });
	const first = make();
	first.save(owner, MAIN, { enabled: true, raidMinutes: 5 });
	await first.setRaid(owner, MAIN, true);

	const second = make();
	assert.ok(second.state(MAIN).raid, 'raid known after the restart');
	clock += 6 * 60_000;
	await second.tick();
	assert.deepEqual(executor.raidLocks.at(-1), ['restore', MAIN, { verificationLevel: 1, invitesDisabled: false }]);
	assert.equal(second.state(MAIN).raid, null);
	assert.equal(make().state(MAIN).raid, null);
});
