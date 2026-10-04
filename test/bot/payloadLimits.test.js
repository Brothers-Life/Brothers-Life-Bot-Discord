import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomePayload } from '../../src/bot/ticketsUi.js';
import { applicationPayload } from '../../src/bot/recruitmentUi.js';
import { appealPayload } from '../../src/bot/appealsUi.js';

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
