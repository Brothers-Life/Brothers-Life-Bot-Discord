import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';

const BOB = '200000000000000002';
const CHAN = '700000000000000001';
const FUTURE = Date.now() + 3_600_000;
const STRANGER = { id: 'x', can: () => false };

async function setup() {
	const ctx = await withNetwork();
	const { core, owner } = ctx;
	await core.network.activate(owner, OTHER);
	const item = await core.takeovers.save(owner, MAIN, { name: 'Benny’s', category: 'business', mode: 'simple', interviewAt: FUTURE });
	return { ...ctx, t: core.takeovers, item };
}
const join = (t, id, userId) => t.register({ id, guildId: MAIN, userId, userName: `u${userId}` });
const entries = async (t, owner, id) => (await t.overview(owner, MAIN)).takeovers.find(x => x.id === id).entries;

test('a takeover starts closed and only the staff opens it', async () => {
	const { t, owner, item } = await setup();
	assert.equal(item.open, false);
	await assert.rejects(t.start(item.id, ALICE, MAIN), /déjà prise/);
	await t.setOpen(owner, item.id, true);
	assert.deepEqual((await t.start(item.id, ALICE, MAIN)).step, null);
	await assert.rejects(t.save({ id: 'x', can: () => false }, MAIN, { name: 'A', category: 'business', mode: 'simple' }), /rang/);
});

test('simple registration: once per person, can be withdrawn, an excluded person cannot come back', async () => {
	const { t, owner, item } = await setup();
	await t.setOpen(owner, item.id, true);
	await join(t, item.id, ALICE);
	await assert.rejects(join(t, item.id, ALICE), /déjà inscrit/);
	assert.equal((await t.start(item.id, ALICE, MAIN)).already, true);
	await t.leave(item.id, ALICE);
	await join(t, item.id, ALICE);
	const [entry] = await entries(t, owner, item.id);
	await t.removeEntry(owner, entry.id);
	await assert.rejects(t.start(item.id, ALICE, MAIN), /écartée/);
});

test('form mode: the answers go through every step and are kept', async () => {
	const { t, owner } = await setup();
	const item = await t.save(owner, MAIN, { name: 'Ballas', category: 'illegal', mode: 'form' });
	await t.setOpen(owner, item.id, true);
	const { form, step } = await t.start(item.id, ALICE, MAIN);
	assert.equal(step, 0);
	const values = Object.fromEntries(form.steps[0].questions.map(q => [q.id, 'réponse']));
	const done = await t.submitStep(item.id, ALICE, 0, values);
	assert.equal(done.done, true);
	await t.register({ id: item.id, guildId: MAIN, userId: ALICE, userName: 'alice', answers: done.answers });
	assert.equal((await entries(t, owner, item.id))[0].answers[0].value, 'réponse');
});

test('the date arrives: everyone registered gets one DM and registrations close', async () => {
	const { t, owner, item, executor } = await setup();
	await t.setOpen(owner, item.id, true);
	await join(t, item.id, ALICE);
	await join(t, item.id, BOB);
	const before = executor.dms.length;
	await t.tick(FUTURE - 1000);
	assert.equal(executor.dms.length, before, 'not before the date');
	await t.tick(FUTURE);
	const sent = executor.dms.slice(before);
	assert.deepEqual(sent.map(d => d[0]).sort(), [ALICE, BOB].sort());
	assert.match(sent[0][1], /Benny’s/);
	await t.tick(FUTURE + 60_000);
	assert.equal(executor.dms.length, before + 2, 'only once');
	const after = await t.getTakeover(item.id);
	assert.equal(after.open, false);
	await assert.rejects(t.setOpen(owner, item.id, true), /déjà reçu/);
});

test('a closed DM is reported to the staff and does not stop the others', async () => {
	const { t, owner, item, executor } = await setup();
	await t.setOpen(owner, item.id, true);
	await join(t, item.id, ALICE);
	await join(t, item.id, BOB);
	const send = executor.sendDM;
	executor.sendDM = async function(userId, ...rest) {
		if (userId === ALICE) throw new Error('Cannot send messages to this user');
		return send.call(this, userId, ...rest);
	};
	assert.deepEqual(await t.convoke(owner, item.id), { sent: 1, failed: 1 });
	assert.deepEqual((await entries(t, owner, item.id)).map(e => e.dmStatus), ['failed', 'sent']);
	await assert.rejects(t.convoke(owner, item.id), /déjà reçu/);
});

