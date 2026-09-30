import { ValidationError } from './errors.js';

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
		return {
			label,
			value: text(o?.value, 100).trim() || label.slice(0, 100),
			description: text(o?.description, 100).trim(),
			emoji: text(o?.emoji, 64).trim(),
		};
	});
	if (!options.length) throw new ValidationError(`${where} : ajoute au moins un choix.`);
	if (new Set(options.map(o => o.value)).size !== options.length) throw new ValidationError(`${where} : deux choix ont la même valeur.`);
	return options;
}

function normalizeField(q, where, seen, fallbackId) {
	const label = text(q?.label, 45).trim();
	if (!label) throw new ValidationError(`${where} : le libellé est obligatoire (45 caractères max).`);
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
