import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { errorContent, GENERIC_ERROR, readableError } from '../../src/bot/userError.js';
import '../../src/core/context.js';

test('a missing permission is said with its label, not its key', () => {
	assert.equal(readableError(new ForbiddenError('Permission manquante : sanctions.revoke')), 'Ton rang ne te permet pas de : débannir, lever un timeout ou une restriction, retirer un warn.');
	assert.equal(errorContent(new ForbiddenError('Permission manquante : polls.manage')).startsWith('Ton rang ne te permet pas de : '), true);
	assert.equal(errorContent(new ForbiddenError('Permission manquante : inconnue.cle')), 'Ton rang ne te permet pas de : inconnue.cle.');
});

test('business errors are kept, unexpected ones become the generic French message', () => {
	assert.equal(errorContent(new ValidationError('Durée invalide.')), 'Impossible : Durée invalide.');
	assert.equal(errorContent(new ValidationError('Durée invalide.'), ''), 'Durée invalide.');
	assert.equal(errorContent(new Error('boom')), GENERIC_ERROR);
});