test('the staff names who takes it: announced with a mention, and it is over', async () => {
	const { core, t, owner, item, executor } = await setup();
	await t.setOpen(owner, item.id, true);
	await join(t, item.id, ALICE);
	await assert.rejects(t.finish(owner, item.id, ALICE), /salon d’annonce/);
	const { config } = await t.overview(owner, MAIN);
	await t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, announceChannelId: CHAN } });
	await assert.rejects(t.finish(owner, item.id, BOB), /pas inscrite/);

	const done = await t.finish(owner, item.id, ALICE);
	assert.equal(done.winnerId, ALICE);
	assert.equal(done.open, false);
	const message = executor.messages.at(-1);
	assert.equal(message.channelId, CHAN);
	assert.match(message.payload.content, new RegExp(`Benny’s.*<@${ALICE}>`));
	assert.deepEqual(message.mentionUserIds, [ALICE]);
	await assert.rejects(t.finish(owner, item.id, ALICE), /terminée/);
	await assert.rejects(t.leave(item.id, ALICE), /terminée/);
	assert.equal((await core.audit.query({ action: 'takeovers.finish' })).length, 1);
});

test('a failed announcement attributes nothing', async () => {
	const { t, owner, item, executor } = await setup();
	await t.setOpen(owner, item.id, true);
	await join(t, item.id, ALICE);
	const { config } = await t.overview(owner, MAIN);
	await t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, announceChannelId: CHAN } });
	executor.failOn.add(CHAN);
	await assert.rejects(t.finish(owner, item.id, ALICE), /annonce n’a pas pu/);
	assert.equal((await t.getTakeover(item.id)).finishedAt, null);
});

test('the Discord panel of a category follows the changes and hides what is over', async () => {
	const { t, owner, item, executor } = await setup();
	await assert.rejects(t.publishPanel(owner, MAIN, 'business'), /salon du panneau/);
	const { config } = await t.overview(owner, MAIN);
	await t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, panelChannelId: CHAN, announceChannelId: CHAN } });
	await t.publishPanel(owner, MAIN, 'business');
	await t.setOpen(owner, item.id, true);
	assert.equal(executor.takeoverPanels.at(-1).view.takeovers[0].open, true);
	await join(t, item.id, ALICE);
	await t.finish(owner, item.id, ALICE);
	assert.deepEqual(executor.takeoverPanels.at(-1).view.takeovers, []);
});

const order = async (t, owner) => {
	const { groups, takeovers } = await t.overview(owner, MAIN);
	return { groups: groups.map(g => g.name), items: takeovers.map(x => [x.name, x.groupId]) };
};

test('categories belong to one type and removing one keeps its takeovers', async () => {
	const { t, owner, item } = await setup();
	const garages = await t.saveGroup(owner, MAIN, { category: 'business', name: 'Garages', emoji: '🔧' });
	const gangs = await t.saveGroup(owner, MAIN, { category: 'illegal', name: 'Gangs' });
	await assert.rejects(t.saveGroup(STRANGER, MAIN, { category: 'business', name: 'A' }), /rang/);
	await assert.rejects(t.saveGroup(owner, MAIN, { category: 'business', name: 'A', emoji: 'pas un émoji' }), /émoji/);
	await assert.rejects(t.save(owner, MAIN, { id: item.id, name: 'Benny’s', category: 'business', mode: 'simple', groupId: gangs.id }), /ne correspond pas/);

	const placed = await t.save(owner, MAIN, { id: item.id, name: 'Benny’s', category: 'business', mode: 'simple', groupId: garages.id, interviewAt: FUTURE });
	assert.equal(placed.groupId, garages.id);
	const untouched = await t.save(owner, MAIN, { id: item.id, name: 'Benny’s 2', category: 'business', mode: 'simple', interviewAt: FUTURE });
	assert.equal(untouched.groupId, garages.id, 'an edit that does not mention the category keeps it');

	await t.removeGroup(owner, garages.id, MAIN);
	assert.equal((await t.getTakeover(item.id)).groupId, null);
	assert.deepEqual((await order(t, owner)).groups, ['Gangs']);
});

