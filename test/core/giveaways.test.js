import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createGiveaways, weightedDraw } from '../../src/core/giveaways.js';

const C_MAIN = '610000000000000001';
const users = Array.from({ length: 6 }, (_, i) => String(400000000000000000n + BigInt(i + 1)));
const VIP = '800000000000000050';

async function setup(settings = {}, extra = {}) {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	core.network.activate(owner, OTHER);
	for (const u of users) executor.memberRoles.set(`${MAIN}:${u}`, []);
	executor.roles.set(MAIN, [{ id: VIP, name: 'VIP', position: 2, editable: true, dangerous: false }, { id: '800000000000000051', name: 'Gagnant', position: 1, editable: true, dangerous: false }]);
	const giveaways = createGiveaways({
		db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, sanctions: core.sanctions, stats: core.stats, moderation: core.moderation,
		logger: { warn: () => undefined }, now: () => clock,
	});
	const g = giveaways.create(owner, { prize: 'Voiture de sport', winnersCount: 2, endsAt: Date.now() + 3600_000, settings, targets: [{ guildId: MAIN, channelId: C_MAIN, ping: 'none' }], ...extra });
	await giveaways.publish(owner, g.id);
	return { ...ctx, giveaways, g, advance: (ms) => { clock += ms; } };
}

test('weighted draw: never twice the same person, weights respected', () => {
	const pool = [{ userId: 'a', entries: 1 }, { userId: 'b', entries: 3 }];
	// Ticket 1 of 4 lands on b (a owns ticket 0)
	const picks = weightedDraw(pool, 2, n => (n === 4 ? 1 : 0));
	assert.deepEqual(picks.map(p => p.userId), ['b', 'a']);
	assert.equal(weightedDraw(pool, 5).length, 2);
	let bWins = 0;
	for (let i = 0; i < 2000; i++) if (weightedDraw(pool, 1)[0].userId === 'b') bWins++;
	assert.ok(bWins > 1300 && bWins < 1700, `b should win about 75 %, got ${bWins / 20} %`);
});

test('entering: toggle, bonus entries by role, conditions explained', async () => {
	const { giveaways, g, executor } = await setup({ bonusRoles: [{ roleId: VIP, entries: 3 }], minAccountAgeDays: 1 });
	executor.memberRoles.set(`${MAIN}:${users[0]}`, [VIP]);
	const joined = await giveaways.toggleEntry(g.id, users[0], MAIN);
	assert.equal(joined.entries, 3);
	assert.equal((await giveaways.toggleEntry(g.id, users[0], MAIN)).joined, false);
	const fresh = String((BigInt(Date.now() - 1420070400000) << 22n));
	executor.memberRoles.set(`${MAIN}:${fresh}`, []);
	await assert.rejects(giveaways.toggleEntry(g.id, fresh, MAIN), /compte doit avoir au moins 1/);
	await assert.rejects(giveaways.toggleEntry(g.id, '499999999999999999', MAIN), /plus membre/);
});

test('draw at the end: winners announced, rewarded, ineligible skipped, reroll and claim', async () => {
	const { giveaways, g, executor, owner, advance, core } = await setup({ winnerRoleId: '800000000000000051', winnerRoleDays: 7, claimMinutes: 60 });
	for (const u of users.slice(0, 4)) await giveaways.toggleEntry(g.id, u, MAIN);
	// Someone left the server before the draw: skipped
	executor.memberRoles.delete(`${MAIN}:${users[3]}`);
	advance(3600_000 + 60_000);
	await giveaways.tick();
	const ended = giveaways.get(g.id);
	assert.equal(ended.status, 'ended');
	const winners = ended.winners.filter(w => w.status === 'winner').map(w => w.userId);
	assert.equal(winners.length, 2);
	assert.ok(!winners.includes(users[3]));
	assert.equal(ended.draw.skipped[0].userId, users[3]);
	assert.deepEqual(executor.winnerAnnouncements[0].userIds.sort(), [...winners].sort());
	assert.ok(executor.memberRoles.get(`${MAIN}:${winners[0]}`).includes('800000000000000051'));
	assert.equal(core.moderation.listTempRoles({ userId: winners[0] }).length, 1, 'temporary winner role');

	// First winner claims, the second does not: rerolled after the delay
	giveaways.claim(g.id, winners[0]);
	assert.throws(() => giveaways.claim(g.id, winners[0]), /déjà fait/);
	advance(61 * 60_000);
	await giveaways.tick();
	const after = giveaways.get(g.id).winners;
	assert.equal(after.find(w => w.userId === winners[1]).status, 'expired');
	assert.equal(after.filter(w => w.status === 'winner').length, 2);

	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(giveaways.reroll(alice, g.id), ForbiddenError);
	const more = await giveaways.reroll(owner, g.id);
	assert.ok(more.length <= 1);
});

test('staff exclusion and recent winners', async () => {
	const { giveaways, g, core, owner, executor } = await setup({ excludeStaff: true, excludeRecentWinnersDays: 30 });
	const modo = core.ranks.create(owner, { name: 'Modo', level: 20, permissions: [] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	executor.memberRoles.set(`${MAIN}:${ALICE}`, []);
	await assert.rejects(giveaways.toggleEntry(g.id, ALICE, MAIN), /staff/);
});

test('a giveaway ended twice at once (tick + panel) draws and announces only once', async () => {
	const { giveaways, g, executor, owner, advance } = await setup();
	for (const u of users.slice(0, 5)) await giveaways.toggleEntry(g.id, u, MAIN);
	advance(3600_000 + 60_000);
	await Promise.allSettled([giveaways.tick(), giveaways.end(owner, g.id), giveaways.tick()]);
	const ended = giveaways.get(g.id);
	assert.equal(ended.winners.length, 2, 'no extra winners stored');
	assert.equal(executor.winnerAnnouncements.length, 1);
});

test('a scheduled giveaway is posted once even when two ticks overlap', async () => {
	const { giveaways, executor, owner, advance } = await setup();
	const s = giveaways.create(owner, { prize: 'Plus tard', startsAt: Date.now() + 3600_000, endsAt: Date.now() + 7200_000, targets: [{ guildId: MAIN, channelId: C_MAIN, ping: 'none' }] });
	await giveaways.publish(owner, s.id);
	const posts = () => executor.giveawayMessages.filter(m => m.messageId === null && m.data.giveaway.id === s.id).length;
	advance(3600_000 + 60_000);
	await Promise.all([giveaways.tick(), giveaways.tick()]);
	assert.equal(giveaways.get(s.id).messages.length, 1);
	assert.equal(posts(), 1);
});
