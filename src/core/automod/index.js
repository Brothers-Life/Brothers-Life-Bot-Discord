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
			ON DUPLICATE KEY UPDATE config = VALUES(config), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)
		`),
		delete: db.prepare('DELETE FROM automod_config WHERE guild_id = ?'),
	};
	const cache = new Map();

	async function raw(guildId) {
		if (!cache.has(guildId)) {
			const row = await q.get.get(guildId);
			cache.set(guildId, row ? { config: normalizeConfig(JSON.parse(row.config)), updatedAt: row.updated_at, updatedBy: row.updated_by } : null);
		}
		return cache.get(guildId);
	}

	async function effective(guildId) {
		return (await raw(guildId))?.config ?? (await raw(NETWORK))?.config ?? normalizeConfig();
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
			if (guildId && (await network.find(guildId))?.status === 'active') allowed.push(code);
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
		case 'warn': return await sanctions.create(AUTOMOD, { ...base, type: 'warn' });
		case 'timeout': return await sanctions.create(AUTOMOD, { ...base, type: 'timeout', scope: 'local', durationMs: (verdict.timeoutMinutes ?? 10) * 60_000 });
		case 'kick': return await sanctions.create(AUTOMOD, { ...base, type: 'kick', scope: 'local' });
		case 'ban': return await sanctions.create(AUTOMOD, { ...base, type: 'ban', scope: 'local', deleteMessageSeconds: 3600 });
		case 'network_ban': return await sanctions.create(AUTOMOD, { ...base, type: 'ban', scope: 'network', deleteMessageSeconds: 3600 });
		default: return null;
		}
	}

	return {
		defaults: () => structuredClone(DEFAULT_CONFIG),
		getConfig: effective,

		async describe() {
			const guilds = (await network.list()).filter(g => g.status === 'active');
			return {
				network: (await raw(NETWORK))?.config ?? normalizeConfig(),
				guilds: await Promise.all(guilds.map(async g => ({ id: g.id, name: g.name, custom: Boolean(await raw(g.id)), config: await effective(g.id) }))),
			};
		},

		async setConfig(actor, guildId, input) {
			requireManage(actor);
			if (guildId !== NETWORK && (await network.find(guildId))?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const config = normalizeConfig(input);
			if (guildId === NETWORK) {
				config.exemptRoles = [];
				config.exemptChannels = [];
			}
			await q.upsert.run(guildId, JSON.stringify(config), now(), actor.id);
			cache.delete(guildId);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'automod.config', guildId: guildId === NETWORK ? null : guildId, target: guildId === NETWORK ? 'réseau' : guildId });
			return config;
		},

		// The server goes back to the network settings
		async resetGuild(actor, guildId) {
			requireManage(actor);
			await q.delete.run(guildId);
			cache.delete(guildId);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'automod.reset', guildId, target: guildId });
		},

		// facts: { guildId, channelId, messageId, userId, userName, content, mentionCount, attachmentCount, hasEveryone, roleIds, isBot }
		async handleMessage(facts, { edited = false } = {}) {
			if (facts.isBot || (await network.find(facts.guildId))?.status !== 'active') return null;
			const config = await effective(facts.guildId);
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

			await audit.record({
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
