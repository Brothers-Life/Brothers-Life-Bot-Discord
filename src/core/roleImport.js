import { ForbiddenError, ValidationError } from './errors.js';

const normalize = (name) => name.trim().toLowerCase();

// Reuse the roles that already exist on Discord instead of recreating everything by hand:
// - main server roles become ranks (or get linked to the rank of the same name);
// - on the other servers, each rank is linked to the role of the same name.
export function createRoleImport({ db, network, ranks, staffSync, executor, audit }) {
	const linkedOn = db.prepare('SELECT rank_id FROM rank_roles WHERE guild_id = ? AND role_id = ?');

	function requireManage(actor) {
		if (!actor.can('ranks.manage')) throw new ForbiddenError('Permission manquante : ranks.manage');
	}

	return {
		// Roles of the main server, with the rank they already give or the rank of the same name
		async candidates() {
			const mainId = network.getMainId();
			if (!mainId) return { mainGuildId: null, roles: [] };
			const existing = ranks.list();
			const roles = await executor.listRoles(mainId);
			return {
				mainGuildId: mainId,
				roles: roles.map((role) => {
					const linked = linkedOn.get(mainId, role.id);
					const sameName = existing.find(r => normalize(r.name) === normalize(role.name));
					return {
						...role,
						linkedRankId: linked?.rank_id ?? null,
						sameNameRankId: sameName?.id ?? null,
					};
				}),
			};
		},

		// Highest role gets the highest level; every created rank starts without any permission
		async importMainRoles(actor, roleIds) {
			requireManage(actor);
			const mainId = network.getMainId();
			if (!mainId) throw new ValidationError('Choisis d’abord le serveur principal.');
			if (!Array.isArray(roleIds) || !roleIds.length) throw new ValidationError('Choisis au moins un rôle.');

			const roles = (await executor.listRoles(mainId)).filter(r => roleIds.includes(r.id)).sort((a, b) => b.position - a.position);
			if (roles.length !== new Set(roleIds).size) throw new ValidationError('Certains rôles n’existent pas sur le serveur principal.');

			const maxLevel = actor.isOwner ? 90 : Math.min(90, actor.level - 1);
			if (maxLevel < 1) throw new ForbiddenError('Ton niveau ne permet pas de créer des rangs.');
			const step = Math.max(1, Math.floor(maxLevel / roles.length));

			const results = [];
			for (const [index, role] of roles.entries()) {
				const alreadyLinked = linkedOn.get(mainId, role.id);
				if (alreadyLinked) {
					results.push({ roleId: role.id, name: role.name, status: 'already_linked', rankId: alreadyLinked.rank_id });
					continue;
				}
				try {
					let rank = ranks.list().find(r => normalize(r.name) === normalize(role.name));
					let status = 'linked';
					if (!rank) {
						const color = /^#[0-9a-f]{6}$/i.test(role.color) && role.color !== '#000000' ? role.color : null;
						rank = ranks.create(actor, { name: role.name.slice(0, 50), level: Math.max(1, maxLevel - index * step), color, permissions: [] });
						status = 'created';
					}
					const mainLinks = rank.roles.filter(l => l.guildId === mainId).map(l => l.roleId);
					ranks.setRoleLinks(actor, rank.id, [...new Set([...mainLinks, role.id])]);
					results.push({ roleId: role.id, name: role.name, status, rankId: rank.id });
				}
				catch (error) {
					results.push({ roleId: role.id, name: role.name, status: 'error', error: error.message });
				}
			}
			audit.record({
				actorId: actor.id,
				source: actor.source ?? 'panel',
				action: 'ranks.import',
				target: 'serveur principal',
				details: {
					created: results.filter(r => r.status === 'created').map(r => r.name),
					linked: results.filter(r => r.status === 'linked').map(r => r.name),
				},
			});
			return results;
		},

		// On every other server: rank <-> role of the same name, when the rank has no role there yet
		async linkByName(actor) {
			requireManage(actor);
			const mainId = network.getMainId();
			const results = [];
			for (const guild of network.list().filter(g => g.status === 'active' && g.botPresent && g.id !== mainId)) {
				const roles = await executor.listRoles(guild.id);
				const links = staffSync.linksOf(guild.id);
				for (const rank of ranks.list()) {
					if (links.get(rank.id)?.length) continue;
					if (!actor.isOwner && rank.level >= actor.level) continue;
					const role = roles.find(r => normalize(r.name) === normalize(rank.name));
					if (!role) continue;
					try {
						await staffSync.setLinks(actor, rank.id, guild.id, [role.id]);
						results.push({ guild: guild.name, rank: rank.name, role: role.name, status: 'linked' });
					}
					catch (error) {
						results.push({ guild: guild.name, rank: rank.name, role: role.name, status: 'error', error: error.message });
					}
				}
			}
			return results;
		},
	};
}
