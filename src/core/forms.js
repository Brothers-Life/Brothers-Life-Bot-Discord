import { ValidationError } from './errors.js';
import { isValidEmoji } from './emoji.js';

// Forms shown as Discord modals: tickets, suggestions, bug reports, staff applications.
// A form is up to 5 steps (one modal each), a step is 1 to 5 fields.

export const FIELD_TYPES = ['short', 'paragraph', 'select', 'user', 'role', 'channel', 'file'];
const ID = /^[a-z0-9_]{1,30}$/;

const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);
const text = (value, max, fallback = '') => (typeof value === 'string' ? value.slice(0, max) : fallback);

function normalizeOptions(input, where) {
	const options = (Array.isArray(input) ? input : []).slice(0, 25).map((o, i) => {
		const label = text(o?.label, 100).trim();
		if (!label) throw new ValidationError(`${where} : le choix ${i + 1} n’a pas de libellé.`);
		// Also runs when reading a saved config: an invalid emoji (text, ":name:") is dropped, not refused,
		// otherwise Discord rejects the whole modal
		const emoji = text(o?.emoji, 64).trim();
		return {
			label,
			value: text(o?.value, 100).trim() || label.slice(0, 100),
			description: text(o?.description, 100).trim(),
			emoji: isValidEmoji(emoji) ? emoji : '',
		};
	});
	if (!options.length) throw new ValidationError(`${where} : ajoute au moins un choix.`);
	if (new Set(options.map(o => o.value)).size !== options.length) throw new ValidationError(`${where} : deux choix ont la même valeur.`);
	return options;
}

// Discord limits of a modal field: 45 characters for its label, 100 for the description under it
const LABEL_MAX = 45;
const DESCRIPTION_MAX = 100;
export const QUESTION_MAX = LABEL_MAX + DESCRIPTION_MAX;

// A question longer than a Discord label continues in the description of the field, cut between
// two words. Returns what the modal shows: { label, description }.
export function modalLabel(q) {
	const question = String(q?.label ?? '').trim();
	const description = String(q?.description ?? '').trim();
	if (question.length <= LABEL_MAX) return { label: question, description };
	const space = question.lastIndexOf(' ', LABEL_MAX);
	const cut = space >= 20 ? space : LABEL_MAX;
	const rest = question.slice(cut).trim();
	return { label: question.slice(0, cut).trim(), description: description ? `${rest} — ${description}` : rest };
}

function normalizeField(q, where, seen, fallbackId) {
	const label = text(q?.label, QUESTION_MAX).trim();
	if (!label) throw new ValidationError(`${where} : le libellé est obligatoire.`);
	if (modalLabel({ label, description: text(q?.description, DESCRIPTION_MAX) }).description.length > DESCRIPTION_MAX) {
		throw new ValidationError(`${where} : la question est trop longue pour Discord (${QUESTION_MAX} caractères max, description comprise). Raccourcis la question ou sa description.`);
	}
	let id = typeof q?.id === 'string' && ID.test(q.id) ? q.id : fallbackId;
	while (seen.has(id)) id = `${id}_`;
	seen.add(id);
	const type = FIELD_TYPES.includes(q?.type) ? q.type : q?.style === 'short' ? 'short' : 'paragraph';
	const field = {
		id,
		type,
		label,
		description: text(q?.description, 100).trim(),
		required: typeof q?.required === 'boolean' ? q.required : true,
	};
	if (type === 'short' || type === 'paragraph') {
		const minLength = int(q?.minLength, 0, 4000, 0);
		const maxLength = Math.max(int(q?.maxLength, 1, 4000, type === 'short' ? 100 : 1000), minLength || 1);
		Object.assign(field, { placeholder: text(q?.placeholder, 100), minLength, maxLength, defaultValue: text(q?.defaultValue, maxLength) });
	}
	else if (type === 'select') {
		const options = normalizeOptions(q?.options, where);
		const maxValues = int(q?.maxValues, 1, options.length, 1);
		Object.assign(field, { placeholder: text(q?.placeholder, 150), options, minValues: Math.min(int(q?.minValues, 0, 25, field.required ? 1 : 0), maxValues), maxValues });
	}
	else if (type === 'file') {
		Object.assign(field, { maxValues: int(q?.maxValues, 1, 10, 1) });
	}
	else {
		Object.assign(field, { placeholder: text(q?.placeholder, 150), maxValues: int(q?.maxValues, 1, 25, 1) });
	}
	return field;
}

export function normalizeForm(input, { fallback = null, maxSteps = 5 } = {}) {
	if (!input || !Array.isArray(input.steps)) return structuredClone(fallback ?? { steps: [] });
	const seen = new Set();
	const steps = input.steps.slice(0, maxSteps).map((step, si) => {
		const questions = (Array.isArray(step?.questions) ? step.questions : []).slice(0, 5)
			.map((q, qi) => normalizeField(q, `Étape ${si + 1}, question ${qi + 1}`, seen, `q${si + 1}_${qi + 1}`));
		if (!questions.length) throw new ValidationError(`L’étape ${si + 1} du formulaire n’a aucune question.`);
		// Optional condition: this step is shown only if an earlier answer has this value
		const when = step?.when && seen.has(step.when.field) && typeof step.when.equals === 'string'
			? { field: step.when.field, equals: step.when.equals.slice(0, 100) }
			: null;
		return { title: text(step?.title, 45).trim(), questions, when: si === 0 ? null : when };
	});
	return { steps };
}

// Index of the next step to show after `from`, skipping steps whose condition is not met (-1: finished)
export function nextStep(form, from, answers) {
	for (let i = from; i < form.steps.length; i++) {
		const when = form.steps[i].when;
		if (!when) return i;
		const answer = answers.find(a => a.id === when.field);
		if (answer && (answer.raw ?? [answer.value]).includes(when.equals)) return i;
	}
	return -1;
}

// Checks the values read from a modal: { [fieldId]: string | string[] } -> answers
export function readStep(step, values) {
	return step.questions.map((q) => {
		const raw = values[q.id];
		const list = Array.isArray(raw) ? raw.map(String) : raw === undefined || raw === null || raw === '' ? [] : [String(raw)];
		if (q.required && !list.length) throw new ValidationError(`« ${q.label} » est obligatoire.`);
		let value;
		if (q.type === 'short' || q.type === 'paragraph') value = (list[0] ?? '').trim().slice(0, q.maxLength);
		else if (q.type === 'select') value = list.map(v => q.options.find(o => o.value === v)?.label ?? v).join(', ');
		else value = list.join(', ');
		if (q.required && !value) throw new ValidationError(`« ${q.label} » est obligatoire.`);
		return { id: q.id, label: q.label, type: q.type, value: value.slice(0, 4000), raw: list.slice(0, 25) };
	});
}
