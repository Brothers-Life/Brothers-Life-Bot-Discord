import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { fromEphemeralMessage } from '../../src/bot/forms.js';

const modal = (flags) => ({ isFromMessage: () => flags !== undefined, message: flags === undefined ? null : { flags: { has: f => (flags & f) === f } } });

test('only the ephemeral "continue" message of a form is replaced, never a public panel', () => {
	assert.equal(fromEphemeralMessage(modal(MessageFlags.Ephemeral)), true);
	assert.equal(fromEphemeralMessage(modal(0)), false, 'modal opened from a ticket panel');
	assert.equal(fromEphemeralMessage(modal(undefined)), false, 'modal opened from a slash command');
});
