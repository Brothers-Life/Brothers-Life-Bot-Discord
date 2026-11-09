import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN } from '../helpers.js';

const BOB = '200000000000000002';
const CHAN = '700000000000000001';
const FUTURE = Date.now() + 3_600_000;

async function setup() {
	const ctx = await withNetwork();
	const { core, owner } = ctx;
	const item = await core.takeovers.save(owner, MAIN, { name: 'Benny’s', category: 'business', mode: 'simple', interviewAt: FUTURE });
	return { ...ctx, t: core.takeovers, item };
}
const join = (t, id, userId) => t.register({ id, guildId: MAIN, userId, userName: `u${userId}` });
const entries = async (t, owner, id) => (await t.overview(owner, MAIN)).takeovers.find(x => x.id === id).entries;

test('a takeover starts closed and only the staff opens it', async () => {
	const { t, owner, item } = await setup();
	assert.equal(item.open, false);
	await assert.rejects(t.start(item.id, ALICE, MAIN), /fermées/);
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
