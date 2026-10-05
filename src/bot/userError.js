import { AppError } from '../core/errors.js';
import { permissionLabel } from '../core/permissions.js';

// Shown when something unexpected breaks (always French, whatever the Discord language of the member)
export const GENERIC_ERROR = 'Oups, ça n’a pas marché. Réessaie, et préviens le staff si ça continue.';

const MISSING = /^Permission manquante\s*:\s*([a-z]+(?:\.[a-z_]+)+)\.?$/;

// "Permission manquante : sanctions.ban" is for developers: members read the label of the permission instead
export function readableError(error) {
	const message = String(error?.message ?? '');
	const key = MISSING.exec(message.trim())?.[1];
	if (key) {
		const label = permissionLabel(key);
		// Lowercase the first letter of a plain word ("Bannir…" → "bannir…"), not of an acronym ("API…")
		const text = label ? (/^\p{Lu}\p{Ll}/u.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label) : key;
		return `Ton rang ne te permet pas de : ${text.replace(/[.\s]+$/, '')}.`;
	}
	return message;
}

// The line shown to the member for an error: business errors as is (permissions made readable), the rest generic
export function errorContent(error, prefix = 'Impossible : ') {
	if (!(error instanceof AppError)) return GENERIC_ERROR;
	const readable = readableError(error);
	return readable === error.message ? `${prefix}${readable}` : readable;
}
