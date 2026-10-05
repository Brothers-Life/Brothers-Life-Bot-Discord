import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { formatDuration } from '../../src/core/duration.js';
import { createAntiraid } from '../../src/core/antiraid.js';
import { createRecruitment } from '../../src/core/recruitment.js';
import { scopeOf } from '../../src/bot/moderation.js';

const TARGET = '300000000000000071';
const STAFF = '610000000000000710';

const options = values => ({ commandName: values.commandName, options: { getBoolean: name => values[name] ?? null } });

test('/kick defaults to this server, the network only when asked', () => {
	assert.equal(scopeOf(options({ commandName: 'kick' })), 'local');
	assert.equal(scopeOf(options({ commandName: 'kick', local: true })), 'local');
	assert.equal(scopeOf(options({ commandName: 'kick', local: false })), 'network');
	assert.equal(scopeOf(options({ commandName: 'kick', reseau: true })), 'network');
	assert.equal(scopeOf(options({ commandName: 'ban' })), 'network', 'other commands unchanged');
	assert.equal(scopeOf(options({ commandName: 'ban', local: true })), 'local');
});

test('sanction DM names the server for a local sanction, the network otherwise; restriction without end', async () => {
	const { core, owner, executor } = await withNetwork();
	core.network.activate(owner, OTHER);
	await core.sanctions.create(owner, { type: 'warn', userId: TARGET, reason: 'Spam', scope: 'local', originGuildId: OTHER });
	assert.match(executor.dms.at(-1)[1], /averti\*\* sur \*\*Other\*\*/);
	await core.sanctions.create(owner, { type: 'warn', userId: TARGET, reason: 'Spam' });
	assert.match(executor.dms.at(-1)[1], /sur le réseau Brothers Life/);
	const profile = core.restrictions.profiles()[0].key;
	await core.sanctions.create(owner, { type: 'restrict', userId: TARGET, profile, scope: 'local', originGuildId: MAIN });
	assert.match(executor.dms.at(-1)[1], /Durée : jusqu’à levée/);
	assert.equal(formatDuration(null, 'jusqu’à levée'), 'jusqu’à levée');
	assert.equal(formatDuration(null), 'définitif');
});

test('lifting a sanction DMs the person once (not twice for an accepted appeal)', async () => {
	const { core, owner, executor } = await withNetwork();
	const ban = await core.sanctions.create(owner, { type: 'ban', userId: TARGET, reason: 'Triche', scope: 'local', originGuildId: MAIN });
	await core.sanctions.revoke(owner, ban.id, 'Erreur');
	assert.match(executor.dms.at(-1)[1], new RegExp(`Ta sanction #${ban.id} \\(bannissement\\) sur \\*\\*Main\\*\\* a été levée`));

	const warn = await core.sanctions.create(owner, { type: 'warn', userId: TARGET, reason: 'x' });
	await core.sanctions.revoke(owner, warn.id);
	assert.match(executor.dms.at(-1)[1], new RegExp(`#${warn.id} \\(avertissement\\) sur le réseau a été levée`));

	core.appeals.setConfig(owner, { enabled: true, guildId: MAIN, channelId: STAFF, types: ['timeout'] });
	const timeout = await core.sanctions.create(owner, { type: 'timeout', userId: TARGET, durationMs: 3_600_000 });
	const appeal = await core.appeals.submit(TARGET, timeout.id, ['Malentendu']);
	const before = executor.dms.length;
	await core.appeals.decide(owner, appeal.id, true);
	assert.equal(executor.dms.length, before + 1, 'only the appeal DM');
	assert.match(executor.dms.at(-1)[1], /accepté/);
});

test('an appeal on a sanction that ended meanwhile is closed as moot, never "refusé"', async () => {
	const { core, owner, executor } = await withNetwork();
	core.appeals.setConfig(owner, { enabled: true, guildId: MAIN, channelId: STAFF, types: ['ban'] });
	const ban = await core.sanctions.create(owner, { type: 'ban', userId: TARGET, reason: 'Triche' });
	const appeal = await core.appeals.submit(TARGET, ban.id, ['Pardon']);
	await core.sanctions.revoke(owner, ban.id, 'Fin');
	const done = await core.appeals.decide(owner, appeal.id, false, 'Non');
	assert.equal(done.moot, true);
	assert.match(executor.dms.at(-1)[1], new RegExp(`Ta sanction #${ban.id} est déjà terminée, ton appel est clos`));
	assert.equal(executor.dms.some(d => /refusé/.test(d[1])), false);
});

