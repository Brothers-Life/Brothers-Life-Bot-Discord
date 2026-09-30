import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN } from '../helpers.js';
import { createAnnouncements, normalizeOptions } from '../../src/core/announcements.js';
import { nextOccurrence, normalizeRecurrence, zonedParts } from '../../src/core/recurrence.js';

const CHANNEL = '610000000000000001';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex');

async function setup() {
	let clock = Date.UTC(2026, 9, 24, 10, 0);
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	executor.channels.set(CHANNEL, { guildId: MAIN, name: 'annonces' });
	const announcements = createAnnouncements({ db: core.db, network: core.network, audit: core.audit, executor, logs: core.logs, uploads: core.uploads, logger: { warn: () => undefined, error: () => undefined }, now: () => clock });
	return { ...ctx, announcements, advance: (ms) => { clock += ms; }, at: () => clock };
}

const target = { guildId: MAIN, channelId: CHANNEL, ping: 'none' };

test('recurrence: Paris wall clock across daylight saving time, weekly days, last day of short months, end conditions', () => {
	const daily = normalizeRecurrence({ type: 'daily', time: '09:00' });
	const first = nextOccurrence(daily, Date.UTC(2026, 9, 24, 0, 0));
	const second = nextOccurrence(daily, first);
	assert.equal(zonedParts(first, 'Europe/Paris').hour, 9);
	assert.equal(zonedParts(second, 'Europe/Paris').hour, 9, 'still 9:00 after the clocks go back');
	assert.equal(second - first, 25 * 3_600_000);

	const weekly = normalizeRecurrence({ type: 'weekly', time: '18:30', days: [1, 3] });
	assert.equal(zonedParts(nextOccurrence(weekly, Date.UTC(2026, 9, 24)), 'Europe/Paris').weekday, 1);
	const monthly = normalizeRecurrence({ type: 'monthly', time: '10:00', dayOfMonth: 31 });
	assert.equal(zonedParts(nextOccurrence(monthly, Date.UTC(2026, 10, 1)), 'Europe/Paris').day, 30);

	assert.equal(nextOccurrence(normalizeRecurrence({ type: 'daily', time: '09:00', maxRuns: 2 }), first, { runs: 2 }), null);
	assert.equal(nextOccurrence(normalizeRecurrence({ type: 'daily', time: '09:00', endAt: first + 1000 }), first), null);
	assert.throws(() => normalizeRecurrence({ type: 'weekly', time: '10:00', days: [] }), /jour/);
	assert.throws(() => normalizeRecurrence({ type: 'interval', everyHours: 0 }), /Intervalle/);
});

test('options: buttons, reactions, gallery and attachment limits', () => {
	const o = normalizeOptions({ pin: true, reactions: ['🎉', '🎉', '<:brl:123456789012345678>'], buttons: [{ label: 'Site', url: 'https://brl.fr' }], thread: { enabled: true, name: 'Réagissez' } });
	assert.deepEqual(o.reactions, ['🎉', '<:brl:123456789012345678>']);
	assert.equal(o.thread.name, 'Réagissez');
	assert.throws(() => normalizeOptions({ buttons: [{ label: 'x', url: 'http://a' }] }), /https/);
	assert.throws(() => normalizeOptions({ buttons: Array.from({ length: 6 }, () => ({ label: 'x', url: 'https://a.fr' })) }), /5 boutons/);
	assert.throws(() => normalizeOptions({ gallery: ['https://a/1.png', 'https://a/2.png', 'https://a/3.png', 'https://a/4.png'] }), /3 images/);
	assert.throws(() => normalizeOptions({ attachments: ['https://a/1.png'] }), /panel/);
	assert.throws(() => normalizeOptions({ autoDeleteHours: 1000 }), /720/);
});

test('panel images become attachments, variables are filled, send options and auto-delete', async () => {
	const { core, owner, executor, announcements, advance } = await setup();
	const { id } = core.uploads.save(PNG);
	await assert.rejects(announcements.create(owner, { name: 'x', payload: { content: 'x', embed: { imageUrl: 'upload:0123456789abcdef0123456789abcdef.png' } } }), /n’existe plus/);
	const a = await announcements.create(owner, {
		name: 'Soirée', targets: [target],
		payload: { content: 'Bienvenue sur {server} ({memberCount} membres) — {date}', embed: { title: 'Soirée', imageUrl: `upload:${id}` } },
		options: { pin: true, reactions: ['🎉'], gallery: ['https://cdn.brl.fr/2.png'], buttons: [{ label: 'Infos', url: 'https://brl.fr' }], autoDeleteHours: 2 },
	});
	await announcements.send(owner, a.id);
	const sent = executor.announcements.at(-1);
	assert.equal(sent.payload.embed.imageUrl, `attachment://${id}`);
	assert.equal(sent.options.files[0].name, id);
	assert.match(sent.payload.content, /Bienvenue sur .+ \(\d+ membres\) — \w+ 24 octobre 2026/);
	assert.equal(sent.options.pin, true);
	assert.deepEqual(sent.options.reactions, ['🎉']);

	const { messageId } = announcements.get(a.id).results[0];
	await announcements.sendDue();
	assert.equal(executor.deleted.length, 0, 'not yet');
	advance(3 * 3_600_000);
	await announcements.sendDue();
	assert.deepEqual(executor.deleted.at(-1), [CHANNEL, messageId]);
});

test('recurring announcement: sent, planned again, stops after N sends; calendar expands it', async () => {
	const { owner, executor, announcements, advance, at } = await setup();
	const a = await announcements.create(owner, { name: 'Rappel', targets: [target], payload: { content: 'Pensez à voter !' } });
	const scheduled = await announcements.schedule(owner, a.id, null, { type: 'daily', time: '20:00', maxRuns: 2 });
	assert.equal(zonedParts(scheduled.scheduledAt, 'Europe/Paris').hour, 20);
	const cal = announcements.calendar(at(), at() + 7 * 86_400_000);
	assert.equal(cal.length, 2);

	advance(scheduled.scheduledAt - at() + 1000);
	await announcements.sendDue();
	const again = announcements.get(a.id);
	assert.equal(again.status, 'scheduled');
	assert.equal(again.runCount, 1);
	assert.equal(again.scheduledAt - scheduled.scheduledAt, 25 * 3_600_000, 'the clocks go back that night');
	assert.equal(zonedParts(again.scheduledAt, 'Europe/Paris').hour, 20);

	advance(25 * 3_600_000);
	await announcements.sendDue();
	const done = announcements.get(a.id);
	assert.equal(done.status, 'sent');
	assert.equal(done.runCount, 2);
	assert.equal(done.history.length, 2);
	assert.equal(executor.announcements.length, 2);
});

test('templates: saved, listed, deleted', async () => {
	const { owner, announcements } = await setup();
	const t = announcements.saveTemplate(owner, { name: 'Maintenance', payload: { embed: { title: 'Maintenance ce soir' } }, options: { pin: true } });
	assert.equal(announcements.templates()[0].options.pin, true);
	announcements.deleteTemplate(owner, t.id);
	assert.equal(announcements.templates().length, 0);
});
