import { ForbiddenError, ValidationError } from './errors.js';

// Looking up and editing members across the network (roles, nickname)
export function createMembers({ db, network, ranks, sanctions, audit, executor }) {
	const linkedRoles = db.prepare('SELECT DISTINCT role_id FROM rank_roles WHERE guild_id = ?');

	async function checkTarget(actor, guildId, userId) {
		if (!actor.can('members.manage')) throw new ForbiddenError('Permission manquante : members.manage');
		if (userId === actor.id && !actor.isOwner) throw new ForbiddenError('Tu ne peux pas modifier ton propre profil.');
		if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
		const target = await ranks.resolve(userId);
		if (target.isOwner && !actor.isOwner) throw new ForbiddenError('Le chef du réseau ne peut pas être modifié.');
		if (!actor.isOwner && target.level > 0 && target.level >= actor.level) {
			throw new ForbiddenError('Tu ne peux pas modifier quelqu’un de niveau égal ou supérieur au tien.');
		}
	}

	async function checkRole(actor, guildId, roleId) {
		if (roleId === guildId) throw new ValidationError('Le rôle @everyone ne se donne pas.');
		const role = (await executor.listRoles(guildId)).find(r => r.id === roleId);
		if (!role) throw new ValidationError('Rôle inconnu sur ce serveur.');
		if (!role.editable) throw new ValidationError(`Le rôle ${role.name} est au-dessus du rôle du bot.`);
		if (linkedRoles.all(guildId).some(r => r.role_id === roleId)) {
			throw new ValidationError(`Le rôle ${role.name} est lié à un rang : il se gère par les rangs, pas à la main.`);
		}
		if (role.dangerous && !actor.isOwner) {
			throw new ForbiddenError(`Le rôle ${role.name} donne des permissions de modération ou d’administration : seul le chef du réseau peut le donner.`);
		}
		return role;
	}

	async function changeRole(actor, guildId, userId, roleId, add) {
		await checkTarget(actor, guildId, userId);
		const role = await checkRole(actor, guildId, roleId);
		const reason = `Panel : ${actor.id}`;
		if (add) await executor.addRole(guildId, userId, roleId, reason);
		else await executor.removeRole(guildId, userId, roleId, reason);
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: add ? 'members.role_add' : 'members.role_remove', guildId, target: userId, details: { role: role.name } });
	}

	return {
		async lookup(userId) {
			const user = await executor.getUser(userId);
			const principal = await ranks.resolve(userId);
			const guilds = [];
			for (const guild of network.list().filter(g => g.status === 'active' && g.botPresent)) {
				const member = await executor.getMemberInfo(guild.id, userId).catch(() => null);
				const linked = new Set(linkedRoles.all(guild.id).map(r => r.role_id));
				guilds.push({
					id: guild.id,
					name: guild.name,
					isMain: guild.isMain,
					member: member ? { ...member, roles: member.roles.map(r => ({ ...r, linkedToRank: linked.has(r.id) })) } : null,
				});
			}
			const history = sanctions.list({ userId, limit: 200 });
			return {
				user,
				ranks: principal.ranks,
				level: Number.isFinite(principal.level) ? principal.level : null,
				isOwner: principal.isOwner,
				guilds,
				sanctions: {
					total: history.length,
					active: history.filter(s => s.active).map(s => ({ id: s.id, type: s.type, expiresAt: s.expiresAt })),
					warns: history.filter(s => s.type === 'warn' && !s.revokedAt).length,
					banned: sanctions.isBanned(userId),
				},
			};
		},

		addRole: (actor, guildId, userId, roleId) => changeRole(actor, guildId, userId, roleId, true),
		removeRole: (actor, guildId, userId, roleId) => changeRole(actor, guildId, userId, roleId, false),

		async setNickname(actor, guildId, userId, nickname) {
			await checkTarget(actor, guildId, userId);
			if (nickname !== null && (typeof nickname !== 'string' || nickname.length > 32)) throw new ValidationError('Le pseudo fait 32 caractères maximum.');
			await executor.setNickname(guildId, userId, nickname || null, `Panel : ${actor.id}`);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'members.nickname', guildId, target: userId, details: { nickname: nickname || null } });
		},
	};
}
