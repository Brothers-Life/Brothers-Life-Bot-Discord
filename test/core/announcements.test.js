import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { normalizePayload } from '../../src/core/announcements.js';

const MAIN_CHANNEL = '610000000000000001';
const OTHER_CHANNEL = '620000000000000001';

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	core.network.activate(owner, OTHER);
	executor.channels.set(MAIN_CHANNEL, { guildId: MAIN, name: 'annonces' });
	executor.channels.set(OTHER_CHANNEL, { guildId: OTHER, name: 'news' });
	return ctx;
}

const payload = { content: 'Grosse nouvelle !', embed: { title: 'Mise à jour', description: 'Le serveur RP ouvre samedi', color: '#5865F2', fields: [{ name: 'Quand', value: 'Samedi 20h', inline: true }, { name: '', value: 'ignoré' }] } };
const targets = [
	{ guildId: MAIN, channelId: MAIN_CHANNEL, ping: 'everyone', publish: true },
	{ guildId: OTHER, channelId: OTHER_CHANNEL, ping: 'roles', roleIds: ['810000000000000001'] },
];

test('payload: limits, colors, https URLs, empty messages', () => {
	const clean = normalizePayload(payload);
	assert.equal(clean.embed.color, '#5865f2');
	assert.equal(clean.embed.fields.length, 1, 'empty fields are dropped');
	assert.throws(() => normalizePayload({ embed: { enabled: false } }), /vide/);
	assert.throws(() => normalizePayload({ content: 'x', embed: { imageUrl: 'http://insecure.png' } }), /https/);
	assert.throws(() => normalizePayload({ content: 'x'.repeat(2001) }), /trop long/);
	assert.throws(() => normalizePayload({ embed: { description: 'x'.repeat(4000), fields: [{ name: 'a', value: 'b'.repeat(1000) }, { name: 'c', value: 'd'.repeat(1000) }] } }), /6000/);
});

test('create a draft, send it everywhere with the pings of each channel', async () => {
	const { core, owner, executor } = await setup();
	const draft = await core.announcements.create(owner, { name: 'Ouverture RP', payload, targets });
	assert.equal(draft.status, 'draft');

	const sent = await core.announcements.send(owner, draft.id);
	assert.equal(sent.status, 'sent');
	assert.equal(sent.results.length, 2);
	assert.ok(sent.results.every(r => r.ok && r.messageId));
	assert.deepEqual(executor.announcements.map(a => [a.channelId, a.target.ping]), [[MAIN_CHANNEL, 'everyone'], [OTHER_CHANNEL, 'roles']]);
	await assert.rejects(core.announcements.send(owner, draft.id), ValidationError, 'not twice');
	await assert.rejects(core.announcements.update(owner, draft.id, { name: 'x' }), /duplique/);
});

test('partial failure is reported per channel', async () => {
	const { core, owner, executor } = await setup();
	const draft = await core.announcements.create(owner, { name: 'Test', payload, targets });
	executor.failOn.add(OTHER_CHANNEL);
	const sent = await core.announcements.send(owner, draft.id);
	assert.equal(sent.status, 'partial');
	assert.equal(sent.results.find(r => r.channelId === OTHER_CHANNEL).ok, false);
});

test('@everyone needs its own permission; managing needs announcements.manage', async () => {
	const { core, owner } = await setup();
	const writer = core.ranks.create(owner, { name: 'Com', level: 20, permissions: ['announcements.manage'] });
	await core.ranks.assignDirect(owner, ALICE, writer.id);
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(core.announcements.create(alice, { name: 'x', payload, targets }), ForbiddenError);
	const ok = await core.announcements.create(alice, { name: 'x', payload, targets: [targets[1]] });
	assert.equal(ok.targets.length, 1);

	const nobody = await core.ranks.resolve('300000000000000009');
	await assert.rejects(core.announcements.create(nobody, { name: 'x', payload, targets: [] }), ForbiddenError);
});

test('channels must exist on network servers; the same channel only once', async () => {
	const { core, owner } = await setup();
	await assert.rejects(core.announcements.create(owner, { name: 'x', payload, targets: [{ guildId: MAIN, channelId: '699999999999999999' }] }), /n’existe plus/);
	await assert.rejects(core.announcements.create(owner, { name: 'x', payload, targets: [targets[0], targets[0]] }), /deux fois/);
});

test('scheduling: sent by the scheduler once due, can be cancelled', async () => {
	const { core, owner, executor } = await setup();
	const draft = await core.announcements.create(owner, { name: 'Plus tard', payload, targets });
	await assert.rejects(core.announcements.schedule(owner, draft.id, Date.now() - 1000), /futur/);
	const scheduled = await core.announcements.schedule(owner, draft.id, Date.now() + 60_000);
	assert.equal(scheduled.status, 'scheduled');
	assert.equal(await core.announcements.sendDue(), 0, 'not yet');

	core.db.prepare('UPDATE announcements SET scheduled_at = ? WHERE id = ?').run(Date.now() - 1, draft.id);
	assert.equal(await core.announcements.sendDue(), 1);
	assert.equal(core.announcements.get(draft.id).status, 'sent');
	assert.equal(executor.announcements.length, 2);

	const other = await core.announcements.create(owner, { name: 'Annulée', payload, targets });
	await core.announcements.schedule(owner, other.id, Date.now() + 60_000);
	assert.equal(core.announcements.unschedule(owner, other.id).status, 'draft');
});

test('duplicate and delete: drafts disappear, sent messages are removed from Discord', async () => {
	const { core, owner, executor } = await setup();
	const draft = await core.announcements.create(owner, { name: 'Original', payload, targets });
	const sent = await core.announcements.send(owner, draft.id);
	const copy = await core.announcements.duplicate(owner, sent.id);
	assert.equal(copy.status, 'draft');
	assert.equal(copy.name, 'Original (copie)');

	const removed = await core.announcements.remove(owner, sent.id);
	assert.equal(removed.status, 'deleted');
	assert.equal(executor.deleted.length, 2);
	assert.equal(await core.announcements.remove(owner, copy.id), null);
	assert.equal(core.announcements.list().length, 1);
});
