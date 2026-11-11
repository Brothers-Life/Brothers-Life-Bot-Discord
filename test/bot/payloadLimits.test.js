import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomePayload } from '../../src/bot/ticketsUi.js';
import { applicationPayload } from '../../src/bot/recruitmentUi.js';
import { appealPayload } from '../../src/bot/appealsUi.js';
import { takeoverPanelPayload, takeoverPickerPayload } from '../../src/bot/takeoversUi.js';
import { fivemPayload } from '../../src/bot/fivemUi.js';

// Discord refuses a whole message whose embed is over 6000 characters: long form answers must be cut
const embedLength = (embed) => {
	const e = embed.toJSON();
	return [e.title, e.description, e.author?.name, e.footer?.text, ...(e.fields ?? []).flatMap(f => [f.name, f.value])].join('').length;
};
const long = n => 'x'.repeat(n);

test('ticket welcome: the form answers fit in one embed', () => {
	const payload = welcomePayload({
		ticket: { id: 1, openerId: '300000000000000001' }, title: long(256), message: long(4000), color: '#d6a249',
		answers: Array.from({ length: 10 }, (_, i) => ({ label: `Question ${i}`, value: long(4000) })),
		pingRoleIds: [], statuses: [{ key: 'open', label: 'Ouvert' }], priorities: [{ key: 'normal', label: 'Normale' }],
	});
	assert.ok(embedLength(payload.embeds[0]) <= 6000);
	assert.ok(payload.embeds[0].toJSON().fields.length >= 1, 'the answers are cut, not dropped');
});

test('application and appeal: long answers fit in one embed', () => {
	const application = applicationPayload({
		position: { name: 'Modérateur' },
		application: { id: 1, userId: '300000000000000001', userName: 'bob', status: 'received', createdAt: Date.now(), score: { for: 0, neutral: 0, against: 0 }, answers: Array.from({ length: 12 }, (_, i) => ({ label: `Question ${i}`, value: long(1500) })) },
		status: { color: '#5b9cf6', emoji: '📥', label: 'Reçue' },
	});
	assert.ok(embedLength(application.embeds[0]) <= 6000);
	assert.match(application.embeds[0].toJSON().fields.at(-1).name, /Votes/, 'status and votes always shown');

	const appeal = appealPayload({
		id: 1, userId: '300000000000000001', status: 'rejected', decidedBy: '100000000000000001', decisionReason: long(500), createdAt: Date.now(),
		sanction: { id: 2, type: 'ban', userName: 'bob', moderatorId: '100000000000000001', createdAt: Date.now(), reason: long(1000) },
		answers: Array.from({ length: 5 }, (_, i) => ({ question: `Question ${i}`, answer: long(1000) })),
	});
	assert.ok(embedLength(appeal.embeds[0]) <= 6000);
	assert.match(appeal.embeds[0].toJSON().fields.at(-1).name, /Statut/);
});

test('takeover panel: categories in order, one button each', () => {
	const base = { mode: 'simple', description: 'Texte', interviewAt: null, convokedAt: null, registered: 2 };
	const payload = takeoverPanelPayload({
		title: 'Reprises', description: 'Intro', category: 'business', home: '900000000000000001',
		groups: [{ id: 2, name: 'Garages', emoji: '🔧' }, { id: 1, name: 'Vide', emoji: null }, { id: 3, name: 'Fermé', emoji: null }],
		takeovers: [
			{ ...base, id: 10, name: 'Sans', groupId: null, open: true },
			{ ...base, id: 11, name: 'Fermée', groupId: 2, open: false },
			{ ...base, id: 12, name: 'Benny', groupId: 2, open: true, mode: 'form' },
			{ ...base, id: 13, name: 'Rien', groupId: 3, open: false },
		],
	});
	const [header, ...cards] = payload.embeds.map(e => e.toJSON());
	assert.deepEqual(header.fields.map(f => f.value), ['**4**', '**2**', '**8**']);
	assert.deepEqual(cards.map(c => c.title), ['🔧 Garages · 2', 'Fermé · 1', 'Autres · 1'], 'one card per category, empty ones left out');
	assert.ok(cards[0].description.indexOf('Fermée') < cards[0].description.indexOf('Benny'));
	assert.match(cards[0].description, /\*\*Benny\*\* `🟢 DISPONIBLE` `📋 DOSSIER` `👥 2`/);
	assert.match(cards[0].description, /\*\*Fermée\*\* `🔴 DÉJÀ PRIS`/);
	assert.ok(cards.at(-1).footer && !header.footer, 'the footer closes the last card');
	const buttons = payload.components[0].components.map(b => b.toJSON());
	assert.deepEqual(buttons.map(b => b.custom_id), ['to:list:2:business:900000000000000001', 'to:list:3:business:900000000000000001', 'to:list:0:business:900000000000000001']);
	assert.deepEqual(buttons.map(b => b.label), ['Garages', 'Fermé', 'Autres']);
	assert.deepEqual(buttons.map(b => Boolean(b.disabled)), [false, true, false], 'nothing open in it: greyed out');
});

