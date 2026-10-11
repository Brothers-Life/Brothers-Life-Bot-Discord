import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';

const MEMBER = '300000000000000021';
const NOTIFY = '610000000000000007';

test('writing to someone: conversation created, signed message, closed DMs reported clearly', async () => {
	const { core, owner, executor } = await withNetwork();
	const events = [];
	core.dms.subscribe(e => events.push(e.type));
	const thread = await core.dms.open(owner, MEMBER, 'lea');
	const sent = await core.dms.send(owner, thread.id, { content: 'Salut, ton dossier est accepté.' });
	assert.equal(sent.direction, 'out');
	assert.match(executor.directs.at(-1).content, /Salut[\s\S]*-# — Équipe Brothers Life/);
	await core.dms.send(owner, thread.id, { content: 'Signé', signed: true, authorName: 'Pedro' });
	assert.match(executor.directs.at(-1).content, /-# — Pedro$/);

	executor.dmsClosed.add(MEMBER);
	await assert.rejects(core.dms.send(owner, thread.id, { content: 'x' }), /messages privés sont fermés/);
	assert.equal((await core.dms.get(thread.id)).dmsClosed, true);
	assert.ok(events.includes('message'));
	await assert.rejects(core.dms.send(owner, thread.id, { content: '' }), /vide/);
});

test('replies arrive in the conversation (unread); unknown people are ignored unless first contact is on', async () => {
	const { core, owner, executor } = await withNetwork();
	assert.equal(await core.dms.receive({ userId: MEMBER, content: 'Bonjour ?' }), null, 'no conversation and no first contact');

	await core.dms.setConfig(owner, { modmail: true, notify: { guildId: '100000000000000001', channelId: NOTIFY } });
	const thread = await core.dms.receive({ userId: MEMBER, userName: 'lea', content: 'Bonjour, une question', attachments: [{ name: 'a.png', url: 'https://cdn/a.png' }] });
	assert.equal(thread.unread, 1);
	assert.equal(thread.startedBy, 'user');
	assert.match(executor.directs.at(-1).content, /bien été transmis/);
	assert.equal(executor.messages.at(-1).channelId, NOTIFY);
	assert.deepEqual((await core.dms.messages(thread.id)).map(m => m.direction), ['in', 'system']);

	await core.dms.receive({ userId: MEMBER, content: 'Encore moi' });
	assert.equal((await core.dms.get(thread.id)).unread, 2);
	assert.equal(await core.dms.unreadCount(), 2);
	await core.dms.markRead(owner, thread.id);
	assert.equal((await core.dms.get(thread.id)).unread, 0);

	await core.dms.setStatus(owner, thread.id, 'closed');
	await core.dms.block(owner, MEMBER, 'spam');
	assert.equal(await core.dms.receive({ userId: MEMBER, content: 'spam' }), null);
	await core.dms.unblock(owner, MEMBER);
	const reopened = await core.dms.receive({ userId: MEMBER, content: 'pardon' });
	assert.equal(reopened.status, 'open');
});

test('notes, assignment, quick replies and permissions', async () => {
	const { core, owner } = await withNetwork();
	const reader = await core.ranks.create(owner, { name: 'Lecteur', level: 5, permissions: ['panel.access', 'dm.view'] });
	await core.ranks.assignDirect(owner, ALICE, reader.id);
	const alice = await core.ranks.resolve(ALICE);
	const thread = await core.dms.open(owner, MEMBER);
	await assert.rejects(async () => core.dms.open(alice, BOB), ForbiddenError);
	await assert.rejects(core.dms.send(alice, thread.id, { content: 'x' }), ForbiddenError);
	await core.dms.addNote(alice, thread.id, 'Déjà vu en ticket');
	assert.equal((await core.dms.messages(thread.id)).at(-1).direction, 'note');
	assert.equal((await core.dms.assign(owner, thread.id, ALICE)).assignedTo, ALICE);
	const snippet = await core.dms.saveSnippet(owner, { name: 'Merci', content: 'Merci pour ton message !' });
	assert.equal((await core.dms.snippets())[0].id, snippet.id);
	await assert.rejects(async () => core.dms.saveSnippet(alice, { name: 'x', content: 'y' }), ForbiddenError);
});
