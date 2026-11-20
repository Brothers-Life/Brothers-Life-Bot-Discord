import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { createServerLinks, parseInvite } from '../../src/core/serverLinks.js';

const C_MAIN = '610000000000000001';
const C_MAIN_2 = '610000000000000002';
const C_OTHER = '620000000000000001';
const HOUR = 3600_000;

async function setup() {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	await core.network.activate(owner, OTHER);
	const links = createServerLinks({ db: core.db, network: core.network, audit: core.audit, executor, logs: core.logs, logger: { warn: () => undefined }, now: () => clock });
	return { ...ctx, links, advance: (ms) => { clock += ms; } };
}

const only = (executor, channelId) => [...(executor.posted.get(channelId)?.values() ?? [])];
const board = (patch = {}) => ({ name: 'Nos serveurs', guildId: MAIN, channelId: C_MAIN, ...patch });

test('invite links are read from a URL or a bare code', () => {
	assert.equal(parseInvite('https://discord.gg/brothers'), 'brothers');
	assert.equal(parseInvite('discord.com/invite/Ab-12/'), 'Ab-12');
	assert.equal(parseInvite('  brothers '), 'brothers');
	assert.equal(parseInvite('https://example.com/brothers'), null);
	assert.equal(parseInvite(''), null);
});

test('a board lists the other listed servers, with a button each', async () => {
	const { links, owner, executor } = await setup();
	// Nothing is listed until someone says so: a staff server never leaks by default
	const created = await links.create(owner, board());
	assert.equal(created.result.ok, true);
	assert.match(only(executor, C_MAIN)[0].embed.description, /Aucun autre serveur/);
	assert.deepEqual(only(executor, C_MAIN)[0].buttons, []);
	assert.equal(executor.createdInvites.length, 0);

	const saved = await links.saveServer(owner, OTHER, { listed: true, label: 'Brothers Life Staff', description: 'Le serveur de l’équipe', emoji: '🛡️' });
	assert.equal(saved.server.inviteUrl, 'https://discord.gg/auto1');
	await links.saveServer(owner, MAIN, { listed: true });

	const messages = only(executor, C_MAIN);
	assert.equal(messages.length, 1, 'edited in place');
	assert.equal(messages[0].embed.description, '🛡️ **[Brothers Life Staff](https://discord.gg/auto1)**\nLe serveur de l’équipe');
	assert.deepEqual(messages[0].buttons, [{ label: 'Brothers Life Staff', url: 'https://discord.gg/auto1', emoji: '🛡️' }]);

	// Same content: nothing is sent to Discord
	const calls = executor.calls.length;
	await links.tick();
	assert.equal(executor.calls.length, calls);
});

test('own server, chosen servers, line template and server without description', async () => {
	const { links, owner, executor } = await setup();
	await links.saveServer(owner, MAIN, { listed: true });
	await links.saveServer(owner, OTHER, { listed: true });
	executor.guildCounts.set(OTHER, { members: 1500, humans: 1400, bots: 100, voice: 1, boosts: 0 });
	await links.create(owner, board({
		channelId: C_OTHER,
		guildId: OTHER,
		includeSelf: true,
		buttons: false,
		compact: true,
		line: '{emoji} {name} ({members}) : {invite}\n{description}',
		payload: { content: '{count} serveurs :\n{links}', embed: { enabled: false } },
	}));
	const [message] = only(executor, C_OTHER);
	const lines = message.content.split('\n');
	assert.equal(lines[0], '2 serveurs :');
	assert.equal(lines.length, 3, 'no empty line for a missing description');
	assert.ok(lines.some(l => /\(1\s?500\) : https:\/\/discord\.gg\/auto2$/.test(l)));
	assert.deepEqual(message.buttons, [], 'buttons turned off are removed from the message');

	const chosen = await links.create(owner, board({ scope: 'selected', guildIds: [MAIN] }));
	assert.equal(chosen.result.ok, true);
	assert.match(only(executor, C_MAIN)[0].embed.description, /Aucun autre serveur/, 'the board’s own server is hidden unless asked');
	await assert.rejects(links.create(owner, board({ scope: 'selected', guildIds: [] })), /au moins un serveur/);
	await assert.rejects(links.create(owner, board({ buttons: false, payload: { content: 'Rien', embed: { enabled: false } } })), /\{links\}/);
});

