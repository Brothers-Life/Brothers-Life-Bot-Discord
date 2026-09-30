import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { formatDuration } from './duration.js';

definePermission('commands.clear', { label: '/clear : supprimer des messages en masse', category: 'Commandes' });
definePermission('commands.lock', { label: '/lock, /unlock : verrouiller un salon', category: 'Commandes' });
definePermission('commands.lockdown', { label: '/lockdown : verrouiller tout le serveur', category: 'Commandes' });
definePermission('commands.slowmode', { label: '/slowmode : régler le mode lent', category: 'Commandes' });
definePermission('commands.roles', { label: '/role : donner ou retirer des rôles (aussi temporaires)', category: 'Commandes' });
definePermission('commands.nick', { label: '/nick : changer le pseudo d’un membre', category: 'Commandes' });
definePermission('commands.voice', { label: '/voc : déconnecter, déplacer, rendre muet en vocal', category: 'Commandes' });
definePermission('commands.userinfo', { label: '/userinfo : fiche d’un membre', category: 'Commandes' });

const MAX_SLOWMODE = 21_600;
const MAX_TEMP_ROLE_MS = 365 * 86_400_000;

// Moderation commands (and their panel counterparts) that are not sanctions
export function createModeration({ db, network, ranks, audit, executor, settings, members, logs, logger = console, now = Date.now }) {
	logs.registerCategory('moderation', 'Modération (clear, verrouillages, mode lent, vocal)');
	logs.registerCategory('temproles', 'Rôles temporaires (donnés, prolongés, expirés)');

	const q = {
		insertTemp: db.prepare(`
			INSERT INTO temp_roles (guild_id, user_id, role_id, role_name, expires_at, reason, created_by, created_at)
			VALUES (@guildId, @userId, @roleId, @roleName, @expiresAt, @reason, @createdBy, @createdAt)
		`),
		activeTempFor: db.prepare('SELECT * FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ? AND removed_at IS NULL'),
		temp: db.prepare('SELECT * FROM temp_roles WHERE id = ?'),
		extend: db.prepare('UPDATE temp_roles SET expires_at = ? WHERE id = ? AND removed_at IS NULL'),
		close: db.prepare('UPDATE temp_roles SET removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL'),
		closeFor: db.prepare('UPDATE temp_roles SET removed_at = ?, removed_by = ? WHERE guild_id = ? AND user_id = ? AND role_id = ? AND removed_at IS NULL'),
		due: db.prepare('SELECT * FROM temp_roles WHERE removed_at IS NULL AND expires_at <= ?'),
	};

	const toTemp = row => row && ({
		id: row.id,
		guildId: row.guild_id,
		userId: row.user_id,
		roleId: row.role_id,
		roleName: row.role_name,
		expiresAt: row.expires_at,
		reason: row.reason,
		createdBy: row.created_by,
		createdAt: row.created_at,
		removedAt: row.removed_at,
		removedBy: row.removed_by,
	});

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function requireGuild(guildId) {
		if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
	}

	function record(actor, action, guildId, target, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId, target, details });
	}

	// From Discord, a moderator can't hand out a role above their own highest role (the owner can)
	async function checkHierarchy(actor, guildId, role) {
		if (actor.isOwner || actor.source !== 'bot') return;
		const top = await executor.getMemberTopRolePosition(guildId, actor.id);
		if (top !== null && role.position >= top) throw new ForbiddenError(`Le rôle ${role.name} est au-dessus (ou au niveau) de ton plus haut rôle.`);
	}

	const service = {
		async clear(actor, { guildId, channelId, count, userId = null, contains = null, botsOnly = false }) {
			need(actor, 'commands.clear');
			requireGuild(guildId);
			if (!Number.isInteger(count) || count < 1 || count > 500) throw new ValidationError('Entre 1 et 500 messages.');
			const deleted = await executor.purgeMessages(channelId, { count, userId, contains: contains?.slice(0, 100) || null, botsOnly });
			record(actor, 'moderation.clear', guildId, channelId, { channel: `<#${channelId}>`, deleted, ...(userId ? { member: `<@${userId}>` } : {}) });
			return deleted;
		},

		async lock(actor, { guildId, channelId, locked, reason = '' }) {
			need(actor, 'commands.lock');
			requireGuild(guildId);
			await executor.setChannelLocked(channelId, locked, `${locked ? 'Verrouillage' : 'Déverrouillage'} par ${actor.id}${reason ? ` : ${reason}` : ''}`);
			record(actor, locked ? 'moderation.lock' : 'moderation.unlock', guildId, channelId, { channel: `<#${channelId}>`, reason: reason || null });
		},

		// Locks every text channel where members can write; remembers them to unlock only those
		async lockdown(actor, guildId, on, reason = '') {
			need(actor, 'commands.lockdown');
			requireGuild(guildId);
			const key = `lockdown.${guildId}`;
			if (on) {
				if (settings.get(key)) throw new ValidationError('Le serveur est déjà verrouillé.');
				const channelIds = await executor.lockGuild(guildId, `Lockdown par ${actor.id}${reason ? ` : ${reason}` : ''}`);
				settings.set(key, { channelIds, at: now(), by: actor.id });
				record(actor, 'moderation.lockdown', guildId, guildId, { channels: channelIds.length, reason: reason || null });
				return channelIds.length;
			}
			const state = settings.get(key);
			if (!state) throw new ValidationError('Le serveur n’est pas verrouillé.');
			await executor.unlockChannels(state.channelIds, `Fin du lockdown par ${actor.id}`);
			settings.set(key, null);
			record(actor, 'moderation.unlockdown', guildId, guildId, { channels: state.channelIds.length });
			return state.channelIds.length;
		},

		isLockedDown: guildId => Boolean(settings.get(`lockdown.${guildId}`)),

		async slowmode(actor, { guildId, channelId, seconds }) {
			need(actor, 'commands.slowmode');
			requireGuild(guildId);
			if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SLOWMODE) throw new ValidationError('Le mode lent va de 0 à 6 heures.');
			await executor.setSlowmode(channelId, seconds, `Mode lent par ${actor.id}`);
			record(actor, 'moderation.slowmode', guildId, channelId, { channel: `<#${channelId}>`, seconds });
		},

		async nick(actor, guildId, userId, nickname) {
			await members.setNickname(actor, guildId, userId, nickname, 'commands.nick');
		},

		async voice(actor, { guildId, userId, action, channelId = null }) {
			need(actor, 'commands.voice');
			await members.assertCanEdit(actor, guildId, userId, 'commands.voice');
			const reason = `Vocal : ${action} par ${actor.id}`;
			let outcome;
			if (action === 'disconnect') outcome = await executor.voiceDisconnect(guildId, userId, reason);
			else if (action === 'move') outcome = await executor.voiceMove(guildId, userId, channelId, reason);
			else if (action === 'mute' || action === 'unmute') outcome = await executor.voiceMute(guildId, userId, action === 'mute', reason);
			else throw new ValidationError('Action vocale inconnue.');
			if (outcome === 'not_in_voice') throw new ValidationError('Cette personne n’est pas en vocal.');
			record(actor, `moderation.voice_${action}`, guildId, userId, { member: `<@${userId}>`, ...(channelId ? { channel: `<#${channelId}>` } : {}) });
		},

		// --- Roles, possibly for a limited time -------------------------------------------------
		async giveRole(actor, { guildId, userId, roleId, durationMs = null, reason = '' }) {
			await members.assertCanEdit(actor, guildId, userId, 'commands.roles');
			const role = await members.assertGivableRole(actor, guildId, roleId);
			await checkHierarchy(actor, guildId, role);
			if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 60_000 || durationMs > MAX_TEMP_ROLE_MS)) {
				throw new ValidationError('Durée d’un rôle temporaire : entre 1 minute et 1 an.');
			}
			const outcome = await executor.addRole(guildId, userId, roleId, `${durationMs ? `Rôle temporaire (${formatDuration(durationMs)})` : 'Rôle'} par ${actor.id}${reason ? ` : ${reason}` : ''}`);
			if (outcome === 'not_member') throw new ValidationError('Cette personne n’est pas sur ce serveur.');
			let temp = null;
			if (durationMs) {
				const existing = q.activeTempFor.get(guildId, userId, roleId);
				if (existing) {
					q.extend.run(now() + durationMs, existing.id);
					temp = toTemp(q.temp.get(existing.id));
				}
				else {
					const id = Number(q.insertTemp.run({ guildId, userId, roleId, roleName: role.name, expiresAt: now() + durationMs, reason: reason || null, createdBy: actor.id, createdAt: now() }).lastInsertRowid);
					temp = toTemp(q.temp.get(id));
				}
			}
			else {
				// Given for good: an earlier temporary grant of the same role no longer expires it
				q.closeFor.run(now(), actor.id, guildId, userId, roleId);
			}
			record(actor, durationMs ? 'temproles.add' : 'members.role_add', guildId, userId, {
				member: `<@${userId}>`, role: role.name, ...(durationMs ? { duration: formatDuration(durationMs) } : {}), reason: reason || null,
			});
			return temp;
		},

		async takeRole(actor, { guildId, userId, roleId, reason = '' }) {
			await members.assertCanEdit(actor, guildId, userId, 'commands.roles');
			const role = await members.assertGivableRole(actor, guildId, roleId);
			await checkHierarchy(actor, guildId, role);
			await executor.removeRole(guildId, userId, roleId, `Retiré par ${actor.id}${reason ? ` : ${reason}` : ''}`);
			q.closeFor.run(now(), actor.id, guildId, userId, roleId);
			record(actor, 'members.role_remove', guildId, userId, { member: `<@${userId}>`, role: role.name, reason: reason || null });
		},

		listTempRoles({ userId, guildId, active = true } = {}) {
			const where = [userId && 'user_id = @userId', guildId && 'guild_id = @guildId', active && 'removed_at IS NULL'].filter(Boolean);
			return db.prepare(`SELECT * FROM temp_roles ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY expires_at LIMIT 500`).all({ userId, guildId }).map(toTemp);
		},

		async extendTempRole(actor, id, durationMs) {
			need(actor, 'commands.roles');
			const temp = toTemp(q.temp.get(id));
			if (!temp || temp.removedAt) throw new NotFoundError('Rôle temporaire introuvable ou déjà retiré.');
			if (!Number.isFinite(durationMs) || durationMs < 60_000 || durationMs > MAX_TEMP_ROLE_MS) throw new ValidationError('Prolongation : entre 1 minute et 1 an.');
			q.extend.run(Math.max(temp.expiresAt, now()) + durationMs, id);
			record(actor, 'temproles.extend', temp.guildId, temp.userId, { member: `<@${temp.userId}>`, role: temp.roleName, duration: formatDuration(durationMs) });
			return toTemp(q.temp.get(id));
		},

		async removeTempRole(actor, id) {
			need(actor, 'commands.roles');
			const temp = toTemp(q.temp.get(id));
			if (!temp || temp.removedAt) throw new NotFoundError('Rôle temporaire introuvable ou déjà retiré.');
			await executor.removeRole(temp.guildId, temp.userId, temp.roleId, `Rôle temporaire retiré par ${actor.id}`);
			q.close.run(now(), actor.id, id);
			record(actor, 'temproles.remove', temp.guildId, temp.userId, { member: `<@${temp.userId}>`, role: temp.roleName });
		},

		// Every 30 s: temporary roles reaching their end
		async expireTempRoles() {
			const due = q.due.all(now()).map(toTemp);
			for (const temp of due) {
				try {
					await executor.removeRole(temp.guildId, temp.userId, temp.roleId, 'Fin du rôle temporaire');
				}
				catch (error) {
					// Deleted role or server gone: nothing left to remove
					logger.warn(`Temporary role #${temp.id} not removed:`, error.message);
				}
				q.close.run(now(), 'system', temp.id);
				audit.record({ actorId: 'system', source: 'system', action: 'temproles.expire', guildId: temp.guildId, target: temp.userId, details: { member: `<@${temp.userId}>`, role: temp.roleName } });
			}
			return due.length;
		},

		// /userinfo: the network profile of someone, as the panel shows it
		async userInfo(actor, userId) {
			need(actor, 'commands.userinfo');
			const profile = await members.lookup(userId);
			return { ...profile, tempRoles: service.listTempRoles({ userId }), principal: await ranks.resolve(userId) };
		},
	};
	return service;
}
