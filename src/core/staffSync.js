import { ForbiddenError, ValidationError } from './errors.js';

// Staff roles on every server: a rank can be linked to roles on each server of the network.
// Holders of the rank (roles on the main server, or direct rank) get those roles; others lose them.
// Only roles linked to a rank are ever touched.
export function createStaffSync({ db, network, ranks, audit, executor, logs, logger = console }) {
	logs.registerCategory('staff_sync', 'Synchronisation des rôles du staff');

	const q = {
		linksOf: db.prepare('SELECT rank_id, role_id FROM rank_roles WHERE guild_id = ?'),
		clear: db.prepare('DELETE FROM rank_roles WHERE rank_id = ? AND guild_id = ?'),
		add: db.prepare('INSERT OR IGNORE INTO rank_roles (rank_id, guild_id, role_id) VALUES (?, ?, ?)'),
		direct: db.prepare('SELECT DISTINCT discord_id FROM user_ranks'),
	};

	function satelliteIds() {
		const mainId = network.getMainId();
		return network.activeIds().filter(id => id !== mainId);
	}

	function linksOf(guildId) {
		const map = new Map();
		for (const { rank_id: rankId, role_id: roleId } of q.linksOf.all(guildId)) {
			map.set(rankId, [...(map.get(rankId) ?? []), roleId]);
		}
		return map;
	}

	async function syncMember(guildId, userId, { reason = 'Synchronisation du staff' } = {}) {
		const links = linksOf(guildId);
		if (!links.size) return null;
		const current = await executor.getMemberRoleIds(guildId, userId);
		if (!current) return null;

		const principal = await ranks.resolve(userId);
		const heldRankIds = new Set(principal.isOwner ? [] : principal.ranks.map(r => r.id));
		const managed = new Set([...links.values()].flat());
		const desired = new Set([...links].filter(([rankId]) => heldRankIds.has(rankId)).flatMap(([, roles]) => roles));

		const toAdd = [...desired].filter(r => !current.includes(r));
		const toRemove = current.filter(r => managed.has(r) && !desired.has(r));
		if (!toAdd.length && !toRemove.length) return { added: [], removed: [] };

		const errors = [];
		for (const roleId of toAdd) await executor.addRole(guildId, userId, roleId, reason).catch(e => errors.push(`+${roleId}: ${e.message}`));
		for (const roleId of toRemove) await executor.removeRole(guildId, userId, roleId, reason).catch(e => errors.push(`-${roleId}: ${e.message}`));
		if (errors.length) logger.warn(`Staff sync on ${guildId} for ${userId}:`, errors.join(', '));

		audit.record({
			actorId: 'system',
			source: 'system',
			action: 'staff_sync.member',
			guildId,
			target: userId,
			details: {
				added: toAdd.map(r => `<@&${r}>`),
				removed: toRemove.map(r => `<@&${r}>`),
				...(errors.length ? { errors } : {}),
			},
		});
		return { added: toAdd, removed: toRemove, errors };
	}

	return {
		linksOf,
		syncMember,

		// Links of every rank on every server (main server links = roles that grant the rank)
		overview() {
			const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
			return guilds.map(g => ({ id: g.id, name: g.name, isMain: g.isMain, links: Object.fromEntries(linksOf(g.id)) }));
		},

		async setLinks(actor, rankId, guildId, roleIds) {
			if (!actor.can('ranks.manage')) throw new ForbiddenError('Permission manquante : ranks.manage');
			if (guildId === network.getMainId()) return ranks.setRoleLinks(actor, rankId, roleIds);
			const rank = ranks.get(rankId);
			if (!actor.isOwner && rank.level >= actor.level) throw new ForbiddenError('Tu ne peux gérer que des rangs de niveau inférieur au tien.');
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			if (roleIds.includes(guildId)) throw new ValidationError('Le rôle @everyone ne peut pas être lié à un rang.');

			const roles = await executor.listRoles(guildId);
			for (const roleId of roleIds) {
				const role = roles.find(r => r.id === roleId);
				if (!role) throw new ValidationError(`Rôle inconnu sur ce serveur : ${roleId}`);
				if (!role.editable) throw new ValidationError(`Le rôle ${role.name} est au-dessus du rôle du bot : place le rôle du bot plus haut.`);
				// Otherwise someone holding a lower rank could link it to an admin role and receive it
				if (role.dangerous && !actor.isOwner) {
					throw new ForbiddenError(`Le rôle ${role.name} donne des permissions de modération ou d’administration : seul le chef du réseau peut le lier à un rang.`);
				}
			}

			db.transaction(() => {
				q.clear.run(rankId, guildId);
				for (const roleId of new Set(roleIds)) q.add.run(rankId, guildId, roleId);
			})();
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'staff_sync.links', guildId, target: String(rankId), details: { rank: rank.name, roles: roleIds.map(r => `<@&${r}>`) } });
			return linksOf(guildId);
		},

		// One member, every server (e.g. their roles changed on the main server)
		async syncUser(userId) {
			const results = {};
			for (const guildId of satelliteIds()) results[guildId] = await syncMember(guildId, userId).catch(e => ({ error: e.message }));
			return results;
		},

		// Everybody concerned: rank holders and current holders of linked roles
		async syncAll() {
			const mainId = network.getMainId();
			const holders = new Set(q.direct.all().map(r => r.discord_id));
			if (mainId) {
				const sourceRoles = [...linksOf(mainId).values()].flat();
				for (const m of await executor.listMembersWithAnyRole(mainId, sourceRoles)) holders.add(m.id);
			}

			let changed = 0;
			for (const guildId of satelliteIds()) {
				const links = linksOf(guildId);
				if (!links.size) continue;
				const people = new Set(holders);
				for (const m of await executor.listMembersWithAnyRole(guildId, [...links.values()].flat())) people.add(m.id);
				for (const userId of people) {
					const result = await syncMember(guildId, userId).catch(() => null);
					if (result && (result.added.length || result.removed.length)) changed++;
				}
			}
			return { changed };
		},
	};
}
