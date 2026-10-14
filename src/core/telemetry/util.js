// Small helpers shared by the telemetry modules

// Integer parameter bounded to [min, max], `def` when missing or invalid
export const clampInt = (v, def, min, max) => Math.min(Math.max(parseInt(v, 10) || def, min), max);

const MAX_MONEY = 9e15;
// Money and big counters: rounded and bounded (a broken script must not overflow BIGINT)
export function num(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	return Math.max(-MAX_MONEY, Math.min(MAX_MONEY, Math.round(n)));
}

// Plain numbers (positions, FPS) and integers of INT columns (grades, quantities, counts)
export const real = v => (v === null || v === undefined || v === '' || typeof v === 'object' || !Number.isFinite(Number(v)) ? null : Number(v));
export const int = (v) => {
	const n = real(v);
	return n === null ? null : Math.max(-2147483648, Math.min(2147483647, Math.round(n)));
};
export const text = (v, max = 200) => (v === null || v === undefined || v === '' || typeof v === 'object' ? null : String(v).slice(0, max));
export const arrayOf = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
