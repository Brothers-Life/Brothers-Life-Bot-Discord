import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { inWindow, nextChange, normalizeSchedule, stateAt } from '../../src/core/channelSchedules.js';
import { zonedTime } from '../../src/core/recurrence.js';
import { renderArchive } from '../../src/core/archives.js';

const TARGET = '300000000000000061';
const STAFF = '610000000000000700';
const paris = (y, mo, d, h, mi) => zonedTime(y, mo, d, h, mi, 'Europe/Paris');

test('appeals: button in the sanction DM, one appeal at a time, accepted lifts the sanction, refused waits for the cooldown', async () => {
	const { core, owner, executor } = await withNetwork();
	executor.members.set(MAIN, new Set([TARGET]));
	const before = await core.sanctions.create(owner, { type: 'timeout', userId: TARGET, reason: 'Spam', durationMs: 3_600_000 });
	assert.equal(executor.dms.at(-1)[3], undefined, 'appeals closed: plain DM');

	assert.throws(() => core.appeals.setConfig(owner, { enabled: true }), /salon/);
	core.appeals.setConfig(owner, { enabled: true, guildId: MAIN, channelId: STAFF, types: ['ban', 'timeout'], cooldownDays: 7 });
	const sanction = await core.sanctions.create(owner, { type: 'ban', userId: TARGET, reason: 'Triche', durationMs: null });
	assert.equal(executor.dms.at(-1)[3].appealSanctionId, sanction.id, 'DM with the appeal button');
	assert.match(executor.dms.at(-1)[1], /faire appel/);

	assert.throws(() => core.appeals.start(ALICE, sanction.id), ForbiddenError, 'only the sanctioned person');
	const { questions } = core.appeals.start(TARGET, sanction.id);
	assert.equal(questions.length, 3);
	await assert.rejects(core.appeals.submit(TARGET, sanction.id, ['', 'x']), /première question/);
	const appeal = await core.appeals.submit(TARGET, sanction.id, ['Je ne trichais pas', 'Regardez la vidéo', '']);
	assert.equal(executor.appealMessages.at(-1).channelId, STAFF);
	assert.throws(() => core.appeals.start(TARGET, sanction.id), /en cours d’examen/);

	await assert.rejects(core.appeals.decide({ id: ALICE, can: () => false }, appeal.id, true), ForbiddenError);
	const refused = await core.appeals.decide(owner, appeal.id, false, 'Preuves claires');
	assert.equal(refused.status, 'rejected');
	assert.match(executor.dms.at(-1)[1], /refusé[\s\S]*Preuves claires[\s\S]*7 jours/);
	assert.equal(executor.appealMessages.at(-1).view.status, 'rejected', 'staff message updated');
	assert.throws(() => core.appeals.start(TARGET, sanction.id), /pourras en refaire un/);

	// Another sanction, accepted: lifted
	const timeout = await core.sanctions.create(owner, { type: 'timeout', userId: TARGET, reason: 'Insultes', durationMs: 3_600_000 });
	const second = await core.appeals.submit(TARGET, timeout.id, ['Malentendu']);
	await core.appeals.decide(owner, second.id, true, 'Ok pour cette fois');
	assert.ok(core.sanctions.get(timeout.id).revokedAt, 'sanction lifted');
	assert.match(executor.dms.at(-1)[1], /accepté/);
	assert.equal(core.appeals.list(owner).length, 2);
	assert.ok(before.id, 'earlier sanctions untouched');
});

test('schedules: weekly slots (past midnight too) and dated periods, Paris time, next change', () => {
	const rule = normalizeSchedule({
		name: 'Soirées', channelIds: ['610000000000000801'], mode: 'open_during',
		weekly: [{ days: [5, 6], from: '20:00', to: '02:00' }],
		dates: [{ from: paris(2026, 12, 24, 18, 0), to: paris(2026, 12, 26, 10, 0), label: 'Noël' }],
	});
	assert.equal(stateAt(rule, paris(2026, 10, 2, 21, 0)), 'open', 'Friday 21:00');
	assert.equal(stateAt(rule, paris(2026, 10, 3, 1, 30)), 'open', 'Saturday 01:30, still Friday night');
	assert.equal(stateAt(rule, paris(2026, 10, 3, 2, 0)), 'closed');
	assert.equal(stateAt(rule, paris(2026, 10, 1, 21, 0)), 'closed', 'Thursday');
	assert.equal(inWindow(rule, paris(2026, 12, 25, 12, 0)), true, 'Christmas day (a Friday… and a dated period)');
	const next = nextChange(rule, paris(2026, 10, 1, 12, 0));
	assert.deepEqual([next.at, next.state], [paris(2026, 10, 2, 20, 0), 'open']);
	assert.throws(() => normalizeSchedule({ name: 'x', channelIds: ['610000000000000801'] }), ValidationError);
	assert.throws(() => normalizeSchedule({ name: 'x', channelIds: ['610000000000000801'], weekly: [{ days: [1], from: '25:00', to: '10:00' }] }), /Heure invalide/);
});

