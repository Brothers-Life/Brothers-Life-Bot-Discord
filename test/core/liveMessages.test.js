import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createLiveMessages } from '../../src/core/liveMessages.js';
import { changelogPayload } from '../../src/core/changelog.js';

const C_MAIN = '610000000000000001';
const C_OTHER = '620000000000000001';

async function setup() {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	core.network.activate(owner, OTHER);
	const live = createLiveMessages({ db: core.db, network: core.network, audit: core.audit, executor, stats: core.stats, logger: { warn: () => undefined }, now: () => clock });
	return { ...ctx, live, advance: (ms) => { clock += ms; } };
}

test('a message synced in two servers, with variables of each server', async () => {
	const { live, owner, executor } = await setup();
	executor.guildCounts.set(OTHER, { members: 50, humans: 45, bots: 5, voice: 1, boosts: 0 });
	const message = await live.create(owner, {
		name: 'Infos',
		payload: { content: '{members} membres · réseau : {network.members} · {var.event}', embed: { enabled: false } },
		variables: { event: 'Soirée casino samedi' },
		targets: [{ guildId: MAIN, channelId: C_MAIN }, { guildId: OTHER, channelId: C_OTHER }],
	});
	const published = await live.publish(owner, message.id);
	assert.deepEqual(published.results.map(r => r.ok), [true, true]);
	const [mainId] = executor.posted.get(C_MAIN).keys();
	assert.equal(executor.posted.get(C_MAIN).get(mainId).content, '120 membres · réseau : 170 · Soirée casino samedi');
	assert.match([...executor.posted.get(C_OTHER).values()][0].content, /^50 membres/);

	// Same content: nothing sent; a variable changed from the panel: edited in place (same message id)
	const calls = executor.calls.length;
	await live.update(owner, message.id, { ...published, payload: published.payload, targets: published.targets });
	assert.equal(executor.calls.length, calls);
	await live.setVariables(owner, message.id, { event: 'Course de rue dimanche' });
	assert.equal(executor.posted.get(C_MAIN).size, 1);
	assert.match(executor.posted.get(C_MAIN).get(mainId).content, /Course de rue dimanche$/);
});

test('dynamic messages refresh on their own; permission and validation', async () => {
	const { core, live, owner, executor, advance } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(live.create(alice, { name: 'x', payload: { content: 'x' } }), ForbiddenError);
	await assert.rejects(live.create(owner, { name: 'x', payload: { content: 'x' }, refreshMinutes: 5000 }), /1440/);
	await assert.rejects(live.create(owner, { name: 'x', payload: { content: 'x' }, variables: { 'Bad Key': 1 } }), /invalide/);
	const message = await live.create(owner, { name: 'Vocal', payload: { content: 'En vocal : {voice}' }, refreshMinutes: 5, targets: [{ guildId: MAIN, channelId: C_MAIN }] });
	await live.publish(owner, message.id);
	executor.guildCounts.set(MAIN, { members: 120, humans: 110, bots: 10, voice: 9, boosts: 3 });
	advance(2 * 60_000);
	await live.tick();
	assert.match([...executor.posted.get(C_MAIN).values()][0].content, /: 4$/, 'not due yet');
	advance(4 * 60_000);
	await live.tick();
	assert.match([...executor.posted.get(C_MAIN).values()][0].content, /: 9$/);
});

test('changelog: grouped items, published, edited everywhere, removed from a channel taken out', async () => {
	const { core, owner, executor } = await setup();
	const entry = core.changelog.create(owner, {
		version: 'v2.3', title: 'Mise à jour d’automne', intro: 'Beaucoup de nouveautés',
		items: [{ type: 'added', text: 'Tickets en direct' }, { type: 'fixed', text: 'Bug des cartes' }, { type: 'added', text: 'Stats' }],
		targets: [{ guildId: MAIN, channelId: C_MAIN }, { guildId: OTHER, channelId: C_OTHER }],
	});
	const payload = changelogPayload(entry);
	assert.equal(payload.embed.title, 'v2.3 · Mise à jour d’automne');
	assert.deepEqual(payload.embed.fields.map(f => f.name), ['✨ Ajouts', '🐛 Corrections']);
	assert.equal(payload.embed.fields[0].value, '• Tickets en direct\n• Stats');

	const published = await core.changelog.publish(owner, entry.id);
	assert.equal(published.messages.length, 2);
	await core.changelog.update(owner, entry.id, { ...published, title: 'Mise à jour d’automne (corrigée)', targets: [{ guildId: MAIN, channelId: C_MAIN }] });
	assert.match([...executor.posted.get(C_MAIN).values()][0].embed.title, /corrigée/);
	assert.equal(executor.deleted.length, 1, 'removed from the other server');
	assert.equal(core.changelog.latest('v2.3').id, entry.id);
});
