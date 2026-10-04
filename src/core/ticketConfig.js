import { ValidationError } from './errors.js';
import { normalizeForm as normalizeAnyForm } from './forms.js';

// Pure helpers of the ticket configuration: everything here is validated input, with Discord's limits

const SNOWFLAKE = /^\d{17,20}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_LABELS = { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' };
export const BUILTIN_STATUSES = [
	{ key: 'open', label: 'Ouvert', emoji: '🟢', color: '#3ccb8a' },
	{ key: 'claimed', label: 'Pris en charge', emoji: '🟡', color: '#d6a249' },
	{ key: 'closed', label: 'Fermé', emoji: '🔒', color: '#8b8b8b' },
];
export const BUILTIN_KEYS = new Set(BUILTIN_STATUSES.map(s => s.key));

const ids = (value, max = 25) => (Array.isArray(value) ? value : []).filter(v => SNOWFLAKE.test(v)).slice(0, max);
const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const text = (value, max, fallback = '') => (typeof value === 'string' ? value.slice(0, max) : fallback);
const color = (value, fallback) => (typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : fallback);

const DEFAULT_FORM = { steps: [{ title: '', when: null, questions: [{ id: 'subject', type: 'paragraph', label: 'Sujet de ta demande', description: '', placeholder: '', required: true, minLength: 0, maxLength: 200, defaultValue: '' }] }] };

// No form configured yet: a single "subject" question, like before forms existed
export function normalizeForm(input) {
	return normalizeAnyForm(input, { fallback: DEFAULT_FORM });
}

function normalizeHours(input = {}) {
	let timezone = typeof input.timezone === 'string' ? input.timezone : 'Europe/Paris';
	try {
		new Intl.DateTimeFormat('fr-FR', { timeZone: timezone });
	}
	catch {
		timezone = 'Europe/Paris';
	}
	const days = Array.from({ length: 7 }, (_, i) => {
		const day = Array.isArray(input.days) ? input.days[i] : null;
		return {
			open: bool(day?.open, true),
			from: TIME.test(day?.from) ? day.from : '00:00',
			to: TIME.test(day?.to) ? day.to : '23:59',
		};
	});
	return {
		enabled: bool(input.enabled, false),
		timezone,
		days,
		closedMessage: text(input.closedMessage, 500, 'Les tickets de ce type sont fermés en ce moment. Reviens pendant les horaires d’ouverture.') || 'Les tickets de ce type sont fermés en ce moment.',
	};
}

export function normalizeCategoryConfig(input = {}) {
	const welcome = input.welcome ?? {};
	const access = input.access ?? {};
	const claim = input.claim ?? {};
	const close = input.close ?? {};
	const inactivity = input.inactivity ?? {};
	const statusParents = {};
	for (const [key, value] of Object.entries(input.statusParents ?? {})) {
		if (/^[a-z0-9_]{1,30}$/.test(key) && SNOWFLAKE.test(value)) statusParents[key] = value;
	}
	const closeHours = int(inactivity.closeHours, 0, 2160, 0);
	return {
		buttonStyle: BUTTON_STYLES.includes(input.buttonStyle) ? input.buttonStyle : 'secondary',
		form: normalizeForm(input.form),
		nameTemplate: text(input.nameTemplate, 90).trim() || 'ticket-{number}-{user}',
		ping: ['staff', 'none', 'roles'].includes(input.ping) ? input.ping : 'staff',
		pingRoleIds: ids(input.pingRoleIds),
		welcome: {
			title: text(welcome.title, 256, 'Ticket #{number} · {type}'),
			message: text(welcome.message, 4000, 'Bonjour {user}, l’équipe va te répondre ici. Explique ta demande en détail.'),
			color: color(welcome.color, '#d6a249'),
			showAnswers: bool(welcome.showAnswers, true),
		},
		access: {
			requiredRoleIds: ids(access.requiredRoleIds),
			requiredMode: access.requiredMode === 'all' ? 'all' : 'any',
			blockedRoleIds: ids(access.blockedRoleIds),
			maxOpen: int(access.maxOpen, 0, 10, 0),
			cooldownMinutes: int(access.cooldownMinutes, 0, 10080, 0),
			minAccountAgeDays: int(access.minAccountAgeDays, 0, 3650, 0),
			hours: normalizeHours(access.hours),
		},
		claim: {
			exclusiveWrite: bool(claim.exclusiveWrite, false),
		},
		close: {
			requireReason: bool(close.requireReason, false),
			openerCanClose: bool(close.openerCanClose, true),
			confirm: bool(close.confirm, true),
			mode: close.mode === 'archive' ? 'archive' : 'delete',
			deleteDelaySeconds: int(close.deleteDelaySeconds, 0, 86400, 10),
		},
		inactivity: {
			reminderHours: int(inactivity.reminderHours, 0, 720, 0),
			closeHours,
		},
		// Close request of the staff: closed alone after this many hours without an answer (0 = never)
		closeRequest: { autoCloseHours: int(input.closeRequest?.autoCloseHours, 0, 720, 24) },
		// Alert in the "tickets" logs when nobody of the staff answered within this delay (0 = no SLA)
		sla: { firstResponseMinutes: int(input.sla?.firstResponseMinutes, 0, 10080, 0) },
		rating: { enabled: bool(input.rating?.enabled, false) },
		transcriptDm: bool(input.transcriptDm, true),
		statusParents,
	};
}

export function normalizeGuildConfig(input = {}) {
	return {
		maxOpen: int(input.maxOpen, 1, 20, 1),
		statusPrefix: bool(input.statusPrefix, true),
	};
}

// Custom statuses of a server; built-in ones can be renamed or moved but not removed
export function normalizeStatuses(input) {
	if (!Array.isArray(input)) throw new ValidationError('Liste de statuts attendue.');
	if (input.length > 20) throw new ValidationError('20 statuts maximum.');
	const seen = new Set();
	const out = input.map((s, position) => {
		const key = typeof s?.key === 'string' ? s.key : '';
		if (!/^[a-z0-9_]{1,30}$/.test(key)) throw new ValidationError(`Clé de statut invalide : « ${key} » (minuscules, chiffres et _).`);
		if (seen.has(key)) throw new ValidationError(`Statut en double : ${key}.`);
		seen.add(key);
		const label = text(s.label, 50).trim();
		if (!label) throw new ValidationError(`Le statut « ${key} » n’a pas de nom.`);
		const builtin = BUILTIN_STATUSES.find(b => b.key === key);
		return {
			key,
			label,
			emoji: text(s.emoji, 64).trim() || builtin?.emoji || null,
			color: color(s.color, builtin?.color ?? '#5b9cf6'),
			parentChannelId: SNOWFLAKE.test(s.parentChannelId) ? s.parentChannelId : null,
			position,
		};
	});
	for (const builtin of BUILTIN_STATUSES) {
		if (!seen.has(builtin.key)) out.push({ ...builtin, parentChannelId: null, position: out.length });
	}
	return out;
}

// Discord-safe channel name from a template such as "ticket-{number}-{user}"
export function slugName(value) {
	return value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'ticket';
}

export function fill(template, vars) {
	return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match));
}

// Variables of the ticket texts on top of the shared ones (variables.js); {answer.<id>} for the form answers
export const TICKET_VARIABLES = [
	{ key: 'number', label: 'Numéro du ticket' },
	{ key: 'type', label: 'Type de ticket' },
	{ key: 'subject', label: 'Sujet (première réponse écrite)' },
	{ key: 'status', label: 'Statut' },
	{ key: 'claimer', label: 'Staff qui a pris le ticket' },
	{ key: 'tickets.count', label: 'Tickets déjà ouverts par le membre' },
];

// Creation time of a Discord account, read from its ID
export function accountCreatedAt(userId) {
	return Number((BigInt(userId) >> 22n) + 1420070400000n);
}

const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function isWithinHours(hours, at = Date.now()) {
	if (!hours.enabled) return true;
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: hours.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
		.formatToParts(new Date(at)).map(p => [p.type, p.value]));
	const day = hours.days[WEEKDAYS[parts.weekday]];
	if (!day?.open) return false;
	const now = `${parts.hour}:${parts.minute}`;
	// "22:00 -> 02:00" spans midnight
	return day.from <= day.to ? now >= day.from && now <= day.to : now >= day.from || now <= day.to;
}
