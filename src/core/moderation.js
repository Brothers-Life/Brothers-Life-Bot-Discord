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
definePermission('commands.userinfo', { label: '/fiche : fiche d’un membre', category: 'Commandes' });

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

	// Servers whose lockdown is in progress
	const lockingDown = new Set();

	// Runs fn after the previous call with the same key has finished (in this process)
	const queues = new Map();
	function serialized(key, fn) {
		const run = (queues.get(key) ?? Promise.resolve()).then(() => fn());
		const tail = run.catch(() => undefined);
		queues.set(key, tail);
		tail.then(() => {
			if (queues.get(key) === tail) queues.delete(key);
		});
		return run;
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	async function requireGuild(guildId) {
		if ((await network.find(guildId))?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
	}

	async function record(actor, action, guildId, target, details = {}) {
		await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId, target, details });
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
			await requireGuild(guildId);
			if (!Number.isInteger(count) || count < 1 || count > 500) throw new ValidationError('Entre 1 et 500 messages.');
			const deleted = await executor.purgeMessages(channelId, { count, userId, contains: contains?.slice(0, 100) || null, botsOnly });
			await record(actor, 'moderation.clear', guildId, channelId, { channel: `<#${channelId}>`, deleted, ...(userId ? { member: `<@${userId}>` } : {}) });
			return deleted;
		},

		async lock(actor, { guildId, channelId, locked, reason = '' }) {
			need(actor, 'commands.lock');
			await requireGuild(guildId);
			await executor.setChannelLocked(channelId, locked, `${locked ? 'Verrouillage' : 'Déverrouillage'} par ${actor.id}${reason ? ` : ${reason}` : ''}`);
			await record(actor, locked ? 'moderation.lock' : 'moderation.unlock', guildId, channelId, { channel: `<#${channelId}>`, reason: reason || null });
		},

		// Locks every text channel where members can write; remembers them to unlock only those
		async lockdown(actor, guildId, on, reason = '') {
			need(actor, 'commands.lockdown');
			await requireGuild(guildId);
			const key = `lockdown.${guildId}`;
			if (on) {
				if (lockingDown.has(guildId)) throw new ValidationError('Le serveur est déjà verrouillé.');
				// A second lockdown during the first one would find nothing left to lock and erase the list to reopen
				// (taken before the settings are read, so two calls at once can't both pass)
				lockingDown.add(guildId);
				let channelIds;
				try {
					if (await settings.get(key)) throw new ValidationError('Le serveur est déjà verrouillé.');
					channelIds = await executor.lockGuild(guildId, `Lockdown par ${actor.id}${reason ? ` : ${reason}` : ''}`);
				}
				finally {
					lockingDown.delete(guildId);
				}
				await settings.set(key, { channelIds, at: now(), by: actor.id });
				await record(actor, 'moderation.lockdown', guildId, guildId, { channels: channelIds.length, reason: reason || null });
				return channelIds.length;
			}
			const state = await settings.get(key);
			if (!state) throw new ValidationError('Le serveur n’est pas verrouillé.');
			await executor.unlockChannels(state.channelIds, `Fin du lockdown par ${actor.id}`);
			await settings.set(key, null);
			await record(actor, 'moderation.unlockdown', guildId, guildId, { channels: state.channelIds.length });
			return state.channelIds.length;
		},

		isLockedDown: async guildId => Boolean(await settings.get(`lockdown.${guildId}`)),

		async slowmode(actor, { guildId, channelId, seconds }) {
			need(actor, 'commands.slowmode');
			await requireGuild(guildId);
			if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SLOWMODE) throw new ValidationError('Le mode lent va de 0 à 6 heures.');
			await executor.setSlowmode(channelId, seconds, `Mode lent par ${actor.id}`);
			await record(actor, 'moderation.slowmode', guildId, channelId, { channel: `<#${channelId}>`, seconds });
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
			await record(actor, `moderation.voice_${action}`, guildId, userId, { member: `<@${userId}>`, ...(channelId ? { channel: `<#${channelId}>` } : {}) });
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
				// One active grant per member and role: two grants at once (double click) must not both insert
				temp = await serialized(`${guildId}:${userId}:${roleId}`, async () => {
					const existing = await q.activeTempFor.get(guildId, userId, roleId);
					if (existing) {
						await q.extend.run(now() + durationMs, existing.id);
						return toTemp(await q.temp.get(existing.id));
					}
					const id = Number((await q.insertTemp.run({ guildId, userId, roleId, roleName: role.name, expiresAt: now() + durationMs, reason: reason || null, createdBy: actor.id, createdAt: now() })).lastInsertRowid);
					return toTemp(await q.temp.get(id));
				});
			}
			else {
				// Given for good: an earlier temporary grant of the same role no longer expires it
				await q.closeFor.run(now(), actor.id, guildId, userId, roleId);
			}
			await record(actor, durationMs ? 'temproles.add' : 'members.role_add', guildId, userId, {
				member: `<@${userId}>`, role: role.name, ...(durationMs ? { duration: formatDuration(durationMs) } : {}), reason: reason || null,
			});
			return temp;
		},

		async takeRole(actor, { guildId, userId, roleId, reason = '' }) {
			await members.assertCanEdit(actor, guildId, userId, 'commands.roles');
			const role = await members.assertGivableRole(actor, guildId, roleId);
			await checkHierarchy(actor, guildId, role);
			await executor.removeRole(guildId, userId, roleId, `Retiré par ${actor.id}${reason ? ` : ${reason}` : ''}`);
			await q.closeFor.run(now(), actor.id, guildId, userId, roleId);
			await record(actor, 'members.role_remove', guildId, userId, { member: `<@${userId}>`, role: role.name, reason: reason || null });
		},

		async listTempRoles({ userId, guildId, active = true } = {}) {
			const where = [userId && 'user_id = @userId', guildId && 'guild_id = @guildId', active && 'removed_at IS NULL'].filter(Boolean);
			return (await db.prepare(`SELECT * FROM temp_roles ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY expires_at LIMIT 500`).all({ userId, guildId })).map(toTemp);
		},

		async extendTempRole(actor, id, durationMs) {
			need(actor, 'commands.roles');
			const temp = toTemp(await q.temp.get(id));
			if (!temp || temp.removedAt) throw new NotFoundError('Rôle temporaire introuvable ou déjà retiré.');
			if (!Number.isFinite(durationMs) || durationMs < 60_000 || durationMs > MAX_TEMP_ROLE_MS) throw new ValidationError('Prolongation : entre 1 minute et 1 an.');
			await q.extend.run(Math.max(temp.expiresAt, now()) + durationMs, id);
			await record(actor, 'temproles.extend', temp.guildId, temp.userId, { member: `<@${temp.userId}>`, role: temp.roleName, duration: formatDuration(durationMs) });
			return toTemp(await q.temp.get(id));
		},

		async removeTempRole(actor, id) {
			need(actor, 'commands.roles');
			const temp = toTemp(await q.temp.get(id));
			if (!temp || temp.removedAt) throw new NotFoundError('Rôle temporaire introuvable ou déjà retiré.');
			await executor.removeRole(temp.guildId, temp.userId, temp.roleId, `Rôle temporaire retiré par ${actor.id}`);
			await q.close.run(now(), actor.id, id);
			await record(actor, 'temproles.remove', temp.guildId, temp.userId, { member: `<@${temp.userId}>`, role: temp.roleName });
		},

		// Every 30 s: temporary roles reaching their end
		async expireTempRoles() {
			const due = (await q.due.all(now())).map(toTemp);
			let expired = 0;
			for (const temp of due) {
				// Closed first: an overlapping tick (slow Discord calls) must not remove and audit it twice
				if (!(await q.close.run(now(), 'system', temp.id)).changes) continue;
				expired++;
				try {
					await executor.removeRole(temp.guildId, temp.userId, temp.roleId, 'Fin du rôle temporaire');
				}
				catch (error) {
					// Deleted role or server gone: nothing left to remove
					logger.warn(`Temporary role #${temp.id} not removed:`, error.message);
				}
				await audit.record({ actorId: 'system', source: 'system', action: 'temproles.expire', guildId: temp.guildId, target: temp.userId, details: { member: `<@${temp.userId}>`, role: temp.roleName } });
			}
			return expired;
		},

		// /fiche: the network profile of someone, as the panel shows it
		async userInfo(actor, userId) {
			need(actor, 'commands.userinfo');
			const profile = await members.lookup(userId);
			return { ...profile, tempRoles: await service.listTempRoles({ userId }), principal: await ranks.resolve(userId) };
		},
	};
	return service;
}
