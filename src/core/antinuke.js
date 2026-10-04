import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('antinuke.view', { label: 'Voir l’anti-nuke et ses incidents', category: 'Anti-nuke' });
definePermission('antinuke.manage', { label: 'Configurer l’anti-nuke, rendre les rôles d’un compte en quarantaine', category: 'Anti-nuke' });

const SNOWFLAKE = /^\d{17,20}$/;
const SETTINGS_KEY = 'antinuke.config';

// Destructive actions watched in the Discord audit log, with their default limit (count within the window)
export const ANTINUKE_ACTIONS = {
	channel_delete: { label: 'Suppression de salons', limit: 3, windowSeconds: 60 },
	channel_create: { label: 'Création de salons', limit: 6, windowSeconds: 60 },
	role_delete: { label: 'Suppression de rôles', limit: 3, windowSeconds: 60 },
	role_create: { label: 'Création de rôles', limit: 6, windowSeconds: 60 },
	member_ban: { label: 'Bannissements', limit: 5, windowSeconds: 60 },
	member_kick: { label: 'Expulsions', limit: 5, windowSeconds: 60 },
	member_prune: { label: 'Purges de membres inactifs', limit: 1, windowSeconds: 600 },
	dangerous_role: { label: 'Permissions dangereuses données (rôle attribué ou modifié)', limit: 3, windowSeconds: 120 },
	webhook_create: { label: 'Création de webhooks', limit: 3, windowSeconds: 60 },
	emoji_delete: { label: 'Suppression d’émojis ou d’autocollants', limit: 5, windowSeconds: 60 },
	guild_update: { label: 'Changement du nom ou de l’URL du serveur', limit: 2, windowSeconds: 600 },
	bot_add: { label: 'Bots ajoutés', limit: 2, windowSeconds: 600 },
};

// Discord permission bits that let an account wreck a server
const DANGEROUS_BITS = {
	KickMembers: 1n << 1n,
	BanMembers: 1n << 2n,
	Administrator: 1n << 3n,
	ManageChannels: 1n << 4n,
	ManageGuild: 1n << 5n,
	ManageRoles: 1n << 28n,
	ManageWebhooks: 1n << 29n,
};
const DANGEROUS_MASK = Object.values(DANGEROUS_BITS).reduce((a, b) => a | b, 0n);

function bits(value) {
	try {
		return BigInt(value ?? 0);
	}
	catch {
		return 0n;
	}
}

// A permission bitfield (string, number or bigint) holding at least one dangerous permission
export function hasDangerousPermissions(permissions) {
	return (bits(permissions) & DANGEROUS_MASK) !== 0n;
}

// A role edit that adds a dangerous permission
export function addsDangerousPermissions(before, after) {
	return (bits(after) & ~bits(before) & DANGEROUS_MASK) !== 0n;
}

const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);

export function normalizeAntinuke(input = {}) {
	const actions = {};
	for (const [key, defaults] of Object.entries(ANTINUKE_ACTIONS)) {
		const given = input.actions?.[key] ?? {};
		actions[key] = {
			enabled: given.enabled !== false,
			limit: int(given.limit, 1, 100, defaults.limit),
			windowSeconds: int(given.windowSeconds, 5, 86_400, defaults.windowSeconds),
		};
	}
	const ids = (list, max) => [...new Set((Array.isArray(list) ? list : []).map(String).filter(id => SNOWFLAKE.test(id)))].slice(0, max);
	return {
		enabled: Boolean(input.enabled),
		actions,
		removeAllRoles: Boolean(input.removeAllRoles),
		timeoutMinutes: int(input.timeoutMinutes, 0, 40_320, 0),
		kickBots: input.kickBots !== false,
		dmOwner: input.dmOwner !== false,
		whitelistUserIds: ids(input.whitelistUserIds, 50),
		whitelistRankIds: [...new Set((Array.isArray(input.whitelistRankIds) ? input.whitelistRankIds : []).filter(id => Number.isInteger(id) && id > 0))].slice(0, 50),
	};
}