test('manual links must lead to the server; permissions', async () => {
	const { core, links, owner, executor } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(links.saveServer(alice, OTHER, { listed: true }), ForbiddenError);
	await assert.rejects(links.create(alice, board()), ForbiddenError);

	executor.invites.set('brothers', OTHER);
	executor.invites.set('ailleurs', '999999999999999999');
	await assert.rejects(links.saveServer(owner, OTHER, { listed: true, inviteMode: 'manual', inviteUrl: 'pas un lien !' }), /invalide/);
	await assert.rejects(links.saveServer(owner, OTHER, { listed: true, inviteMode: 'manual', inviteUrl: 'https://discord.gg/ailleurs' }), /ne mène pas/);
	const saved = await links.saveServer(owner, OTHER, { listed: true, inviteMode: 'manual', inviteUrl: 'https://discord.gg/brothers' });
	assert.equal(saved.server.inviteUrl, 'https://discord.gg/brothers');
	assert.equal(executor.createdInvites.length, 0);
	await assert.rejects(links.renewInvite(owner, OTHER), /saisi à la main/);

	executor.inviteFailures.set(MAIN, 'le bot n’a pas la permission');
	await assert.rejects(links.saveServer(owner, MAIN, { listed: true }), /Impossible de créer l’invitation/);
});

test('dead invitations are replaced, servers leaving the network disappear', async () => {
	const { core, links, owner, executor, advance } = await setup();
	await links.saveServer(owner, OTHER, { listed: true });
	await links.create(owner, board());
	assert.match(only(executor, C_MAIN)[0].embed.description, /auto1/);

	// The invitation was deleted on Discord: a new one replaces it at the next hourly check
	executor.invites.delete('auto1');
	advance(10 * 60_000);
	await links.tick();
	assert.match(only(executor, C_MAIN)[0].embed.description, /auto1/, 'checked once an hour');
	advance(HOUR);
	await links.tick();
	assert.match(only(executor, C_MAIN)[0].embed.description, /auto2/);

	const renewed = await links.renewInvite(owner, OTHER);
	assert.equal(renewed.server.inviteCode, 'auto3');
	assert.match(only(executor, C_MAIN)[0].embed.description, /auto3/);

	await core.network.remove(owner, OTHER);
	await links.tick();
	assert.match(only(executor, C_MAIN)[0].embed.description, /Aucun autre serveur/);
	assert.equal(only(executor, C_MAIN).length, 1);
});

test('moving, disabling and deleting a board; failures are kept', async () => {
	const { links, owner, executor } = await setup();
	await links.saveServer(owner, OTHER, { listed: true });
	const created = await links.create(owner, board());
	const firstId = created.messageId;
	assert.ok(firstId);

	const moved = await links.update(owner, created.id, board({ channelId: C_MAIN_2 }));
	assert.deepEqual(executor.deleted.at(-1), [C_MAIN, firstId]);
	assert.equal(only(executor, C_MAIN_2).length, 1);
	assert.notEqual(moved.messageId, null);

	const off = await links.update(owner, created.id, board({ channelId: C_MAIN_2, enabled: false }));
	assert.equal(off.messageId, null);
	assert.deepEqual(executor.deleted.at(-1), [C_MAIN_2, moved.messageId]);
	await assert.rejects(links.publish(owner, created.id), /désactivé/);

	executor.failOn.add(C_MAIN);
	const failing = await links.update(owner, created.id, board({ enabled: true }));
	assert.equal(failing.result.ok, false);
	assert.equal(failing.error, 'Missing Access');
	executor.failOn.delete(C_MAIN);
	const fixed = await links.publish(owner, created.id);
	assert.equal(fixed.error, null);

	await links.remove(owner, created.id);
	assert.deepEqual(executor.deleted.at(-1), [C_MAIN, fixed.messageId]);
	assert.deepEqual(await links.boards(), []);
});

