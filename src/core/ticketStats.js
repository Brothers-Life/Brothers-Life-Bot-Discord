// Pure aggregation of the ticket statistics (volume, response and resolution times, SLA, ratings, staff)

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' });
// Closed by these "people", a ticket counts for nobody of the staff
const NOT_STAFF = new Set(['system', 'unknown']);

export function dayKey(ms) {
	return dayFormat.format(new Date(ms));
}

export function median(values) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function average(values) {
	return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

const round1 = n => (n === null ? null : Math.round(n * 10) / 10);
const between = (at, from, to) => at !== null && at !== undefined && at >= from && at <= to;

// Every day (Paris time) of the period, oldest first
export function daysOf(from, to) {
	const days = [];
	const start = Math.max(from, to - MAX_DAYS * DAY_MS);
	// 6 h steps: a day is never skipped by a change of time
	for (let at = start; at <= to; at += 6 * 3600_000) {
		const key = dayKey(at);
		if (days.at(-1) !== key) days.push(key);
	}
	if (days.at(-1) !== dayKey(to)) days.push(dayKey(to));
	return days;
}

// rows: tickets { id, categoryId, openerId, createdAt, closedAt, closedBy, claimedBy, firstResponseAt, firstResponderId, slaBreachedAt, rating }
// slaMinutes(categoryId) -> SLA of the type (0 = none)
export function ticketStats(rows, { from, to, slaMinutes = () => 0 }) {
	const opened = rows.filter(t => between(t.createdAt, from, to));
	const closed = rows.filter(t => between(t.closedAt, from, to));
	const firstResponses = opened.filter(t => t.firstResponseAt).map(t => t.firstResponseAt - t.createdAt);
	const resolutions = closed.map(t => t.closedAt - t.createdAt);
	const rated = closed.filter(t => t.rating);
	// A breach stays one even if the SLA of the type was removed since
	const tracked = opened.filter(t => t.slaBreachedAt > 0 || (slaMinutes(t.categoryId) > 0 && t.slaBreachedAt !== 0));
	const breaches = tracked.filter(t => t.slaBreachedAt > 0);

	const volume = new Map(daysOf(from, to).map(day => [day, { day, opened: 0, closed: 0 }]));
	for (const t of opened) {
		const day = volume.get(dayKey(t.createdAt));
		if (day) day.opened++;
	}
	for (const t of closed) {
		const day = volume.get(dayKey(t.closedAt));
		if (day) day.closed++;
	}

	const staff = new Map();
	const of = (userId) => {
		if (!staff.has(userId)) staff.set(userId, { userId, claimed: 0, closed: 0, responses: [], ratings: [] });
		return staff.get(userId);
	};
	for (const t of opened) {
		if (t.claimedBy) of(t.claimedBy).claimed++;
		if (t.firstResponseAt && t.firstResponderId) of(t.firstResponderId).responses.push(t.firstResponseAt - t.createdAt);
	}
	for (const t of closed) {
		if (t.closedBy && !NOT_STAFF.has(t.closedBy) && t.closedBy !== t.openerId) of(t.closedBy).closed++;
		// The rating goes to whoever handled the ticket
		const handler = t.claimedBy ?? t.firstResponderId ?? (t.closedBy !== t.openerId && !NOT_STAFF.has(t.closedBy) ? t.closedBy : null);
		if (t.rating && handler) of(handler).ratings.push(t.rating);
	}

	const categories = new Map();
	for (const t of opened) {
		const key = t.categoryId ?? 0;
		if (!categories.has(key)) categories.set(key, { categoryId: t.categoryId, opened: 0, responses: [], breaches: 0 });
		const c = categories.get(key);
		c.opened++;
		if (t.firstResponseAt) c.responses.push(t.firstResponseAt - t.createdAt);
		if (t.slaBreachedAt > 0) c.breaches++;
	}

	return {
		from,
		to,
		totals: {
			opened: opened.length,
			closed: closed.length,
			answered: firstResponses.length,
			firstResponseAvg: average(firstResponses),
			firstResponseMedian: median(firstResponses),
			resolutionAvg: average(resolutions),
			resolutionMedian: median(resolutions),
			slaTracked: tracked.length,
			slaBreaches: breaches.length,
			ratingAvg: round1(rated.length ? rated.reduce((a, t) => a + t.rating, 0) / rated.length : null),
			ratings: rated.length,
		},
		volume: [...volume.values()],
		staff: [...staff.values()]
			.map(s => ({
				userId: s.userId,
				claimed: s.claimed,
				closed: s.closed,
				answered: s.responses.length,
				firstResponseAvg: average(s.responses),
				ratingAvg: round1(s.ratings.length ? s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length : null),
				ratings: s.ratings.length,
			}))
			.sort((a, b) => (b.closed + b.claimed + b.answered) - (a.closed + a.claimed + a.answered)),
		categories: [...categories.values()].map(c => ({
			categoryId: c.categoryId, opened: c.opened, firstResponseAvg: average(c.responses), slaBreaches: c.breaches,
		})).sort((a, b) => b.opened - a.opened),
	};
}
