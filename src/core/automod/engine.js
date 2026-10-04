import { detectScam, extractInvites } from './scam.js';

export const ACTIONS = ['delete', 'warn', 'timeout', 'kick', 'ban', 'network_ban'];

export const DEFAULT_CONFIG = {
	enabled: true,
	exemptRoles: [],
	exemptChannels: [],
	spam: { enabled: true, maxMessages: 6, perSeconds: 5, maxDuplicates: 4, duplicateSeconds: 30, maxMentions: 6, action: 'timeout', timeoutMinutes: 10 },
	uploads: { enabled: true, maxPerMessage: 4, maxFiles: 8, perSeconds: 30, action: 'timeout', timeoutMinutes: 10 },
	scam: { enabled: true, action: 'network_ban', customDomains: [], customPatterns: [], blockEveryoneLinks: true },
	// allowNetwork: invites to the servers of the network are always fine
	invites: { enabled: false, action: 'delete', allowNetwork: true, allowedCodes: [] },
};

// Merges a partial config over the defaults, keeping only known keys
export function normalizeConfig(input = {}) {
	const out = structuredClone(DEFAULT_CONFIG);
	if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
	for (const key of ['exemptRoles', 'exemptChannels']) {
		if (Array.isArray(input[key])) out[key] = input[key].filter(v => typeof v === 'string').slice(0, 100);
	}
	for (const section of ['spam', 'uploads', 'scam', 'invites']) {
		for (const [key, fallback] of Object.entries(DEFAULT_CONFIG[section])) {
			const value = input[section]?.[key];
			if (value === undefined) continue;
			if (typeof fallback === 'boolean' && typeof value === 'boolean') out[section][key] = value;
			if (typeof fallback === 'number' && Number.isFinite(value)) out[section][key] = Math.max(1, Math.min(Math.round(value), 10_000));
			if (key === 'action' && ACTIONS.includes(value)) out[section][key] = value;
			if (Array.isArray(fallback) && Array.isArray(value)) out[section][key] = value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()).slice(0, 200);
		}
	}
	// "https://discord.gg/abc" or "abc": keep the code only
	out.invites.allowedCodes = out.invites.allowedCodes.map(code => code.split('/').filter(Boolean).pop());
	out.spam.timeoutMinutes = Math.min(out.spam.timeoutMinutes, 40_320);
	out.uploads.timeoutMinutes = Math.min(out.uploads.timeoutMinutes, 40_320);
	return out;
}

// Keeps a short history per member and decides whether a message breaks a rule.
// Pure logic: no Discord, no database.
export function createAutomodEngine({ now = Date.now, historySeconds = 120 } = {}) {
	const history = new Map();
	let evaluations = 0;

	// Members who stopped writing would otherwise stay in memory for good
	function sweep() {
		const at = now();
		for (const [key, entries] of history) {
			if (!entries.length || at - entries.at(-1).at >= historySeconds * 1000) history.delete(key);
		}
	}

	function recent(key) {
		if (++evaluations % 1000 === 0) sweep();
		const at = now();
		const entries = (history.get(key) ?? []).filter(e => at - e.at < historySeconds * 1000);
		history.set(key, entries);
		return entries;
	}

	function verdict(section, rule, reason) {
		return { rule, reason, action: section.action, timeoutMinutes: section.timeoutMinutes ?? null };
	}

	return {
		// message: { guildId, userId, content, mentionCount, attachmentCount, hasEveryone }
		// edited messages only go through content rules (no double counting of spam)
		evaluate(config, message, { edited = false } = {}) {
			if (!config.enabled) return null;
			const content = message.content ?? '';

			if (config.scam.enabled) {
				const reason = detectScam(content, { ...config.scam, hasEveryone: message.hasEveryone });
				if (reason) return verdict(config.scam, 'scam', reason);
			}

			if (config.invites.enabled) {
				const allowed = new Set([...config.invites.allowedCodes, ...(message.allowedInvites ?? [])]);
				const codes = extractInvites(content).filter(code => !allowed.has(code));
				if (codes.length) return verdict(config.invites, 'invite', `invitation Discord (${codes[0]})`);
			}

			if (edited) return null;

			const key = `${message.guildId}:${message.userId}`;
			const entries = recent(key);
			const at = now();
			entries.push({ at, content: content.trim().toLowerCase(), files: message.attachmentCount ?? 0 });

			if (config.uploads.enabled) {
				if ((message.attachmentCount ?? 0) > config.uploads.maxPerMessage) {
					return verdict(config.uploads, 'uploads', `${message.attachmentCount} fichiers dans un message (max ${config.uploads.maxPerMessage})`);
				}
				const files = entries.filter(e => at - e.at < config.uploads.perSeconds * 1000).reduce((sum, e) => sum + e.files, 0);
				if (files > config.uploads.maxFiles) {
					return verdict(config.uploads, 'uploads', `${files} fichiers en ${config.uploads.perSeconds} s (max ${config.uploads.maxFiles})`);
				}
			}

			if (config.spam.enabled) {
				if ((message.mentionCount ?? 0) > config.spam.maxMentions) {
					return verdict(config.spam, 'mentions', `${message.mentionCount} mentions dans un message (max ${config.spam.maxMentions})`);
				}
				const burst = entries.filter(e => at - e.at < config.spam.perSeconds * 1000).length;
				if (burst > config.spam.maxMessages) {
					return verdict(config.spam, 'spam', `${burst} messages en ${config.spam.perSeconds} s (max ${config.spam.maxMessages})`);
				}
				const current = entries.at(-1).content;
				if (current) {
					const duplicates = entries.filter(e => e.content === current && at - e.at < config.spam.duplicateSeconds * 1000).length;
					if (duplicates > config.spam.maxDuplicates) {
						return verdict(config.spam, 'duplicates', `${duplicates} messages identiques en ${config.spam.duplicateSeconds} s (max ${config.spam.maxDuplicates})`);
					}
				}
			}
			return null;
		},

		// After a sanction, start from a clean slate for that member
		reset(guildId, userId) {
			history.delete(`${guildId}:${userId}`);
		},
	};
}
