import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { withNetwork, ALICE, MAIN } from '../helpers.js';
import { toEmbed } from '../../src/bot/executor.js';
import { duration, messageDeleted } from '../../src/bot/eventLog.js';
import { describeAuditEntry } from '../../src/core/describe.js';

test('log embeds: category emoji, author with avatar, thumbnail, image, hex colors, footer with the category', () => {
	const embed = toEmbed({
		title: 'Message supprimé', category: 'messages', categoryLabel: 'Messages', color: '#ff9628',
		author: { name: 'Alice (@alice)', iconUrl: 'https://cdn.example/a.png' }, thumbnail: 'https://cdn.example/a.png', image: 'https://cdn.example/pic.png',
		footer: 'Membre 1', fields: [{ name: 'Contenu', value: 'salut' }],
	}).toJSON();
	assert.equal(embed.title, '💬 Message supprimé');
	assert.equal(embed.color, 0xff9628);
	assert.equal(embed.author.name, 'Alice (@alice)');
	assert.equal(embed.thumbnail.url, 'https://cdn.example/a.png');
	assert.equal(embed.image.url, 'https://cdn.example/pic.png');
	assert.equal(embed.footer.text, 'Membre 1 · Messages');
	assert.equal(toEmbed({ title: '🎉 Déjà un émoji', category: 'messages' }).toJSON().title, '🎉 Déjà un émoji');
	assert.equal(toEmbed({ title: 'x', color: 'pink', image: 'javascript:alert(1)' }).toJSON().image, undefined);
});

test('log embeds: durations, panel actions with their author, the targeted member and a color from the verb', () => {
	assert.equal(duration(90_000), '1 min');
	assert.equal(duration(3 * 3600_000 + 5 * 60_000), '3 h 05');
	assert.equal(duration(2 * 86_400_000 + 3600_000), '2 j 1 h');
	assert.equal(duration(400 * 86_400_000), '1 an 1 mois');

	const ban = describeAuditEntry({ id: 1, at: Date.now(), actorId: '100000000000000001', source: 'panel', action: 'sanctions.ban', target: ALICE, details: { raison: 'spam' } });
	assert.equal(ban.authorId, '100000000000000001');
	assert.equal(ban.thumbnailUserId, ALICE);
	assert.equal(ban.color, 'danger');
	assert.ok(ban.fields.some(f => f.name === 'Quand'));
	const created = describeAuditEntry({ id: 2, at: Date.now(), actorId: 'system', source: 'system', action: 'tickets.create', target: '123456789012345678' });
	assert.equal(created.color, 'success');
	assert.equal(created.thumbnailUserId, null, 'a ticket ID is not a person');
	assert.equal(created.authorId, null);
});

test('log embeds: a deleted message carries its author, the deleted picture and links', async () => {
	const { core } = await withNetwork();
	const posted = [];
	core.logs.log = (guildId, category, message) => posted.push(message);
	const guild = { id: MAIN, client: { core } };
	const user = { id: ALICE, username: 'alice', globalName: 'Alice', displayAvatarURL: () => 'https://cdn.example/alice.png' };
	core.events.record = event => posted.push(event.message);
	messageDeleted({
		guild, author: user, partial: false, content: 'regarde', id: '42', channelId: '1', channel: { name: 'general' }, createdTimestamp: Date.now() - 60_000,
		attachments: new Collection([['a', { name: 'chat.png', url: 'https://cdn.example/chat.png', proxyURL: 'https://media.example/chat.png', size: 2048, contentType: 'image/png' }]]),
		reference: { messageId: '41', channelId: '1' },
	});
	const message = posted[0];
	assert.equal(message.author.name, 'Alice (@alice)');
	assert.equal(message.thumbnail, 'https://cdn.example/alice.png');
	assert.equal(message.image, 'https://media.example/chat.png');
	assert.ok(message.fields.some(f => f.name === 'Pièces jointes (1)' && f.value.includes('2 Ko')));
	assert.ok(message.fields.some(f => f.name === 'En réponse à'));
	assert.match(message.footer, /message 42/);
});