// Counts destructive actions per author across every network server and quarantines whoever goes over a limit:
// roles with dangerous permissions (or all of them) taken away everywhere, kept to be given back in one click.
export function createAntinuke({ db, network, ranks, audit, executor, settings, logs, ownerId = null, logger = console, now = Date.now }) {
	logs.registerCategory('antinuke', 'Anti-nuke');

	const q = {
		insert: db.prepare(`
			INSERT INTO antinuke_incidents (user_id, guild_id, trigger_type, actions, removed_roles, failures, timed_out, status, created_at)
			VALUES (@userId, @guildId, @trigger, @actions, '{}', '[]', 0, 'open', @at)
		`),
		finish: db.prepare('UPDATE antinuke_incidents SET removed_roles = ?, failures = ?, timed_out = ? WHERE id = ?'),
		actions: db.prepare('UPDATE antinuke_incidents SET actions = ? WHERE id = ?'),
		get: db.prepare('SELECT * FROM antinuke_incidents WHERE id = ?'),
		open: db.prepare('SELECT * FROM antinuke_incidents WHERE user_id = ? AND status = \'open\' ORDER BY id DESC LIMIT 1'),
		list: db.prepare('SELECT * FROM antinuke_incidents ORDER BY id DESC LIMIT ?'),
		resolve: db.prepare('UPDATE antinuke_incidents SET status = ?, resolved_at = ?, resolved_by = ?, failures = ? WHERE id = ?'),
	};

	// userId -> [{ type, guildId, targetId, targetName, at }] of the recent actions (every server mixed)
	const recent = new Map();
	let cache = null;

	function config() {
		cache ??= normalizeAntinuke(settings.get(SETTINGS_KEY, {}));
		return cache;
	}

	function toIncident(row) {
		return {
			id: row.id,
			userId: row.user_id,
			guildId: row.guild_id,
			trigger: row.trigger_type,
			actions: JSON.parse(row.actions),
			removedRoles: JSON.parse(row.removed_roles),
			failures: JSON.parse(row.failures),
			timedOut: row.timed_out === 1,
			status: row.status,
			createdAt: row.created_at,
			resolvedAt: row.resolved_at,
			resolvedBy: row.resolved_by,
		};
	}

	function requireManage(actor) {
		if (!actor.can('antinuke.manage')) throw new ForbiddenError('Permission manquante : antinuke.manage');
	}

	async function isExempt(userId) {
		const cfg = config();
		if (userId === ownerId || userId === executor.botUserId?.()) return true;
		if (cfg.whitelistUserIds.includes(userId)) return true;
		const principal = await ranks.resolve(userId).catch(() => null);
		if (!principal) return false;
		return principal.isOwner || principal.ranks.some(r => cfg.whitelistRankIds.includes(r.id));
	}

	// Actions of this user still inside the window of their type
	function windowOf(userId, type, windowSeconds) {
		const maxWindow = Math.max(...Object.values(config().actions).map(a => a.windowSeconds)) * 1000;
		const list = (recent.get(userId) ?? []).filter(a => now() - a.at <= maxWindow);
		recent.set(userId, list);
		return list.filter(a => a.type === type && now() - a.at <= windowSeconds * 1000);
	}

	const label = type => ANTINUKE_ACTIONS[type]?.label ?? type;

	function summary(actions) {
		const counts = {};
		for (const a of actions) counts[a.type] = (counts[a.type] ?? 0) + 1;
		return Object.entries(counts).map(([type, n]) => `${label(type)} × ${n}`).join('\n');
	}

	// Takes the roles away on every network server; returns { removed: { guildId: [roleId] }, failures, timedOut }
	async function strip(userId, reason) {
		const cfg = config();
		const removed = {};
		const failures = [];
		let timedOut = false;
		for (const guildId of network.activeIds()) {
			let memberRoleIds;
			try {
				memberRoleIds = await executor.getMemberRoleIds(guildId, userId);
			}
			catch (error) {
				failures.push({ guildId, roleId: null, name: null, reason: error.message });
				continue;
			}
			if (!memberRoleIds) continue;
			const roles = await executor.listRoles(guildId).catch(() => []);
			const targets = roles.filter(r => memberRoleIds.includes(r.id) && (cfg.removeAllRoles || hasDangerousPermissions(r.permissions)));
			for (const role of targets) {
				if (role.editable === false) {
					failures.push({ guildId, roleId: role.id, name: role.name, reason: 'Rôle au-dessus de celui du bot' });
					continue;
				}
				try {
					const result = await executor.removeRole(guildId, userId, role.id, reason);
					if (result === 'not_member') continue;
					(removed[guildId] ??= []).push(role.id);
				}
				catch (error) {
					failures.push({ guildId, roleId: role.id, name: role.name, reason: error.message });
				}
			}
			if (cfg.timeoutMinutes > 0) {
				try {
					if (await executor.timeout(guildId, userId, cfg.timeoutMinutes * 60_000, reason) !== 'not_member') timedOut = true;
				}
				catch (error) {
					failures.push({ guildId, roleId: null, name: 'Timeout', reason: error.message });
				}
			}
		}
		return { removed, failures, timedOut };
	}

	async function alert(incident) {
		const removedCount = Object.values(incident.removedRoles).reduce((n, list) => n + list.length, 0);
		const guildName = id => network.find(id)?.name ?? id;
		const message = {
			title: '☢️ Anti-nuke : compte mis en quarantaine',
			description: `<@${incident.userId}> a dépassé la limite « ${label(incident.trigger)} ». Ses rôles dangereux ont été retirés sur le réseau. Rends-les depuis le panel (page Anti-nuke) si c’était légitime.`,
			fields: [
				{ name: 'Actions comptées', value: summary(incident.actions) || '—' },
				{ name: 'Rôles retirés', value: removedCount ? Object.entries(incident.removedRoles).map(([g, list]) => `${guildName(g)} : ${list.map(id => `<@&${id}>`).join(' ')}`).join('\n') : 'aucun', inline: false },
				...(incident.failures.length ? [{ name: 'Échecs', value: incident.failures.slice(0, 10).map(f => `${guildName(f.guildId)} · ${f.name ?? 'membre'} : ${f.reason}`).join('\n') }] : []),
				...(incident.timedOut ? [{ name: 'Timeout', value: `${config().timeoutMinutes} min`, inline: true }] : []),
				{ name: 'Incident', value: `#${incident.id}`, inline: true },
			],
			color: 'danger',
			authorId: incident.userId,
			thumbnailUserId: incident.userId,
		};
		logs.log(incident.guildId, 'antinuke', message, 'quarantine');
		if (config().dmOwner && ownerId && ownerId !== incident.userId) {
			const text = [
				`☢️ **Anti-nuke** : <@${incident.userId}> (${incident.userId}) a été mis en quarantaine (incident #${incident.id}).`,
				`Limite dépassée : ${label(incident.trigger)}.`,
				`Rôles retirés : ${removedCount}${incident.failures.length ? ` · ${incident.failures.length} échec(s)` : ''}.`,
				'Pour rendre ses rôles : panel > Anti-nuke.',
			].join('\n');
			await executor.sendDM(ownerId, text).catch(error => logger.warn('Anti-nuke DM to the owner failed:', error.message));
		}
	}

	async function quarantine(userId, guildId, trigger, actions) {
		// Synchronous claim: a burst of audit entries must not start two quarantines
		const { lastInsertRowid } = q.insert.run({ userId, guildId, trigger, actions: JSON.stringify(actions), at: now() });
		const id = Number(lastInsertRowid);
		recent.delete(userId);
		const reason = `Anti-nuke : limite « ${label(trigger)} » dépassée (incident #${id})`;
		const { removed, failures, timedOut } = await strip(userId, reason);
		q.finish.run(JSON.stringify(removed), JSON.stringify(failures), timedOut ? 1 : 0, id);
		const incident = toIncident(q.get.get(id));
		audit.record({
			actorId: 'antinuke', source: 'system', action: 'antinuke.quarantine', guildId, target: userId,
			details: { trigger: label(trigger), roles: Object.values(removed).flat().length, failures: failures.length },
		});
		await alert(incident);
		return incident;
	}

	const service = {
		actions: ANTINUKE_ACTIONS,
		get: config,
		isExempt,

		save(actor, input) {
			requireManage(actor);
			const next = normalizeAntinuke(input);
			const known = new Set(ranks.list().map(r => r.id));
			next.whitelistRankIds = next.whitelistRankIds.filter(id => known.has(id));
			settings.set(SETTINGS_KEY, next);
			cache = null;
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'antinuke.config', target: 'antinuke', details: { enabled: next.enabled } });
			return config();
		},

		// One destructive action seen in the audit log of a network server.
		// Returns { counted, exempt, incident } (incident: the quarantine it triggered, if any)
		async record(guildId, { type, executorId, targetId = null, targetName = null }) {
			const cfg = config();
			const rule = cfg.actions[type];
			if (!cfg.enabled || !rule || !executorId || network.find(guildId)?.status !== 'active') return { counted: false };
			if (await isExempt(executorId)) return { counted: false, exempt: true };

			const action = { type, guildId, targetId, targetName, at: now() };

			// A bot added by someone who is not trusted can be thrown out at once
			if (type === 'bot_add' && cfg.kickBots && targetId) {
				try {
					await executor.kick(guildId, targetId, 'Anti-nuke : bot ajouté par un compte non autorisé');
					audit.record({ actorId: 'antinuke', source: 'system', action: 'antinuke.bot_kick', guildId, target: targetId, details: { bot: targetName ?? targetId, addedBy: `<@${executorId}>` } });
				}
				catch (error) {
					logger.warn(`Anti-nuke kick of bot ${targetId} on ${guildId} failed:`, error.message);
				}
			}

			// Already in quarantine: the incident keeps track, nothing is taken twice
			const open = q.open.get(executorId);
			if (open) {
				const actions = [...JSON.parse(open.actions), action].slice(-100);
				q.actions.run(JSON.stringify(actions), open.id);
				return { counted: true, incident: null };
			}
			if (!rule.enabled) return { counted: false };

			const list = recent.get(executorId) ?? [];
			list.push(action);
			recent.set(executorId, list);
			const inWindow = windowOf(executorId, type, rule.windowSeconds);
			if (inWindow.length < rule.limit) return { counted: true, incident: null };
			return { counted: true, incident: await quarantine(executorId, guildId, type, recent.get(executorId) ?? inWindow) };
		},

		// Counters still running (for the panel): [{ userId, actions: { type: count } }]
		live() {
			const out = [];
			for (const [userId, list] of recent) {
				const counts = {};
				for (const a of list) {
					const rule = config().actions[a.type];
					if (rule && now() - a.at <= rule.windowSeconds * 1000) counts[a.type] = (counts[a.type] ?? 0) + 1;
				}
				if (Object.keys(counts).length) out.push({ userId, actions: counts });
			}
			return out;
		},

		incidents(limit = 50) {
			return q.list.all(limit).map(toIncident);
		},

		incident(id) {
			const row = q.get.get(id);
			if (!row) throw new NotFoundError('Incident introuvable.');
			return toIncident(row);
		},

		// "Rendre les rôles": everything taken by the quarantine goes back (and the timeout is lifted)
		async restore(actor, id) {
			requireManage(actor);
			const incident = service.incident(id);
			if (incident.status !== 'open') throw new ValidationError('Cet incident est déjà clos.');
			const failures = [];
			let given = 0;
			const reason = `Anti-nuke : rôles rendus par ${actor.id} (incident #${id})`;
			for (const [guildId, roleIds] of Object.entries(incident.removedRoles)) {
				for (const roleId of roleIds) {
					try {
						const result = await executor.addRole(guildId, incident.userId, roleId, reason);
						if (result === 'not_member') failures.push({ guildId, roleId, name: null, reason: 'N’est plus sur le serveur' });
						else given++;
					}
					catch (error) {
						failures.push({ guildId, roleId, name: null, reason: error.message });
					}
				}
			}
			if (incident.timedOut) {
				for (const guildId of network.activeIds()) await executor.timeout(guildId, incident.userId, null, reason).catch(() => undefined);
			}
			q.resolve.run('restored', now(), actor.id, JSON.stringify([...incident.failures, ...failures]), id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'antinuke.restore', guildId: incident.guildId, target: incident.userId, details: { incident: id, roles: given, failures: failures.length } });
			return { ...service.incident(id), given, restoreFailures: failures };
		},

		// Closes the incident without giving anything back
		dismiss(actor, id) {
			requireManage(actor);
			const incident = service.incident(id);
			if (incident.status !== 'open') throw new ValidationError('Cet incident est déjà clos.');
			q.resolve.run('dismissed', now(), actor.id, JSON.stringify(incident.failures), id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'antinuke.dismiss', guildId: incident.guildId, target: incident.userId, details: { incident: id } });
			return service.incident(id);
		},
	};
	return service;
}
