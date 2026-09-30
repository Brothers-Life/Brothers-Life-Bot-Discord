import { ValidationError } from './errors.js';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR = 3_600_000;
export const DEFAULT_TIME_ZONE = 'Europe/Paris';

function validTimeZone(tz) {
	try {
		new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
		return true;
	}
	catch {
		return false;
	}
}

// Wall clock of a moment in a time zone
export function zonedParts(at, timeZone) {
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
		timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
	}).formatToParts(new Date(at)).map(p => [p.type, p.value]));
	return {
		year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute),
		weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
	};
}

function offsetAt(at, timeZone) {
	const p = zonedParts(at, timeZone);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(at / 60_000) * 60_000;
}

// Moment of a wall clock time in a time zone (daylight saving time included)
export function zonedTime(year, month, day, hour, minute, timeZone) {
	const guess = Date.UTC(year, month - 1, day, hour, minute);
	const first = guess - offsetAt(guess, timeZone);
	const second = guess - offsetAt(first, timeZone);
	return second;
}

function int(value, min, max) {
	const n = Number(value);
	return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// { type: 'daily' | 'weekly' | 'monthly' | 'interval', time: 'HH:MM', days: [0-6], dayOfMonth, everyHours, endAt, maxRuns, timeZone } or null
export function normalizeRecurrence(input) {
	if (!input || input.type === 'once' || !input.type) return null;
	if (!['daily', 'weekly', 'monthly', 'interval'].includes(input.type)) throw new ValidationError('Type de récurrence inconnu.');
	const timeZone = input.timeZone && validTimeZone(input.timeZone) ? input.timeZone : DEFAULT_TIME_ZONE;
	const out = { type: input.type, time: '09:00', days: [], dayOfMonth: null, everyHours: null, endAt: null, maxRuns: null, timeZone };
	if (input.type !== 'interval') {
		if (!TIME.test(input.time ?? '')) throw new ValidationError('Heure d’envoi invalide (HH:MM).');
		out.time = input.time;
	}
	if (input.type === 'weekly') {
		out.days = [...new Set((Array.isArray(input.days) ? input.days : []).map(d => int(d, 0, 6)).filter(d => d !== null))].sort();
		if (!out.days.length) throw new ValidationError('Choisis au moins un jour de la semaine.');
	}
	if (input.type === 'monthly') {
		out.dayOfMonth = int(input.dayOfMonth, 1, 31);
		if (!out.dayOfMonth) throw new ValidationError('Jour du mois invalide (1 à 31).');
	}
	if (input.type === 'interval') {
		out.everyHours = int(input.everyHours, 1, 720);
		if (!out.everyHours) throw new ValidationError('Intervalle invalide : de 1 à 720 heures.');
	}
	if (input.endAt !== undefined && input.endAt !== null) {
		out.endAt = int(input.endAt, 0, Number.MAX_SAFE_INTEGER);
		if (out.endAt === null) throw new ValidationError('Date de fin invalide.');
	}
	if (input.maxRuns !== undefined && input.maxRuns !== null && input.maxRuns !== '') {
		out.maxRuns = int(input.maxRuns, 1, 10_000);
		if (!out.maxRuns) throw new ValidationError('Nombre d’envois invalide.');
	}
	return out;
}

// First occurrence strictly after `after` (for "interval": `previous` + N hours, skipping missed ones), or null when the series is over
export function nextOccurrence(rec, after, { previous = null, runs = 0 } = {}) {
	if (!rec) return null;
	if (rec.maxRuns && runs >= rec.maxRuns) return null;
	let next = null;
	if (rec.type === 'interval') {
		const step = rec.everyHours * HOUR;
		next = previous === null ? after + step : previous + step * Math.max(1, Math.ceil((after - previous + 1) / step));
	}
	else {
		const [hour, minute] = rec.time.split(':').map(Number);
		const start = zonedParts(after, rec.timeZone);
		for (let i = 0; i < 800 && next === null; i++) {
			// Calendar day by day, from the wall-clock date of `after`
			const date = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
			const y = date.getUTCFullYear();
			const m = date.getUTCMonth() + 1;
			const d = date.getUTCDate();
			if (rec.type === 'weekly' && !rec.days.includes(date.getUTCDay())) continue;
			if (rec.type === 'monthly') {
				const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
				if (d !== Math.min(rec.dayOfMonth, lastDay)) continue;
			}
			const at = zonedTime(y, m, d, hour, minute, rec.timeZone);
			if (at > after) next = at;
		}
	}
	if (next === null || (rec.endAt && next > rec.endAt)) return null;
	return next;
}

// Occurrences between two dates (calendar view), starting from the next planned one
export function occurrences(rec, first, from, to, { runs = 0, limit = 200 } = {}) {
	const out = [];
	let at = first;
	let count = runs;
	while (at !== null && at <= to && out.length < limit) {
		if (at >= from) out.push(at);
		count++;
		at = rec ? nextOccurrence(rec, at, { previous: at, runs: count }) : null;
	}
	return out;
}
