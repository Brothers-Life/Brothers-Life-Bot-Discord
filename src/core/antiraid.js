import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';
import { accountCreatedAt } from './ticketConfig.js';

definePermission('antiraid.view', { label: 'Voir l’anti-raid', category: 'Anti-raid' });
definePermission('antiraid.manage', { label: 'Configurer l’anti-raid, déclencher ou arrêter un raid (/raid)', category: 'Anti-raid' });

const SNOWFLAKE = /^\d{17,20}$/;
const JOIN_ACTIONS = ['none', 'kick', 'ban', 'network_ban'];
const NEW_ACCOUNT_ACTIONS = ['none', 'kick', 'role'];

// Author of the automatic sanctions
const ANTIRAID = Object.freeze({ id: 'antiraid', source: 'system', isOwner: true, level: Infinity, permissions: [], ranks: [], can: () => true });

const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);

export function normalizeAntiraid(input = {}) {
	const fresh = input.newAccount ?? {};
	return {
		enabled: Boolean(input.enabled),
		joinThreshold: int(input.joinThreshold, 3, 200, 10),
		joinWindowSeconds: int(input.joinWindowSeconds, 5, 600, 30),
		raidMinutes: int(input.raidMinutes, 1, 1440, 15),
		actionOnJoin: JOIN_ACTIONS.includes(input.actionOnJoin) ? input.actionOnJoin : 'kick',
		includeWindow: Boolean(input.includeWindow),
		disableInvites: input.disableInvites !== false,
		raiseVerification: input.raiseVerification !== false,
		alertRoleIds: (Array.isArray(input.alertRoleIds) ? input.alertRoleIds : []).filter(r => SNOWFLAKE.test(r)).slice(0, 10),
		newAccount: {
			enabled: Boolean(fresh.enabled),
			minAgeDays: int(fresh.minAgeDays, 1, 365, 3),
			action: NEW_ACCOUNT_ACTIONS.includes(fresh.action) ? fresh.action : 'kick',
			roleId: SNOWFLAKE.test(fresh.roleId) ? fresh.roleId : null,
		},
	};
}

