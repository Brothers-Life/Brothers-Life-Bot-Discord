import { ForbiddenError, ValidationError } from './errors.js';

// Staff roles on every server: a rank can be linked to roles on each server of the network.
// Holders of the rank (roles on the main server, or direct rank) get those roles; others lose them.
// Only roles linked to a rank are ever touched.
export function createStaffSync({ db, network, ranks, audit, executor, logs, logger = console }) {
	logs.registerCategory('staff_sync', 'Synchronisation des rôles du staff');

	const q = {
		linksOf: db.prepare('SELECT rank_id, role_id FROM rank_roles WHERE guild_id = ?'),
		clear: db.prepare('DELETE FROM rank_roles WHERE rank_id = ? AND guild_id = ?'),
		add: db.prepare('INSERT INTO rank_roles (rank_id, guild_id, role_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
		direct: db.prepare('SELECT DISTINCT discord_id FROM user_ranks'),
	};

	async function satelliteIds() {
		const mainId = await network.getMainId();
		return (await network.activeIds()).filter(id => id !== mainId);
	}

	async function linksOf(guildId, { syncedOnly = false } = {}) {
		const map = new Map();
		const skipped = syncedOnly ? new Set((await ranks.list()).filter(r => !r.syncRoles).map(r => r.id)) : new Set();
		for (const { rank_id: rankId, role_id: roleId } of await q.linksOf.all(guildId)) {
			if (skipped.has(rankId)) continue;
			map.set(rankId, [...(map.get(rankId) ?? []), roleId]);
		}
		return map;
	}

	async function syncMember(guildId, userId, { reason = 'Synchronisation du staff' } = {}) {
		const links = await linksOf(guildId, { syncedOnly: true });
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

		await audit.record({
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
		async overview() {
			const guilds = (await network.list()).filter(g => g.status === 'active' && g.botPresent);
			return Promise.all(guilds.map(async g => ({ id: g.id, name: g.name, isMain: g.isMain, links: Object.fromEntries(await linksOf(g.id)) })));
		},

		async setLinks(actor, rankId, guildId, roleIds) {
			if (!actor.can('ranks.manage')) throw new ForbiddenError('Permission manquante : ranks.manage');
			if (guildId === await network.getMainId()) return await ranks.setRoleLinks(actor, rankId, roleIds);
			const rank = await ranks.get(rankId);
			if (!actor.isOwner && rank.level >= actor.level) throw new ForbiddenError('Tu ne peux gérer que des rangs de niveau inférieur au tien.');
			if ((await network.find(guildId))?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
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

			await db.transaction(async () => {
				await q.clear.run(rankId, guildId);
				for (const roleId of new Set(roleIds)) await q.add.run(rankId, guildId, roleId);
			})();
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'staff_sync.links', guildId, target: String(rankId), details: { rank: rank.name, roles: roleIds.map(r => `<@&${r}>`) } });
			return await linksOf(guildId);
		},

		// Copy of the rank's role (from the main server) on every other server that has none: created if missing
		// (same name, color, display), then linked. Its Discord permissions are copied only if they are harmless.
		async copyRoleToNetwork(actor, rankId) {
			if (!actor.can('ranks.manage')) throw new ForbiddenError('Permission manquante : ranks.manage');
			const rank = await ranks.get(rankId);
			if (!actor.isOwner && rank.level >= actor.level) throw new ForbiddenError('Tu ne peux gérer que des rangs de niveau inférieur au tien.');
			const mainId = await network.getMainId();
			if (!mainId) throw new ValidationError('Choisis d’abord le serveur principal.');
			const sourceId = (await linksOf(mainId)).get(rankId)?.[0];
			if (!sourceId) throw new ValidationError('Lie d’abord ce rang à un rôle du serveur principal.');
			const source = (await executor.listRoles(mainId)).find(r => r.id === sourceId);
			if (!source) throw new ValidationError('Le rôle du serveur principal n’existe plus.');
			const copyPermissions = !source.dangerous || actor.isOwner;
			const results = [];
			for (const guildId of await satelliteIds()) {
				const guild = await network.find(guildId);
				if (!guild?.botPresent) continue;
				if ((await linksOf(guildId)).get(rankId)?.length) {
					results.push({ guildId, name: guild.name, status: 'already' });
					continue;
				}
				try {
					const roles = await executor.listRoles(guildId);
					let role = roles.find(r => r.name.toLowerCase() === source.name.toLowerCase());
					let status = 'linked';
					if (!role) {
						const id = await executor.createRole(guildId, { name: source.name, color: source.color, hoist: false, mentionable: false, permissions: copyPermissions ? source.permissions ?? '0' : '0' });
						role = { id, editable: true, dangerous: copyPermissions && source.dangerous };
						status = 'created';
					}
					if (!role.editable) throw new Error(`le rôle ${source.name} est au-dessus du bot`);
					if (role.dangerous && !actor.isOwner) throw new Error(`le rôle ${source.name} a des permissions de modération : seul le chef du réseau peut le lier`);
					await db.transaction(async () => q.add.run(rankId, guildId, role.id))();
					results.push({ guildId, name: guild.name, status, roleId: role.id });
				}
				catch (error) {
					results.push({ guildId, name: guild.name, status: 'error', error: error.message });
				}
			}
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'staff_sync.copy_role', target: String(rankId), details: { rank: rank.name, role: source.name, servers: results.filter(r => r.status === 'created' || r.status === 'linked').length, permissions: copyPermissions ? 'copiées' : 'aucune (rôle sensible)' } });
			return { results, copiedPermissions: copyPermissions };
		},

		// Roles of one server next to the roles of another, to choose which ones to copy
		async copyRolesPreview(fromId, toId) {
			const servers = [];
			for (const id of await network.activeIds()) {
				const guild = await network.find(id);
				if (guild?.botPresent) servers.push({ id, name: guild.name });
			}
			if (!fromId || !toId || fromId === toId) return { servers, roles: [] };
			const [source, target] = await Promise.all([executor.listRoles(fromId), executor.listRoles(toId)]);
			const rankOf = new Map((await ranks.list()).map(r => [r.id, r.name]));
			const ranksOf = new Map();
			for (const { rank_id: rankId, role_id: roleId } of await q.linksOf.all(fromId)) {
				if (rankOf.has(rankId)) ranksOf.set(roleId, [...ranksOf.get(roleId) ?? [], rankOf.get(rankId)]);
			}
			return {
				servers,
				roles: source.map((role) => {
					const match = target.find(r => r.name.toLowerCase() === role.name.toLowerCase());
					return { ...role, ranks: ranksOf.get(role.id) ?? [], target: match ? { id: match.id, editable: match.editable, dangerous: match.dangerous } : null };
				}),
			};
		},

		// Chosen roles of one server copied to another: created, or updated when a role of the same name is there
		// (color, display, mentions, permissions; its place in the list is kept). The rank links follow.
		async copyRoles(actor, { from, to, roleIds }) {
			if (!actor.can('ranks.manage')) throw new ForbiddenError('Permission manquante : ranks.manage');
			if (from === to) throw new ValidationError('Choisis deux serveurs différents.');
			for (const id of [from, to]) {
				const guild = await network.find(id);
				if (guild?.status !== 'active' || !guild.botPresent) throw new ValidationError(`${guild?.name ?? id} : serveur hors du réseau ou sans le bot.`);
			}
			if (!Array.isArray(roleIds) || !roleIds.length) throw new ValidationError('Choisis au moins un rôle.');
			// Highest first: Discord puts each new role at the bottom, so the copies keep the order of the source
			const source = (await executor.listRoles(from)).filter(r => roleIds.includes(r.id)).sort((a, b) => b.position - a.position);
			if (source.length !== new Set(roleIds).size) throw new ValidationError('Certains rôles n’existent plus sur le serveur source.');
			const target = await executor.listRoles(to);
			const mainId = await network.getMainId();
			const ranksOf = new Map();
			for (const { rank_id: rankId, role_id: roleId } of await q.linksOf.all(from)) ranksOf.set(roleId, [...ranksOf.get(roleId) ?? [], rankId]);
			const links = await linksOf(to);

			const results = [];
			for (const role of source) {
				try {
					// Otherwise someone below the chief could hand out admin roles on another server
					if (role.dangerous && !actor.isOwner) throw new Error('permissions de modération ou d’administration : seul le chef du réseau peut le copier');
					const data = { color: role.color === '#000000' ? 0 : role.color, hoist: Boolean(role.hoist), mentionable: Boolean(role.mentionable), permissions: role.permissions ?? '0', reason: 'Copie de rôles' };
					const match = target.find(r => r.name.toLowerCase() === role.name.toLowerCase());
					let id;
					if (match) {
						if (!match.editable) throw new Error('le rôle du même nom est au-dessus du rôle du bot sur ce serveur');
						if (match.dangerous && !actor.isOwner) throw new Error('le rôle du même nom a des permissions de modération : seul le chef du réseau peut le modifier');
						await executor.editRole(to, match.id, data);
						id = match.id;
					}
					else {
						id = await executor.createRole(to, { name: role.name, ...data });
					}
					const linked = [];
					for (const rankId of ranksOf.get(role.id) ?? []) {
						const rank = await ranks.get(rankId);
						if (!actor.isOwner && rank.level >= actor.level) continue;
						const current = links.get(rankId) ?? [];
						if (current.includes(id)) continue;
						if (to === mainId) await ranks.setRoleLinks(actor, rankId, [...current, id]);
						else await q.add.run(rankId, to, id);
						links.set(rankId, [...current, id]);
						linked.push(rank.name);
					}
					results.push({ roleId: role.id, name: role.name, status: match ? 'updated' : 'created', targetId: id, ranks: linked });
				}
				catch (error) {
					results.push({ roleId: role.id, name: role.name, status: 'error', error: error.message });
				}
			}
			const [fromGuild, toGuild] = await Promise.all([network.find(from), network.find(to)]);
			const names = status => results.filter(r => r.status === status).map(r => r.name);
			await audit.record({
				actorId: actor.id, source: actor.source ?? 'panel', action: 'staff_sync.copy_roles', guildId: to, target: toGuild?.name ?? to,
				details: { depuis: fromGuild?.name ?? from, créés: names('created'), 'mis à jour': names('updated'), échecs: names('error') },
			});
			return results;
		},

		// One member, every server (e.g. their roles changed on the main server)
		async syncUser(userId) {
			const results = {};
			for (const guildId of await satelliteIds()) results[guildId] = await syncMember(guildId, userId).catch(e => ({ error: e.message }));
			return results;
		},

		// Everybody concerned: rank holders and current holders of linked roles
		async syncAll() {
			const mainId = await network.getMainId();
			const holders = new Set((await q.direct.all()).map(r => r.discord_id));
			if (mainId) {
				const sourceRoles = [...(await linksOf(mainId)).values()].flat();
				for (const m of await executor.listMembersWithAnyRole(mainId, sourceRoles)) holders.add(m.id);
			}

			let changed = 0;
			for (const guildId of await satelliteIds()) {
				const links = await linksOf(guildId, { syncedOnly: true });
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