test('takeover panel: many long takeovers fit in one message and what is cut is announced', () => {
	const takeovers = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: long(60), description: long(1000), mode: 'form', open: true, groupId: (i % 22) + 1, interviewAt: Date.now() + 1000, convokedAt: null, registered: 1 }));
	const groups = Array.from({ length: 22 }, (_, i) => ({ id: i + 1, name: long(40), emoji: '<:abcdefghijklmnopqrstuvwxyz:123456789012345678>' }));
	const payload = takeoverPanelPayload({ title: long(100), description: long(1000), groups, takeovers, guild: { name: long(100), icon: 'https://cdn.discordapp.com/icons/1/a.png' } });
	assert.ok(payload.embeds.length <= 10);
	assert.ok(payload.embeds.reduce((sum, e) => sum + embedLength(e), 0) <= 6000, 'the limit is on the whole message');
	assert.ok(payload.embeds.every(e => (e.toJSON().description?.length ?? 0) <= 4096));
	assert.match(payload.embeds.at(-1).toJSON().footer.text, /autres reprises/);
	assert.match(payload.embeds[0].toJSON().fields.at(-1).name, /Prochains entretiens/);
	assert.equal(payload.components.flatMap(row => row.components).length, 22, 'one button per category');
});

test('takeover panel: nothing available still gives a valid message', () => {
	const payload = takeoverPanelPayload({ title: 'Reprises', description: '', groups: [], takeovers: [] });
	assert.match(payload.embeds[0].toJSON().description, /Aucune reprise/);
	assert.deepEqual(payload.components, []);
});

test('takeover panel: without categories a single button opens the list', () => {
	const payload = takeoverPanelPayload({ title: 'Reprises', category: 'illegal', home: '900000000000000001', groups: [], takeovers: [{ id: 1, name: 'A', mode: 'simple', open: true, groupId: null }] });
	const [button] = payload.components[0].components.map(b => b.toJSON());
	assert.equal(button.label, 'Voir les reprises disponibles');
	assert.equal(button.custom_id, 'to:list:0:illegal:900000000000000001');
});

test('takeover picker: long lists are split and every text fits', () => {
	const takeovers = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: long(60), description: long(1000), mode: i % 2 ? 'form' : 'simple', open: true }));
	const { components } = takeoverPickerPayload({ name: 'Garages', takeovers });
	assert.equal(components.length, 2);
	const options = components.flatMap(row => row.components[0].toJSON().options);
	assert.equal(options.length, 30);
	assert.ok(options.every(o => o.label.length <= 100 && o.description.length <= 100));
	assert.equal(options[0].value, '1');
});

const fivemServer = { name: 'BRL', joinCode: null, config: { color: '#ff9628', showPlayers: true } };
const fivemStatus = list => ({ online: true, players: list.length, max: 64, list, checkedAt: Date.now(), onlineSince: Date.now() - 60_000 });
const players = (count, name) => Array.from({ length: count }, (_, i) => ({ id: i + 1, name, ping: 40 }));

