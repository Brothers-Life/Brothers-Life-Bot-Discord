import { definePermission } from '../permissions.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { createAutomodEngine, normalizeConfig, DEFAULT_CONFIG } from './engine.js';
import { extractInvites } from './scam.js';

definePermission('automod.view', { label: 'Voir la configuration de l’automod', category: 'Automod' });
definePermission('automod.manage', { label: 'Configurer l’automod', category: 'Automod' });
definePermission('automod.bypass', { label: 'Ignoré par l’automod', category: 'Automod' });

export const NETWORK = '*';
const COOLDOWN_MS = 10_000;
const INVITE_CACHE_MS = 3600_000;

// Acts as the author of automatic sanctions
const AUTOMOD = Object.freeze({ id: 'automod', source: 'automod', isOwner: true, level: Infinity, permissions: [], ranks: [], can: () => true });

export function createAutomod({ db, network, sanctions, ranks, audit, executor, logs, logger = console, now = Date.now }) {
	logs.registerCategory('automod', 'Automod (spam, arnaques, envois massifs)');
	const engine = createAutomodEngine({ now });
	const lastAction = new Map();
	// invite code -> { guildId, at }
	const inviteCache = new Map();

	const q = {
		get: db.prepare('SELECT * FROM automod_config WHERE guild_id = ?'),
		upsert: db.prepare(`
			INSERT INTO automod_config (guild_id, config, updated_at, updated_by) VALUES (?, ?, ?, ?)
			ON CONFLICT(guild_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by
		`),
		delete: db.prepare('DELETE FROM automod_config WHERE guild_id = ?'),
	};
	const cache = new Map();

	function raw(guildId) {
		if (!cache.has(guildId)) {
			const row = q.get.get(guildId);
			cache.set(guildId, row ? { config: normalizeConfig(JSON.parse(row.config)), updatedAt: row.updated_at, updatedBy: row.updated_by } : null);
		}
		return cache.get(guildId);
	}

	function effective(guildId) {
		return raw(guildId)?.config ?? raw(NETWORK)?.config ?? normalizeConfig();
	}

	async function inviteGuild(code) {
		const cached = inviteCache.get(code);
		if (cached && now() - cached.at < INVITE_CACHE_MS) return cached.guildId;
		const guildId = await executor.resolveInvite(code).catch(() => null);
		inviteCache.set(code, { guildId, at: now() });
		return guildId;
	}

	// Invite codes of the message that lead to a server of the network
	async function networkInvites(content) {
		const codes = extractInvites(content);
		const allowed = [];
		for (const code of codes) {
			const guildId = await inviteGuild(code);
			if (guildId && network.find(guildId)?.status === 'active') allowed.push(code);
		}
		return allowed;
	}

	function requireManage(actor) {
		if (!actor.can('automod.manage')) throw new ForbiddenError('Permission manquante : automod.manage');
	}

	async function applyAction(verdict, facts) {
		const reason = `Automod : ${verdict.reason}`;
		const base = { userId: facts.userId, reason, originGuildId: facts.guildId };
		switch (verdict.action) {
		case 'warn': return sanctions.create(AUTOMOD, { ...base, type: 'warn' });
		case 'timeout': return sanctions.create(AUTOMOD, { ...base, type: 'timeout', scope: 'local', durationMs: (verdict.timeoutMinutes ?? 10) * 60_000 });
		case 'kick': return sanctions.create(AUTOMOD, { ...base, type: 'kick', scope: 'local' });
		case 'ban': return sanctions.create(AUTOMOD, { ...base, type: 'ban', scope: 'local', deleteMessageSeconds: 3600 });
		case 'network_ban': return sanctions.create(AUTOMOD, { ...base, type: 'ban', scope: 'network', deleteMessageSeconds: 3600 });
		default: return null;
		}
	}

	return {
		defaults: () => structuredClone(DEFAULT_CONFIG),
		getConfig: effective,

		describe() {
			const guilds = network.list().filter(g => g.status === 'active');
			return {
				network: raw(NETWORK)?.config ?? normalizeConfig(),
				guilds: guilds.map(g => ({ id: g.id, name: g.name, custom: Boolean(raw(g.id)), config: effective(g.id) })),
			};
		},

		setConfig(actor, guildId, input) {
			requireManage(actor);
			if (guildId !== NETWORK && network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const config = normalizeConfig(input);
			if (guildId === NETWORK) {
				config.exemptRoles = [];
				config.exemptChannels = [];
			}
			q.upsert.run(guildId, JSON.stringify(config), now(), actor.id);
			cache.delete(guildId);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'automod.config', guildId: guildId === NETWORK ? null : guildId, target: guildId === NETWORK ? 'réseau' : guildId });
			return config;
		},

		// The server goes back to the network settings
		resetGuild(actor, guildId) {
			requireManage(actor);
			q.delete.run(guildId);
			cache.delete(guildId);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'automod.reset', guildId, target: guildId });
		},

		// facts: { guildId, channelId, messageId, userId, userName, content, mentionCount, attachmentCount, hasEveryone, roleIds, isBot }
		async handleMessage(facts, { edited = false } = {}) {
			if (facts.isBot || network.find(facts.guildId)?.status !== 'active') return null;
			const config = effective(facts.guildId);
			if (!config.enabled) return null;
			if (config.exemptChannels.includes(facts.channelId)) return null;
			if (facts.roleIds?.some(r => config.exemptRoles.includes(r))) return null;

			if (config.invites.enabled && config.invites.allowNetwork && extractInvites(facts.content ?? '').length) {
				facts = { ...facts, allowedInvites: await networkInvites(facts.content) };
			}
			const verdict = engine.evaluate(config, facts, { edited });
			if (!verdict) return null;
			if ((await ranks.resolve(facts.userId)).can('automod.bypass')) return null;

			await executor.deleteMessage(facts.channelId, facts.messageId).catch(() => null);

			// One sanction per member every 10 s: a burst of messages must not become a burst of sanctions
			const key = `${facts.guildId}:${facts.userId}`;
			if (now() - (lastAction.get(key) ?? 0) < COOLDOWN_MS) return { ...verdict, sanction: null, throttled: true };
			if (lastAction.size > 1000) {
				for (const [k, at] of lastAction) if (now() - at >= COOLDOWN_MS) lastAction.delete(k);
			}
			lastAction.set(key, now());
			engine.reset(facts.guildId, facts.userId);

			let sanction = null;
			try {
				sanction = await applyAction(verdict, facts);
			}
			catch (error) {
				logger.warn(`Automod could not sanction ${facts.userId}:`, error.message);
			}

			audit.record({
				actorId: 'automod',
				source: 'system',
				action: 'automod.trigger',
				guildId: facts.guildId,
				target: facts.userId,
				details: {
					user: facts.userName ?? null,
					rule: verdict.rule,
					reason: verdict.reason,
					action: verdict.action,
					channel: `<#${facts.channelId}>`,
					content: (facts.content ?? '').slice(0, 300),
					...(sanction ? { sanctionId: sanction.id } : {}),
				},
			});
			return { ...verdict, sanction };
		},
	};
}
