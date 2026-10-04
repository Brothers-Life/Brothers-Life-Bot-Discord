import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { createNotifications } from '../../src/core/notifications.js';
import { attachNotificationSources } from '../../src/core/notificationSources.js';

const CAROL = '100000000000000004';
const flush = () => new Promise(resolve => setImmediate(resolve));

async function withRank(core, owner, userId, name, permissions) {
	const rank = core.ranks.create(owner, { name, level: 10, permissions: ['panel.access', ...permissions] });
	await core.ranks.assignDirect(owner, userId, rank.id);
	core.ranks.invalidate?.(userId);
	return core.ranks.resolve(userId);
}

async function setup() {
	const ctx = await withNetwork();
	const { core, owner } = ctx;
	const alice = await withRank(core, owner, ALICE, 'Support', ['tickets.view']);
	const bob = await withRank(core, owner, BOB, 'Modo', ['antiraid.view', 'absences.manage']);
	return { ...ctx, alice, bob };
}

test('permission filtering: only holders see it, never the author, a targeted one only for its user', async () => {
	const { core, alice, bob, owner } = await setup();
	const n = core.notifications;
	n.push({ permission: 'tickets.view', title: 'Ticket', url: '/tickets', guildId: MAIN });
	n.push({ permission: 'antiraid.view', title: 'Raid', actorId: BOB });
	n.push({ type: 'ticket_assigned', userId: ALICE, title: 'Pour Alice', url: '/ticket/1' });

	assert.deepEqual(n.list(alice).items.map(x => x.title), ['Pour Alice', 'Ticket']);
	assert.deepEqual(n.list(bob).items.map(x => x.title), [], 'his own raid action is not notified, no tickets.view');
	assert.deepEqual(n.list(owner).items.map(x => x.title), ['Raid', 'Ticket'], 'the owner holds everything but is not Alice');
	const carol = await core.ranks.resolve(CAROL);
	assert.equal(n.list(carol).items.length, 0, 'no panel access: nothing');
});

test('unread count, mark read one by one or all', async () => {
	const { core, alice } = await setup();
	const n = core.notifications;
	const a = n.push({ permission: 'tickets.view', title: 'A' });
	n.push({ permission: 'tickets.view', title: 'B' });
	assert.equal(n.unreadCount(alice), 2);
	assert.equal(n.markRead(alice, [a.id]).unread, 1);
	assert.equal(n.list(alice).items.find(x => x.id === a.id).read, true);
	assert.equal(n.markAllRead(alice).unread, 0);
	n.push({ permission: 'tickets.view', title: 'C' });
	assert.equal(n.unreadCount(alice), 1, 'new ones after "all read" are unread');
});

test('preferences mute a type; only known types are kept; links stay inside the panel', async () => {
	const { core, alice } = await setup();
	const n = core.notifications;
	assert.ok(n.prefs(alice).types.some(t => t.key === 'ticket_new'));
	assert.ok(!n.prefs(alice).types.some(t => t.key === 'antiraid'), 'types she could never get are hidden');
	assert.deepEqual(n.setPrefs(alice, { disabled: ['ticket_new', 'nope'] }).disabled, ['ticket_new']);
	n.push({ type: 'ticket_new', title: 'Muet' });
	n.push({ permission: 'tickets.view', title: 'Autre', url: 'https://evil.example' });
	const items = n.list(alice).items;
	assert.deepEqual(items.map(x => x.title), ['Autre']);
	assert.equal(items[0].url, null);
	assert.throws(() => n.push({ type: 'unknown', title: 'x' }), /Unknown notification type/);
	n.registerType('tebex_sale', { label: 'Ventes Tebex', permission: 'tickets.view' });
	n.push({ type: 'tebex_sale', title: 'Vente' });
	assert.equal(n.list(alice).items[0].title, 'Vente', 'the type permission applies by default');
});

test('live listeners get every push; visibleTo filters per user', async () => {
	const { core, alice, bob } = await setup();
	const seen = [];
	const stop = core.notifications.subscribe(x => seen.push(x));
	const pushed = core.notifications.push({ permission: 'tickets.view', title: 'Live' });
	stop();
	core.notifications.push({ permission: 'tickets.view', title: 'After' });
	assert.deepEqual(seen.map(x => x.title), ['Live']);
	assert.equal(core.notifications.visibleTo(alice, pushed), true);
	assert.equal(core.notifications.visibleTo(bob, pushed), false);
});

test('sources: audited actions become notifications (pending absence, raid, ticket opened, transfer)', async () => {
	const { core, alice, bob } = await setup();
	core.audit.record({ actorId: CAROL, source: 'bot', action: 'tickets.open', guildId: MAIN, target: '12', details: { number: 12, opener: 'Carol', category: 'Support' } });
	core.audit.record({ actorId: CAROL, source: 'panel', action: 'absences.declare', target: CAROL, details: { member: `<@${CAROL}>`, until: '2026-10-20T00:00:00.000Z', pending: true } });
	core.audit.record({ actorId: CAROL, source: 'panel', action: 'absences.declare', target: CAROL, details: { member: `<@${CAROL}>`, pending: false } });
	core.audit.record({ actorId: 'antiraid', source: 'system', action: 'antiraid.start', guildId: MAIN, target: MAIN, details: { trigger: 'automatique' } });
	core.audit.record({ actorId: BOB, source: 'panel', action: 'tickets.transfer', guildId: MAIN, target: '12', details: { number: 12, to: `<@${ALICE}>` } });
	await flush();
	await flush();
	const forAlice = core.notifications.list(alice).items;
	assert.deepEqual(forAlice.map(x => x.type).sort(), ['ticket_assigned', 'ticket_new']);
	assert.equal(forAlice.find(x => x.type === 'ticket_new').url, '/ticket/12');
	assert.match(forAlice.find(x => x.type === 'ticket_new').body, /Carol · Support · Main/);
	assert.deepEqual(core.notifications.list(bob).items.map(x => x.type).sort(), ['absence_request', 'antiraid'], 'one pending absence only');
});

test('sources: a member reply in a claimed ticket tells its handler, once per few minutes', async () => {
	const { core, alice } = await setup();
	let clock = 1_000_000;
	const notifications = createNotifications({ db: core.db, now: () => clock });
	const listeners = new Set();
	const ticket = { id: 5, number: 5, guildId: MAIN, status: 'open', openerId: CAROL, claimedBy: ALICE };
	const tickets = {
		subscribe: (l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		get: () => ticket,
	};
	attachNotificationSources({ notifications, audit: { onRecord: () => () => undefined }, tickets, network: core.network, executor: core.executor, now: () => clock });
	const say = (message) => listeners.forEach(l => l({ type: 'message', guildId: MAIN, message: { ticketId: 5, bot: false, internal: false, panelUser: null, ...message } }));
	say({ authorId: CAROL, authorName: 'Carol', content: 'Bonjour ?' });
	say({ authorId: CAROL, authorName: 'Carol', content: 'Toujours là ?' });
	say({ authorId: ALICE, authorName: 'Alice', content: 'Oui' });
	clock += 6 * 60_000;
	say({ authorId: CAROL, authorName: 'Carol', content: 'Merci' });
	const items = notifications.list(alice).items;
	assert.equal(items.length, 2);
	assert.equal(items[0].url, '/ticket/5');
	assert.match(items[1].body, /Bonjour/);
});
