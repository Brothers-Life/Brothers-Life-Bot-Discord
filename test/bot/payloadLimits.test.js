import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomePayload } from '../../src/bot/ticketsUi.js';
import { applicationPayload } from '../../src/bot/recruitmentUi.js';
import { appealPayload } from '../../src/bot/appealsUi.js';
import { takeoverPanelPayload, takeoverPickerPayload } from '../../src/bot/takeoversUi.js';

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
