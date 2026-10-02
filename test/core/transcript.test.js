import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineImages, markdown, renderTicketTranscript } from '../../src/core/transcript.js';

const A = '300000000000000001';
const msg = (over = {}) => ({ id: '1', authorId: A, authorName: 'Léa', authorAvatar: null, bot: false, content: '', createdAt: Date.UTC(2026, 9, 1, 10), attachments: [], embeds: [], ...over });

test('markdown: Discord formatting, mentions with names, nothing executable', () => {
	const html = markdown('**gras** *ita* ~~barré~~ ||spoil|| `code` <@300000000000000001> <:brl:123456789012345678> [site](https://brl.fr) <script>alert(1)</script> [x](javascript:alert(1))', { users: { [A]: 'Léa' } });
	assert.match(html, /<strong>gras<\/strong>/);
	assert.match(html, /<em>ita<\/em>/);
	assert.match(html, /<s>barré<\/s>/);
	assert.match(html, /class="spoiler">spoil/);
	assert.match(html, /<code>code<\/code>/);
	assert.match(html, /@Léa/);
	assert.match(html, /cdn\.discordapp\.com\/emojis\/123456789012345678\.webp/);
	assert.match(html, /<a href="https:\/\/brl\.fr"[^>]*>site<\/a>/);
	assert.doesNotMatch(html, /<script>/);
	assert.doesNotMatch(html, /href="javascript/);
	assert.match(markdown('```js\nconst a = "<b>";\n```'), /<pre><code>const a = &quot;&lt;b&gt;&quot;;<\/code><\/pre>/);
});

test('page: grouped messages like Discord, day separators, opener tag, escaped data', () => {
	const t0 = Date.UTC(2026, 9, 1, 10);
	const html = renderTicketTranscript({
		guild: { name: 'Brothers Life' }, ticket: { number: 7, openerId: A, openerName: 'Léa', createdAt: t0, subject: '<i>Grade</i>', answers: [] },
		category: { name: 'Support' }, closedAt: t0 + 86_400_000, reason: 'ok',
		messages: [
			msg({ id: '1', content: 'Salut' }),
			msg({ id: '2', content: 'Tu es là ?', createdAt: t0 + 60_000 }),
			msg({ id: '3', authorId: '2', authorName: 'Staff', content: 'Oui', createdAt: t0 + 120_000, embeds: [{ title: 'Info', description: 'x', fields: [{ name: 'A', value: 'B', inline: true }], color: '#ff9628' }] }),
			msg({ id: '4', content: 'Le lendemain', createdAt: t0 + 86_400_000 }),
		],
	});
	assert.equal((html.match(/class="msg cont/g) ?? []).length, 1, 'second message of Léa grouped');
	assert.equal((html.match(/class="day"/g) ?? []).length, 2);
	assert.match(html, /class="tag opener">AUTEUR/);
	assert.match(html, /&lt;i&gt;Grade&lt;\/i&gt;/);
	assert.match(html, /class="field inline"/);
	assert.match(html, /Durée<\/dt><dd>24 h 00/);
});

test('inlineImages: Discord images copied into the page within the size limit', async () => {
	const messages = [msg({ attachments: [
		{ name: 'a.png', url: 'https://cdn.discordapp.com/a.png', contentType: 'image/png', size: 3 },
		{ name: 'b.png', url: 'https://cdn.discordapp.com/b.png', contentType: 'image/png', size: 3 },
		{ name: 'c.png', url: 'https://evil.example/c.png', contentType: 'image/png', size: 3 },
	] })];
	const fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]));
	await inlineImages(messages, { fetchImpl, maxTotal: 4 });
	const [a, b, c] = messages[0].attachments;
	assert.match(a.url, /^data:image\/png;base64,/);
	assert.equal(b.url, 'https://cdn.discordapp.com/b.png', 'over the total limit: kept as a link');
	assert.equal(c.url, 'https://evil.example/c.png', 'only Discord images are fetched');
});