test('FiveM status: the connected players are side by side and the whole message fits', () => {
	for (const count of [6, 64, 400, 2000]) {
		const embed = fivemPayload({ server: fivemServer, status: fivemStatus(players(count, 'x'.repeat(64))) }).embeds[0];
		const { fields } = embed.toJSON();
		assert.ok(embedLength(embed) <= 6000, `${count} players`);
		assert.ok(fields.length <= 25, `${count} players`);
		assert.ok(fields.every(f => f.value.length > 0 && f.value.length <= 1024), `${count} players`);
		assert.ok(fields.slice(3).every(f => f.inline), `${count} players`);
	}
	const crowded = fivemPayload({ server: fivemServer, status: fivemStatus(players(2000, 'x'.repeat(64))) }).embeds[0].toJSON();
	assert.match(crowded.fields.at(-1).value, /… et \d+ autres/);
});

test('FiveM status: fill bar, average ping and a short list in one column', () => {
	const list = [{ id: 7, name: '**Jo**', ping: 30 }, { id: 12, name: 'Un nom vraiment beaucoup trop long', ping: 50 }];
	const embed = fivemPayload({ server: fivemServer, status: fivemStatus(list), guild: { icon: 'https://cdn.discordapp.com/icons/1/a.png' } }).embeds[0].toJSON();
	assert.equal(embed.fields[1].value, '**2** / 64\n▰▱▱▱▱▱▱▱▱▱');
	assert.equal(embed.fields[3].name, '👥 Connectés (2)');
	assert.equal(embed.fields[3].inline, false);
	assert.match(embed.fields[3].value, /^` {2}7` Jo\n` 12` Un nom vraiment b…\n$/);
	assert.match(embed.footer.text, /Ping moyen 40 ms/);
	assert.equal(embed.thumbnail.url, 'https://cdn.discordapp.com/icons/1/a.png');
});

test('FiveM status: with the picture, the state lives in the image and the players stay listed', () => {
	const payload = fivemPayload({ server: fivemServer, status: fivemStatus(players(3, 'Jo')), image: Buffer.from('png') });
	const embed = payload.embeds[0].toJSON();
	assert.equal(embed.image, undefined, 'the picture goes above the embed, shown wider');
	assert.deepEqual(payload.files.map(f => f.name), ['fivem-statut.png']);
	assert.deepEqual(embed.fields.map(f => f.name), ['👥 Connectés (3)']);
	assert.deepEqual(fivemPayload({ server: fivemServer, status: fivemStatus([]) }).files, []);
});

test('FiveM status: the embed follows its settings, and comes back when there is no picture', () => {
	const server = { ...fivemServer, joinCode: 'abc123', config: { ...fivemServer.config, embed: { enabled: false, buttonLabel: 'Rejoindre' } } };
	const png = Buffer.from('png');
	const only = fivemPayload({ server, status: fivemStatus(players(3, 'Jo')), image: png });
	assert.deepEqual(only.embeds, [], 'the picture alone');
	assert.equal(only.files.length, 1);
	assert.equal(only.components[0].components[0].toJSON().label, 'Rejoindre');
	assert.equal(fivemPayload({ server, status: fivemStatus([]) }).embeds.length, 1, 'no picture: the embed comes back');

	const custom = { ...fivemServer, joinCode: 'abc123', config: { ...fivemServer.config, showPlayers: false, embed: { title: '{name} · {players}/{max}', description: 'Statut : {status}', fields: false, footer: false, thumbnail: false, button: false } } };
	const payload = fivemPayload({ server: custom, status: fivemStatus(players(3, 'Jo')), guild: { icon: 'https://cdn.discordapp.com/icons/1/a.png' } });
	const embed = payload.embeds[0].toJSON();
	assert.equal(embed.title, 'BRL · 3/64');
	assert.equal(embed.description, 'Statut : En ligne');
	assert.equal(embed.fields, undefined);
	assert.equal(embed.footer, undefined);
	assert.equal(embed.thumbnail, undefined);
	assert.deepEqual(payload.components, []);
});

test('FiveM status: nobody connected and server down still give a valid message', () => {
	const empty = fivemPayload({ server: fivemServer, status: fivemStatus([]) }).embeds[0].toJSON();
	assert.match(empty.fields.at(-1).value, /Personne/);
	assert.equal(empty.footer.text, 'Mis à jour');
	const down = fivemPayload({ server: fivemServer, status: { online: false, players: 0, max: 64, list: [], checkedAt: Date.now() } }).embeds[0].toJSON();
	assert.match(down.description, /ne répond pas/);
	assert.equal(down.fields[1].value, '—');
});