test('the staff orders categories and takeovers freely, and the panel follows', async () => {
	const { t, owner, item, executor } = await setup();
	const { config } = await t.overview(owner, MAIN);
	await t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, panelChannelId: CHAN } });
	await t.publishPanel(owner, MAIN, 'business');
	const a = await t.saveGroup(owner, MAIN, { category: 'business', name: 'A' });
	const b = await t.saveGroup(owner, MAIN, { category: 'business', name: 'B' });
	const second = await t.save(owner, MAIN, { name: 'LS Customs', category: 'business', mode: 'simple' });
	const third = await t.save(owner, MAIN, { name: 'Bahama', category: 'business', mode: 'simple' });
	assert.deepEqual((await order(t, owner)).items.map(x => x[0]), ['Benny’s', 'LS Customs', 'Bahama'], 'new ones go last');

	await t.reorder(owner, MAIN, 'business', [{ id: b.id, items: [third.id, item.id] }, { id: a.id, items: [] }, { id: null, items: [second.id] }]);
	assert.deepEqual(await order(t, owner), { groups: ['B', 'A'], items: [['Bahama', b.id], ['Benny’s', b.id], ['LS Customs', null]] });
	const { view } = executor.takeoverPanels.at(-1);
	assert.deepEqual(view.groups.map(g => g.name), ['B', 'A']);
	assert.deepEqual(view.takeovers.map(x => x.name), ['Bahama', 'Benny’s', 'LS Customs']);

	const moved = await t.save(owner, MAIN, { id: third.id, name: 'Bahama', category: 'business', mode: 'simple', groupId: a.id });
	assert.ok(moved.position > (await t.getTakeover(second.id)).position, 'moved to another category: at its end');

	await assert.rejects(t.reorder(STRANGER, MAIN, 'business', []), /rang/);
	await assert.rejects(t.reorder(owner, MAIN, 'business', [{ id: 999999, items: [] }]), /recharge/);
	const gang = await t.saveGroup(owner, MAIN, { category: 'illegal', name: 'Gangs' });
	await assert.rejects(t.reorder(owner, MAIN, 'business', [{ id: gang.id, items: [] }]), /recharge/, 'a category of the other type');
	await t.reorder(owner, MAIN, 'illegal', [{ id: null, items: [item.id] }]);
	assert.equal((await t.getTakeover(item.id)).groupId, b.id, 'a takeover of the other type is left alone');
});

test('the counters of the panel catch up on the next tick, in one edit', async () => {
	const { t, owner, item, executor } = await setup();
	const { config } = await t.overview(owner, MAIN);
	await t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, panelChannelId: CHAN } });
	await t.publishPanel(owner, MAIN, 'business');
	await t.setOpen(owner, item.id, true);
	const edits = executor.takeoverPanels.length;
	await join(t, item.id, ALICE);
	await join(t, item.id, BOB);
	assert.equal(executor.takeoverPanels.length, edits, 'no edit while people click');
	await t.tick(Date.now());
	assert.equal(executor.takeoverPanels.length, edits + 1);
	assert.equal(executor.takeoverPanels.at(-1).view.takeovers[0].registered, 2);
	await t.tick(Date.now());
	assert.equal(executor.takeoverPanels.length, edits + 1, 'nothing new, no edit');
});

test('the look of the panel is saved and a bad image address is refused', async () => {
	const { t, owner } = await setup();
	const { config } = await t.overview(owner, MAIN);
	assert.match(config.business.panelTitle, /entreprises/);
	const look = { panelTitle: 'Reprends ta boîte', panelDescription: '', color: '#123456', imageUrl: 'https://exemple.fr/banniere.png' };
	const saved = await t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, ...look } });
	assert.deepEqual([saved.business.panelTitle, saved.business.panelDescription, saved.business.color, saved.business.imageUrl], ['Reprends ta boîte', '', '#123456', look.imageUrl]);
	await assert.rejects(t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, thumbnailUrl: 'javascript:alert(1)' } }), /adresse de l’image/);
});