test('display order and preview', async () => {
	const { links, owner, executor } = await setup();
	await links.saveServer(owner, MAIN, { listed: true, label: 'Principal' });
	await links.saveServer(owner, OTHER, { listed: true, label: 'Second' });
	const ordered = await links.reorder(owner, [OTHER, MAIN]);
	assert.deepEqual(ordered.map(s => s.guildId), [OTHER, MAIN]);

	const posted = executor.calls.length;
	const preview = await links.preview(owner, board({ includeSelf: true }));
	assert.deepEqual(preview.buttons.map(b => b.label), ['Second', 'Principal']);
	assert.match(preview.payload.embed.description, /^\*\*\[Second\]/);
	assert.equal(executor.calls.length, posted, 'nothing is sent');
});

test('categories sort the servers, in the list and in the buttons', async () => {
	const { core, links, owner, executor } = await setup();
	await assert.rejects(links.createCategory(await core.ranks.resolve(ALICE), { name: 'x' }), ForbiddenError);
	const illegal = await links.createCategory(owner, { name: 'Illégal', emoji: '🔫', color: '#AA0000' });
	const legal = await links.createCategory(owner, { name: 'Légal' });
	assert.equal(illegal.color, '#aa0000');
	await assert.rejects(links.createCategory(owner, { name: 'légal' }), /déjà ce nom/);
	await assert.rejects(links.createCategory(owner, { name: 'Autre', color: 'rouge' }), /Couleur/);
	await assert.rejects(links.saveServer(owner, MAIN, { listed: true, categoryId: 9999 }), /n’existe plus/);

	await links.saveServer(owner, MAIN, { listed: true, label: 'Mairie', categoryId: legal.id });
	await links.saveServer(owner, OTHER, { listed: true, label: 'Gang', categoryId: illegal.id });
	const created = await links.create(owner, board({ includeSelf: true, compact: true }));
	const read = () => only(executor, C_MAIN)[0];
	assert.equal(read().embed.description, '__**🔫 Illégal**__\n**[Gang](https://discord.gg/auto2)**\n\n__**Légal**__\n**[Mairie](https://discord.gg/auto1)**');
	assert.deepEqual(read().buttons.map(b => b.label), ['Gang', 'Mairie']);

	// Order of the categories, then a board limited to one category
	assert.deepEqual((await links.reorderCategories(owner, [legal.id, illegal.id])).map(c => c.name), ['Légal', 'Illégal']);
	assert.match(read().embed.description, /^__\*\*Légal\*\*__/);
	await links.update(owner, created.id, board({ includeSelf: true, categoryIds: [illegal.id], groupByCategory: false }));
	assert.equal(read().embed.description, '**[Gang](https://discord.gg/auto2)**');

	// A deleted category leaves its servers listed, without title when none has a category
	await links.update(owner, created.id, board({ includeSelf: true, compact: true }));
	await links.removeCategory(owner, illegal.id);
	assert.equal(read().embed.description, '__**Légal**__\n**[Mairie](https://discord.gg/auto1)**\n\n__**Autres serveurs**__\n**[Gang](https://discord.gg/auto2)**');
	await links.removeCategory(owner, legal.id);
	assert.doesNotMatch(read().embed.description, /Autres serveurs|Légal/);
	assert.equal((await links.servers()).every(s => s.categoryId === null), true);
});

test('cards: one embed with the logo per server, continued in more messages', async () => {
	const { core, links, owner, executor } = await setup();
	const gangs = await links.createCategory(owner, { name: 'Gangs', color: '#aa0000' });
	await core.db.prepare('UPDATE guilds SET icon = ? WHERE id = ?').run('https://cdn.discordapp.com/icons/1/a.png?size=64', OTHER);
	await links.saveServer(owner, OTHER, { listed: true, label: 'Gang', description: 'Les rues', categoryId: gangs.id });
	const created = await links.create(owner, board({ layout: 'cards', payload: { content: '', embed: { enabled: true, title: 'Nos serveurs', description: '{count} serveur' } } }));
	const [message] = only(executor, C_MAIN);
	assert.equal(message.embed.description, '1 serveur');
	assert.deepEqual(message.cards.map(c => c.title ?? c.description), ['__**Gangs**__', 'Gang']);
	const card = message.cards[1];
	assert.equal(card.url, 'https://discord.gg/auto1');
	assert.equal(card.thumbnailUrl, 'https://cdn.discordapp.com/icons/1/a.png?size=256');
	assert.equal(card.color, '#aa0000');
	assert.equal(card.description, 'Les rues');
	assert.deepEqual(created.messageIds.length, 1);
});
