import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmoji, isValidEmoji } from '../../src/core/emoji.js';
import { emojiOf } from '../../src/bot/messages.js';
import { normalizeForm } from '../../src/core/forms.js';

test('unicode emojis are accepted, including sequences', () => {
	for (const e of ['🎫', '✅', '❤️', '👍🏽', '👨‍👩‍👧', '🇫🇷', '1️⃣', '#️⃣', '🏳️‍🌈', '©️']) {
		assert.deepEqual(parseEmoji(e), { name: e }, e);
	}
});

test('custom emojis in every common form', () => {
	assert.deepEqual(parseEmoji('<:ticket:123456789012345678>'), { id: '123456789012345678', name: 'ticket', animated: false });
	assert.deepEqual(parseEmoji('<a:party_blob:123456789012345678>'), { id: '123456789012345678', name: 'party_blob', animated: true });
	assert.deepEqual(parseEmoji('ticket:123456789012345678'), { id: '123456789012345678', name: 'ticket', animated: false });
	assert.deepEqual(parseEmoji('123456789012345678'), { id: '123456789012345678' });
});

test('text, shortcodes and digits are refused', () => {
	for (const e of [':ticket:', 'ticket', 'Support', '1', '12', '🎫 Support', '<:ticket:12>', '', '  ', null, undefined, 42]) {
		assert.equal(isValidEmoji(e), false, String(e));
	}
});

test('emojiOf drops what Discord would refuse', () => {
	assert.equal(emojiOf(':ticket:'), undefined);
	assert.equal(emojiOf('🎫'), '🎫');
	assert.deepEqual(emojiOf('<a:x:123456789012345678>'), { id: '123456789012345678', animated: true });
});

test('a form keeps valid option emojis and drops the others', () => {
	const form = normalizeForm({ steps: [{ questions: [{ id: 'q', type: 'select', label: 'Choix', options: [
		{ label: 'A', emoji: '🎫' }, { label: 'B', emoji: ':ticket:' }, { label: 'C', emoji: 'Support' }, { label: 'D', emoji: '<:x:123456789012345678>' },
	] }] }] });
	assert.deepEqual(form.steps[0].questions[0].options.map(o => o.emoji), ['🎫', '', '', '<:x:123456789012345678>']);
});