test('the button of a category lists only what can be joined in it', async () => {
	const { t, owner, item } = await setup();
	const garages = await t.saveGroup(owner, MAIN, { category: 'business', name: 'Garages' });
	await t.save(owner, MAIN, { id: item.id, name: 'Benny’s', category: 'business', mode: 'simple', groupId: garages.id, interviewAt: FUTURE });
	const loose = await t.save(owner, MAIN, { name: 'Bahama', category: 'business', mode: 'simple' });
	await assert.rejects(t.openIn(MAIN, MAIN, 'business', garages.id), /Plus rien/);
	await t.setOpen(owner, item.id, true);
	await t.setOpen(owner, loose.id, true);
	assert.deepEqual((await t.openIn(MAIN, MAIN, 'business', garages.id)).takeovers.map(x => x.id), [item.id]);
	const others = await t.openIn(MAIN, MAIN, 'business', 0);
	assert.deepEqual([others.name, others.takeovers.map(x => x.id)], ['Autres', [loose.id]]);
	await assert.rejects(t.openIn(MAIN, MAIN, 'illegal', garages.id), /n’existe plus/);
});

test('a linked server shows the same panel and its people land in the same list', async () => {
	const { t, owner, item, executor } = await setup();
	const LINKED = '700000000000000002';
	executor.channels.set(LINKED, { guildId: OTHER, name: 'reprises' });
	const { config } = await t.overview(owner, MAIN);
	const withLinks = links => t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, panelChannelId: CHAN, announceChannelId: CHAN, links } });
	await assert.rejects(withLinks([{ guildId: OTHER, panelChannelId: CHAN }]), /n’appartient pas/);
	await assert.rejects(withLinks([{ guildId: MAIN, panelChannelId: CHAN }]), /porte déjà/);
	await assert.rejects(withLinks([{ guildId: OTHER }]), /au moins un salon/);

	await t.setOpen(owner, item.id, true);
	await assert.rejects(t.start(item.id, ALICE, OTHER), /introuvable/, 'not linked yet');
	await assert.rejects(t.openIn(MAIN, OTHER, 'business', 0), /introuvable/);

	await withLinks([{ guildId: OTHER, panelChannelId: LINKED, announceChannelId: LINKED }]);
	await t.publishPanel(owner, MAIN, 'business');
	assert.deepEqual(executor.takeoverPanels.slice(-2).map(p => p.channelId), [CHAN, LINKED]);
	assert.equal(executor.takeoverPanels.at(-1).view.home, MAIN);

	assert.deepEqual((await t.openIn(MAIN, OTHER, 'business', 0)).takeovers.map(x => x.id), [item.id]);
	await t.start(item.id, ALICE, OTHER);
	await t.register({ id: item.id, guildId: OTHER, userId: ALICE, userName: 'alice' });
	assert.equal((await entries(t, owner, item.id)).length, 1);
	await t.tick(Date.now());
	assert.equal(executor.takeoverPanels.at(-1).view.takeovers[0].registered, 1, 'the linked panel is counted too');
	assert.equal(executor.takeoverPanels.at(-1).channelId, LINKED);

	await t.finish(owner, item.id, ALICE);
	assert.deepEqual(executor.messages.slice(-2).map(m => m.channelId), [CHAN, LINKED]);

	const deleted = [];
	executor.deleteMessage = async (channelId, messageId) => deleted.push([channelId, messageId]);
	const { config: current } = await t.overview(owner, MAIN);
	await t.saveConfig(owner, MAIN, { ...current, business: { ...current.business, links: [] } });
	assert.deepEqual(deleted, [[LINKED, current.business.links[0].panelMessageId]], 'no dead panel left behind');
});

test('a linked server that fails does not stop the main announcement', async () => {
	const { t, owner, item, executor } = await setup();
	const LINKED = '700000000000000003';
	executor.channels.set(LINKED, { guildId: OTHER, name: 'reprises' });
	const { config } = await t.overview(owner, MAIN);
	await t.saveConfig(owner, MAIN, { ...config, business: { ...config.business, announceChannelId: CHAN, links: [{ guildId: OTHER, announceChannelId: LINKED }] } });
	await t.setOpen(owner, item.id, true);
	await join(t, item.id, ALICE);
	executor.failOn.add(LINKED);
	assert.equal((await t.finish(owner, item.id, ALICE)).winnerId, ALICE);
});