test('anti-raid kicks: neutral DM, not counted for applications, removable from the history', async () => {
	const { core, owner, executor } = await withNetwork();
	const antiraid = createAntiraid({ db: core.db, network: core.network, audit: core.audit, executor, sanctions: core.sanctions, logs: core.logs, logger: { warn: () => undefined } });
	antiraid.save(owner, MAIN, { enabled: true, newAccount: { enabled: true, minAgeDays: 7, action: 'kick' } });
	executor.members.set(MAIN, new Set([TARGET]));
	await antiraid.handleJoin(MAIN, { id: TARGET, username: 'new', bot: false, createdAt: Date.now() - 86_400_000 });
	assert.ok(executor.calls.some(c => c[0] === 'kick' && c[2] === TARGET));
	assert.equal(executor.dms.length, 1);
	assert.match(executor.dms[0][1], /Ton compte est trop récent pour rejoindre \*\*Main\*\* pour le moment/);
	assert.doesNotMatch(executor.dms[0][1], /expulsé/);
	const [kick] = core.sanctions.list({ userId: TARGET });
	assert.equal(kick.automatic, true);

	const recruitment = createRecruitment({ db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, sanctions: core.sanctions, stats: core.stats, logger: { warn: () => undefined } });
	executor.memberRoles.set(`${MAIN}:${TARGET}`, []);
	const position = recruitment.savePosition(owner, MAIN, { name: 'Modo', config: { reviewChannelId: STAFF, requirements: { noSanctionDays: 30 } } });
	await recruitment.startApplication(position.id, TARGET, MAIN);

	const removed = await core.sanctions.revoke(owner, kick.id, 'Faux positif');
	assert.ok(removed.revokedAt);
	assert.equal(executor.calls.filter(c => c[2] === TARGET).length, 1, 'no Discord action');
	assert.equal(core.audit.query({ action: 'sanctions.unkick' }).length, 1);

	// A kick by the staff still counts
	await core.sanctions.create(owner, { type: 'kick', userId: TARGET, scope: 'local', originGuildId: MAIN });
	await assert.rejects(recruitment.startApplication(position.id, TARGET, MAIN), /Aucune sanction/);
});

test('verification: auto roles after verification, no kick for young accounts, wait after 3 wrong codes', async () => {
	const { core, owner, executor } = await withNetwork();
	const VERIFIED = '800000000000000201';
	const AUTO = '800000000000000202';
	core.onboarding.save(owner, MAIN, { autoroles: { humanRoleIds: [AUTO], botRoleIds: [] } });
	core.verification.setConfig(owner, MAIN, { enabled: true, mode: 'captcha', verifiedRoleId: VERIFIED, minAccountAgeDays: 7, kickAfterMinutes: 30 });
	executor.members.set(MAIN, new Set([TARGET, ALICE]));

	await core.onboarding.memberJoined(MAIN, { id: TARGET, username: 'lea', bot: false });
	await core.verification.memberJoined(MAIN, TARGET);
	assert.equal((executor.memberRoles.get(`${MAIN}:${TARGET}`) ?? []).includes(AUTO), false, 'waits for the verification');
	const { code } = await core.verification.start(MAIN, TARGET, { accountCreatedAt: Date.now() - 90 * 86_400_000 });
	await core.verification.answer(MAIN, TARGET, code);
	assert.ok(executor.memberRoles.get(`${MAIN}:${TARGET}`).includes(AUTO), 'given once verified');

	// Young account: clear message, then never kicked for it
	await core.verification.memberJoined(MAIN, ALICE);
	await assert.rejects(core.verification.start(MAIN, ALICE, { accountCreatedAt: Date.now() - 86_400_000 }), /au moins 7 jours[\s\S]*pas expulsé/);
	core.db.prepare('UPDATE verification_pending SET joined_at = ?').run(Date.now() - 60 * 60_000);
	await core.verification.tick();
	assert.equal(executor.calls.some(c => c[0] === 'kick' && c[2] === ALICE), false);

	// Three wrong codes: a real wait before a new one
	const old = { accountCreatedAt: Date.now() - 90 * 86_400_000 };
	const OTHER_USER = '300000000000000072';
	await core.verification.start(MAIN, OTHER_USER, old);
	await assert.rejects(core.verification.answer(MAIN, OTHER_USER, 'ZZZZZ'));
	await assert.rejects(core.verification.answer(MAIN, OTHER_USER, 'ZZZZZ'));
	await assert.rejects(core.verification.answer(MAIN, OTHER_USER, 'ZZZZZ'), /10 minutes/);
	await assert.rejects(core.verification.start(MAIN, OTHER_USER, old), /<t:\d+:R>/);
});