test('schedules: channels closed and opened by the tick, a message says until when; deleting opens them', async () => {
	let clock = paris(2026, 10, 1, 21, 0);
	const ctx = await withNetwork();
	const { createChannelSchedules } = await import('../../src/core/channelSchedules.js');
	const schedules = createChannelSchedules({ db: ctx.core.db, network: ctx.core.network, audit: ctx.core.audit, executor: ctx.executor, logger: { warn: () => undefined }, now: () => clock });
	const saved = await schedules.save(ctx.owner, { guildId: MAIN, name: 'Event', channelIds: ['610000000000000801', '610000000000000802'], mode: 'open_during', lockType: 'write', weekly: [{ days: [5], from: '20:00', to: '23:00' }] });
	assert.equal(saved.state, 'closed');
	assert.deepEqual(ctx.executor.access.map(a => a.closed), [true, true], 'closed at once');
	assert.equal(ctx.executor.messages.length, 0, 'no message the first time');
	clock = paris(2026, 10, 2, 20, 1);
	await schedules.tick();
	assert.equal(ctx.executor.access.at(-1).closed, false);
	assert.match(ctx.executor.messages.at(-1).payload.content, /Salon ouvert ![\s\S]*Fermeture <t:/);
	await schedules.tick();
	assert.equal(ctx.executor.access.length, 4, 'nothing done when nothing changes');
	clock = paris(2026, 10, 2, 23, 30);
	await schedules.tick();
	await schedules.remove(ctx.owner, saved.id);
	assert.equal(ctx.executor.access.at(-1).closed, false, 'deleted: opened again');
	await assert.rejects(schedules.save({ id: BOB, can: () => false }, { guildId: MAIN }), ForbiddenError);
});

test('archives: the channel saved as an HTML page (escaped), downloadable, deletable', async () => {
	const { core, owner, executor } = await withNetwork();
	executor.channels.set('610000000000000900', { guildId: MAIN, name: 'general' });
	executor.history.set('610000000000000900', [
		{ id: '1', authorName: 'Alice', authorAvatar: '', bot: false, content: 'Salut **tout le monde** <script>alert(1)</script>', createdAt: Date.now() - 60_000, attachments: [], embeds: [] },
		{ id: '2', authorName: 'Bot', authorAvatar: '', bot: true, content: '', createdAt: Date.now(), attachments: [{ name: 'doc.pdf', url: 'https://example.com/doc.pdf' }], embeds: [{ title: 'Annonce', description: 'Texte', color: '#ff9628' }] },
	]);
	const archive = await core.archives.create({ ...owner, name: 'Pedro' }, { guildId: MAIN, channelId: '610000000000000900', limit: 50 });
	assert.deepEqual([archive.channelName, archive.messageCount], ['general', 2]);
	const html = fs.readFileSync(core.archives.pathOf(archive), 'utf8');
	assert.match(html, /<strong>tout le monde<\/strong>/);
	assert.ok(!html.includes('<script>alert'), 'escaped');
	assert.match(html, /doc\.pdf/);
	assert.match(html, /archivé le .* par Pedro/);
	core.archives.remove(owner, archive.id);
	assert.equal(fs.existsSync(core.archives.pathOf(archive)), false);
	assert.match(renderArchive({ guildName: 'G', channelName: 'c', messages: [], createdAt: Date.now(), createdBy: 'x' }), /Aucun message/);
});

test('schedules: two ticks at once open the channels once; editing out a channel posts nothing in the others', async () => {
	let clock = paris(2026, 10, 1, 21, 0);
	const ctx = await withNetwork();
	const { createChannelSchedules } = await import('../../src/core/channelSchedules.js');
	const schedules = createChannelSchedules({ db: ctx.core.db, network: ctx.core.network, audit: ctx.core.audit, executor: ctx.executor, logger: { warn: () => undefined }, now: () => clock });
	const input = { guildId: MAIN, name: 'Event', channelIds: ['610000000000000801', '610000000000000802'], mode: 'open_during', lockType: 'write', weekly: [{ days: [5], from: '20:00', to: '23:00' }] };
	const saved = await schedules.save(ctx.owner, input);
	clock = paris(2026, 10, 2, 20, 1);
	await Promise.all([schedules.tick(), schedules.tick()]);
	assert.equal(ctx.executor.messages.length, 2, 'one « open » message per channel');
	clock = paris(2026, 10, 2, 23, 30);
	await schedules.tick();
	const before = ctx.executor.messages.length;
	await schedules.save(ctx.owner, { ...input, id: saved.id, channelIds: ['610000000000000801'] });
	await schedules.tick();
	assert.equal(ctx.executor.messages.length, before, 'still closed: no new « closed » message');
});