// Join floods: raid mode (locks + action on every new member), and a permanent filter on new accounts
export function createAntiraid({ db, network, audit, executor, sanctions, logs, logger = console, now = Date.now }) {
	logs.registerCategory('antiraid', 'Anti-raid (raids détectés, comptes récents)');

	const q = {
		get: db.prepare('SELECT * FROM antiraid_config WHERE guild_id = ?'),
		upsert: db.prepare(`
			INSERT INTO antiraid_config (guild_id, config, updated_at, updated_by) VALUES (?, ?, ?, ?)
			ON CONFLICT(guild_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by
		`),
	};
	const cache = new Map();
	// guildId -> [{ userId, at }] of the recent joins
	const joins = new Map();
	// guildId -> { startedAt, until, by, restore, actioned }
	const raids = new Map();

	function configOf(guildId) {
		if (!cache.has(guildId)) {
			const row = q.get.get(guildId);
			cache.set(guildId, normalizeAntiraid(row ? JSON.parse(row.config) : {}));
		}
		return cache.get(guildId);
	}

	function recentJoins(guildId, windowMs) {
		const list = (joins.get(guildId) ?? []).filter(j => now() - j.at <= Math.max(windowMs, 600_000));
		joins.set(guildId, list);
		return list.filter(j => now() - j.at <= windowMs);
	}

	async function alert(guildId, message, pingRoleIds = []) {
		logs.log(guildId, 'antiraid', message);
		const channelId = logs.routes(guildId).find(r => r.category === 'antiraid' && r.enabled)?.channelId;
		if (channelId && pingRoleIds.length) {
			await executor.sendMessage(channelId, { payload: { content: pingRoleIds.map(id => `<@&${id}>`).join(' '), embed: { enabled: false } }, files: [], mentionRoleIds: pingRoleIds })
				.catch(error => logger.warn(`Raid ping on ${guildId} failed:`, error.message));
		}
	}

	async function act(guildId, userId, action, reason) {
		const base = { userId, reason, originGuildId: guildId };
		try {
			if (action === 'kick') await sanctions.create(ANTIRAID, { ...base, type: 'kick', scope: 'local' });
			if (action === 'ban') await sanctions.create(ANTIRAID, { ...base, type: 'ban', scope: 'local', deleteMessageSeconds: 3600 });
			if (action === 'network_ban') await sanctions.create(ANTIRAID, { ...base, type: 'ban', scope: 'network', deleteMessageSeconds: 3600 });
		}
		catch (error) {
			logger.warn(`Anti-raid ${action} of ${userId} on ${guildId} failed:`, error.message);
		}
	}

	async function startRaid(guildId, by, config) {
		const restore = await executor.setRaidLocks(guildId, { disableInvites: config.disableInvites, raiseVerification: config.raiseVerification })
			.catch((error) => {
				logger.warn(`Raid locks on ${guildId} failed:`, error.message);
				return null;
			});
		const raid = { startedAt: now(), until: now() + config.raidMinutes * 60_000, by, restore, actioned: 0 };
		raids.set(guildId, raid);
		audit.record({ actorId: by === 'auto' ? 'antiraid' : by, source: by === 'auto' ? 'system' : 'panel', action: 'antiraid.start', guildId, target: guildId, details: { trigger: by === 'auto' ? 'automatique' : 'manuel' } });
		await alert(guildId, {
			title: '🚨 Raid en cours',
			description: by === 'auto'
				? `${config.joinThreshold} arrivées ou plus en ${config.joinWindowSeconds} s. Mode raid pendant ${config.raidMinutes} min (prolongé tant que ça continue).`
				: `Mode raid déclenché par <@${by}> pour ${config.raidMinutes} min.`,
			fields: [
				{ name: 'Nouveaux arrivants', value: { none: 'rien (alerte seulement)', kick: 'expulsés', ban: 'bannis de ce serveur', network_ban: 'bannis du réseau' }[config.actionOnJoin], inline: true },
				{ name: 'Verrouillages', value: [config.disableInvites && 'invitations suspendues', config.raiseVerification && 'vérification maximale'].filter(Boolean).join(', ') || 'aucun', inline: true },
			],
			color: 'danger',
		}, config.alertRoleIds);
		return raid;
	}

	async function endRaid(guildId, by) {
		const raid = raids.get(guildId);
		if (!raid) return null;
		raids.delete(guildId);
		if (raid.restore) await executor.restoreRaidLocks(guildId, raid.restore).catch(error => logger.warn(`Raid unlock on ${guildId} failed:`, error.message));
		audit.record({ actorId: by === 'auto' ? 'antiraid' : by, source: by === 'auto' ? 'system' : 'panel', action: 'antiraid.end', guildId, target: guildId, details: { actioned: raid.actioned, minutes: Math.round((now() - raid.startedAt) / 60_000) } });
		await alert(guildId, { title: '✅ Fin du mode raid', description: `${raid.actioned} compte(s) traité(s). Invitations et vérification remises comme avant.`, color: 'success' });
		return raid;
	}

	const service = {
		get: configOf,

		save(actor, guildId, input) {
			if (!actor.can('antiraid.manage')) throw new ForbiddenError('Permission manquante : antiraid.manage');
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const config = normalizeAntiraid(input);
			if (config.newAccount.enabled && config.newAccount.action === 'role' && !config.newAccount.roleId) throw new ValidationError('Choisis le rôle de quarantaine des comptes récents.');
			q.upsert.run(guildId, JSON.stringify(config), now(), actor.id);
			cache.delete(guildId);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'antiraid.config', guildId, target: guildId });
			return configOf(guildId);
		},

		state(guildId) {
			const config = configOf(guildId);
			const raid = raids.get(guildId);
			return {
				raid: raid ? { startedAt: raid.startedAt, until: raid.until, by: raid.by, actioned: raid.actioned } : null,
				recentJoins: recentJoins(guildId, config.joinWindowSeconds * 1000).length,
				lastMinute: recentJoins(guildId, 60_000).length,
			};
		},

		// A member joins: returns { blocked } so the welcome is skipped for removed accounts
		async handleJoin(guildId, member) {
			if (network.find(guildId)?.status !== 'active' || member.bot) return { blocked: false };
			const config = configOf(guildId);
			if (!config.enabled) return { blocked: false };

			const list = joins.get(guildId) ?? [];
			list.push({ userId: member.id, at: now() });
			joins.set(guildId, list);

			let raid = raids.get(guildId);
			const window = recentJoins(guildId, config.joinWindowSeconds * 1000);
			if (!raid && window.length >= config.joinThreshold) {
				raid = await startRaid(guildId, 'auto', config);
				if (config.includeWindow && config.actionOnJoin !== 'none') {
					for (const join of window.filter(j => j.userId !== member.id)) {
						await act(guildId, join.userId, config.actionOnJoin, 'Anti-raid : arrivé pendant le raid');
						raid.actioned++;
					}
				}
			}
			if (raid) {
				raid.until = Math.max(raid.until, now() + config.raidMinutes * 60_000);
				if (config.actionOnJoin !== 'none') {
					await act(guildId, member.id, config.actionOnJoin, 'Anti-raid : arrivé pendant le raid');
					raid.actioned++;
					return { blocked: true };
				}
				return { blocked: false };
			}

			const { newAccount } = config;
			const created = member.createdAt ?? accountCreatedAt(member.id);
			if (newAccount.enabled && now() - created < newAccount.minAgeDays * 86_400_000) {
				const days = Math.floor((now() - created) / 86_400_000);
				const reason = `Anti-raid : compte créé il y a ${days} jour(s), minimum ${newAccount.minAgeDays}`;
				if (newAccount.action === 'kick') {
					await act(guildId, member.id, 'kick', reason);
				}
				else if (newAccount.action === 'role') {
					await executor.addRole(guildId, member.id, newAccount.roleId, reason).catch(error => logger.warn('Quarantine role failed:', error.message));
				}
				logs.log(guildId, 'antiraid', {
					title: 'Compte récent',
					description: `<@${member.id}> (${member.username ?? member.id}) · compte de ${days} jour(s)`,
					fields: [{ name: 'Action', value: { none: 'aucune (alerte)', kick: 'expulsé', role: `rôle <@&${newAccount.roleId}>` }[newAccount.action], inline: true }],
					color: 'warning',
				});
				return { blocked: newAccount.action === 'kick' };
			}
			return { blocked: false };
		},

		async setRaid(actor, guildId, on) {
			if (!actor.can('antiraid.manage')) throw new ForbiddenError('Permission manquante : antiraid.manage');
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			if (on) {
				if (raids.has(guildId)) throw new ValidationError('Le mode raid est déjà actif.');
				return startRaid(guildId, actor.id, configOf(guildId));
			}
			if (!raids.has(guildId)) throw new ValidationError('Aucun raid en cours.');
			return endRaid(guildId, actor.id);
		},

		// Every 30 s: raids that are over
		async tick() {
			for (const [guildId, raid] of raids) {
				if (raid.until <= now()) await endRaid(guildId, 'auto');
			}
		},
	};
	return service;
}
