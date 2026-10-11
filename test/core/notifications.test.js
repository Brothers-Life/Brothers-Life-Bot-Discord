import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { createNotifications } from '../../src/core/notifications.js';
import { attachNotificationSources } from '../../src/core/notificationSources.js';

const CAROL = '100000000000000004';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The sources notify asynchronously (database reads): waits until `count` notifications were pushed, then a little more
// so that a notification that should not exist would have had time to arrive
async function settle(notifications, count) {
	for (let i = 0; i < 100 && pushCount(notifications) < count; i++) await sleep(20);
	await sleep(50);
}
const pushedCount = new WeakMap();
function pushCount(notifications) {
	return pushedCount.get(notifications) ?? 0;
}
function countPushes(notifications) {
	notifications.subscribe(() => pushedCount.set(notifications, pushCount(notifications) + 1));
}

async function withRank(core, owner, userId, name, permissions) {
	const rank = await core.ranks.create(owner, { name, level: 10, permissions: ['panel.access', ...permissions] });
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
	await n.push({ permission: 'tickets.view', title: 'Ticket', url: '/tickets', guildId: MAIN });
	await n.push({ permission: 'antiraid.view', title: 'Raid', actorId: BOB });
	await n.push({ type: 'ticket_assigned', userId: ALICE, title: 'Pour Alice', url: '/ticket/1' });

	assert.deepEqual((await n.list(alice)).items.map(x => x.title), ['Pour Alice', 'Ticket']);
	assert.deepEqual((await n.list(bob)).items.map(x => x.title), [], 'his own raid action is not notified, no tickets.view');
	assert.deepEqual((await n.list(owner)).items.map(x => x.title), ['Raid', 'Ticket'], 'the owner holds everything but is not Alice');
	const carol = await core.ranks.resolve(CAROL);
	assert.equal((await n.list(carol)).items.length, 0, 'no panel access: nothing');
});

test('unread count, mark read one by one or all', async () => {
	const { core, alice } = await setup();
	const n = core.notifications;
	const a = await n.push({ permission: 'tickets.view', title: 'A' });
	await n.push({ permission: 'tickets.view', title: 'B' });
	assert.equal(await n.unreadCount(alice), 2);
	assert.equal((await n.markRead(alice, [a.id])).unread, 1);
	assert.equal((await n.list(alice)).items.find(x => x.id === a.id).read, true);
	assert.equal((await n.markAllRead(alice)).unread, 0);
	await n.push({ permission: 'tickets.view', title: 'C' });
	assert.equal(await n.unreadCount(alice), 1, 'new ones after "all read" are unread');
});

test('preferences mute a type; only known types are kept; links stay inside the panel', async () => {
	const { core, alice } = await setup();
	const n = core.notifications;
	assert.ok((await n.prefs(alice)).types.some(t => t.key === 'ticket_new'));
	assert.ok(!(await n.prefs(alice)).types.some(t => t.key === 'antiraid'), 'types she could never get are hidden');
	assert.deepEqual((await n.setPrefs(alice, { disabled: ['ticket_new', 'nope'] })).disabled, ['ticket_new']);
	await n.push({ type: 'ticket_new', title: 'Muet' });
	await n.push({ permission: 'tickets.view', title: 'Autre', url: 'https://evil.example' });
	const items = (await n.list(alice)).items;
	assert.deepEqual(items.map(x => x.title), ['Autre']);
	assert.equal(items[0].url, null);
	await assert.rejects(async () => n.push({ type: 'unknown', title: 'x' }), /Unknown notification type/);
	n.registerType('tebex_sale', { label: 'Ventes Tebex', permission: 'tickets.view' });
	await n.push({ type: 'tebex_sale', title: 'Vente' });
	assert.equal((await n.list(alice)).items[0].title, 'Vente', 'the type permission applies by default');
});

test('live listeners get every push; visibleTo filters per user', async () => {
	const { core, alice, bob } = await setup();
	const seen = [];
	const stop = core.notifications.subscribe(x => seen.push(x));
	const pushed = await core.notifications.push({ permission: 'tickets.view', title: 'Live' });
	stop();
	await core.notifications.push({ permission: 'tickets.view', title: 'After' });
	assert.deepEqual(seen.map(x => x.title), ['Live']);
	assert.equal(await core.notifications.visibleTo(alice, pushed), true);
	assert.equal(await core.notifications.visibleTo(bob, pushed), false);
});

test('sources: audited actions become notifications (pending absence, raid, ticket opened, transfer)', async () => {
	const { core, alice, bob } = await setup();
	countPushes(core.notifications);
	await core.audit.record({ actorId: CAROL, source: 'bot', action: 'tickets.open', guildId: MAIN, target: '12', details: { number: 12, opener: 'Carol', category: 'Support' } });
	await core.audit.record({ actorId: CAROL, source: 'panel', action: 'absences.declare', target: CAROL, details: { member: `<@${CAROL}>`, until: '2026-10-20T00:00:00.000Z', pending: true } });
	await core.audit.record({ actorId: CAROL, source: 'panel', action: 'absences.declare', target: CAROL, details: { member: `<@${CAROL}>`, pending: false } });
	await core.audit.record({ actorId: 'antiraid', source: 'system', action: 'antiraid.start', guildId: MAIN, target: MAIN, details: { trigger: 'automatique' } });
	await core.audit.record({ actorId: BOB, source: 'panel', action: 'tickets.transfer', guildId: MAIN, target: '12', details: { number: 12, to: `<@${ALICE}>` } });
	await settle(core.notifications, 4);
	const forAlice = (await core.notifications.list(alice)).items;
	assert.deepEqual(forAlice.map(x => x.type).sort(), ['ticket_assigned', 'ticket_new']);
	assert.equal(forAlice.find(x => x.type === 'ticket_new').url, '/ticket/12');
	assert.match(forAlice.find(x => x.type === 'ticket_new').body, /Carol · Support · Main/);
	assert.deepEqual((await core.notifications.list(bob)).items.map(x => x.type).sort(), ['absence_request', 'antiraid'], 'one pending absence only');
});

test('sources: a ticket past its first response delay (SLA) is notified', async () => {
	const { core, alice } = await setup();
	countPushes(core.notifications);
	await core.audit.record({ actorId: 'system', source: 'system', action: 'tickets.sla_breach', guildId: MAIN, target: '7', details: { number: 7, opener: 'Carol', Type: 'Support' } });
	await settle(core.notifications, 1);
	const sla = (await core.notifications.list(alice)).items.find(x => x.type === 'ticket_sla');
	assert.equal(sla.url, '/ticket/7');
	assert.match(sla.title, /#7/);
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
	countPushes(notifications);
	attachNotificationSources({ notifications, audit: { onRecord: () => () => undefined }, tickets, network: core.network, executor: core.executor, now: () => clock });
	const say = (message) => listeners.forEach(l => l({ type: 'message', guildId: MAIN, message: { ticketId: 5, bot: false, internal: false, panelUser: null, ...message } }));
	say({ authorId: CAROL, authorName: 'Carol', content: 'Bonjour ?' });
	say({ authorId: CAROL, authorName: 'Carol', content: 'Toujours là ?' });
	say({ authorId: ALICE, authorName: 'Alice', content: 'Oui' });
	await settle(notifications, 1);
	clock += 6 * 60_000;
	say({ authorId: CAROL, authorName: 'Carol', content: 'Merci' });
	await settle(notifications, 2);
	const items = (await notifications.list(alice)).items;
	assert.equal(items.length, 2);
	assert.equal(items[0].url, '/ticket/5');
	assert.match(items[1].body, /Bonjour/);
});
