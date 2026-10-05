const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, j: 86_400_000, w: 604_800_000, sem: 604_800_000 };

// "10m", "2h", "7j", "1w", "1h30m" → milliseconds (null if invalid)
export function parseDuration(input) {
	if (input === null || input === undefined || input === '') return null;
	if (typeof input === 'number') return Number.isSafeInteger(input) && input > 0 ? input : null;
	const text = String(input).trim().toLowerCase().replace(/\s+/g, '');
	const parts = [...text.matchAll(/(\d+)(sem|[smhdjw])/g)];
	if (!parts.length || parts.map(p => p[0]).join('') !== text) return null;
	const total = parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit], 0);
	return Number.isSafeInteger(total) && total > 0 ? total : null;
}

// `none`: what "no duration" means (a ban is permanent, a restriction lasts until lifted)
export function formatDuration(ms, none = 'définitif') {
	if (!ms) return none;
	const units = [['j', 86_400_000], ['h', 3_600_000], ['min', 60_000], ['s', 1000]];
	const out = [];
	let rest = ms;
	for (const [label, size] of units) {
		const n = Math.floor(rest / size);
		if (n) {
			out.push(`${n} ${label}`);
			rest -= n * size;
		}
		if (out.length === 2) break;
	}
	return out.join(' ') || '0 s';
}
