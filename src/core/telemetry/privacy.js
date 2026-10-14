// Player identifiers never reach the panel: licenses, IPs, tokens, HWIDs, Steam/Xbox/Live/FiveM ids.
// The game resource already drops these columns (bl_telemetry/server/live.lua); this is the bot's own guard,
// applied when storing event data and again on everything the telemetry views return.

// Same rule as isSensitive() of live.lua: whole word, word_ prefix, _word suffix, _word_ inside,
// or anywhere for words longer than 4 letters
const SENSITIVE = ['license', 'ip', 'discord', 'steam', 'token', 'hwid', 'fivem', 'xbl', 'live', 'password', 'secret', 'identifier', 'tokens', 'identifiers', 'ip_address', 'endpoint'];

export function isSensitiveKey(key) {
	const k = String(key).toLowerCase();
	return SENSITIVE.some(w => k === w || k.startsWith(`${w}_`) || k.endsWith(`_${w}`) || k.includes(`_${w}_`) || (w.length > 4 && k.includes(w)));
}

// Identifiers written inside free text (console lines, reasons): replaced by a mask
const PATTERNS = [
	/\b(?:license2?|steam|xbl|live|fivem|hwid|ip):[\w.:-]+/gi,
	// FiveM player tokens ("3:abcdef…")
	/\b\d{1,2}:[0-9a-f]{40,}\b/gi,
	// IPv4 with an optional port
	/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?::\d{1,5})?\b/g,
	// Long hex fingerprints (license hashes, HWIDs)
	/\b[0-9a-f]{32,}\b/gi,
];
const MASK = '[masqué]';

export function redactText(value) {
	let out = String(value);
	for (const pattern of PATTERNS) out = out.replace(pattern, MASK);
	return out;
}

// Deep copy without sensitive keys, with identifiers masked inside strings. Dates and numbers are kept.
// Links (death screenshots) are kept as they are: masking a part of them would only break them.
export function scrub(value, depth = 0, key = '') {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string') return /url$/i.test(key) && /^https?:\/\//i.test(value) ? value : redactText(value);
	if (typeof value !== 'object' || value instanceof Date) return value;
	if (depth > 12) return null;
	if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1, key));
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		if (!isSensitiveKey(k)) out[k] = scrub(v, depth + 1, k);
	}
	return out;
}

// Removes the sensitive keys only (event data before it is stored): the text is kept as sent
export function withoutSensitiveKeys(value, depth = 0) {
	if (value === null || typeof value !== 'object' || value instanceof Date) return value;
	if (depth > 12) return null;
	if (Array.isArray(value)) return value.map(v => withoutSensitiveKeys(v, depth + 1));
	const out = {};
	for (const [key, v] of Object.entries(value)) {
		if (!isSensitiveKey(key)) out[key] = withoutSensitiveKeys(v, depth + 1);
	}
	return out;
}
