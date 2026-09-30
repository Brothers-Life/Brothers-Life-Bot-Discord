import { createPrincipal, isKnownPermission, SYSTEM } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from './errors.js';

const CACHE_TTL_MS = 60_000;

// Ranks bundle permissions. A user gets ranks through Discord roles on the main server
// (rank_roles) or directly from the panel (user_ranks). OWNER_ID bypasses everything.
export function createRankService({ db, audit, ownerId, getMainGuildId, getMemberRoleIds, now = Date.now }) {
	const cache = new Map();

	const q = {
		all: db.prepare('SELECT * FROM ranks ORDER BY level DESC, name'),
		get: db.prepare('SELECT * FROM ranks WHERE id = ?'),
		perms: db.prepare('SELECT permission FROM rank_permissions WHERE rank_id = ? ORDER BY permission'),
		roles: db.prepare('SELECT guild_id, role_id FROM rank_roles WHERE rank_id = ?'),
		insert: db.prepare('INSERT INTO ranks (name, level, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
		update: db.prepare('UPDATE ranks SET name = ?, level = ?, color = ?, updated_at = ? WHERE id = ?'),
		delete: db.prepare('DELETE FROM ranks WHERE id = ?'),
		clearPerms: db.prepare('DELETE FROM rank_permissions WHERE rank_id = ?'),
		addPerm: db.prepare('INSERT INTO rank_permissions (rank_id, permission) VALUES (?, ?)'),
		clearRoles: db.prepare('DELETE FROM rank_roles WHERE rank_id = ? AND guild_id = ?'),
		addRole: db.prepare('INSERT OR IGNORE INTO rank_roles (rank_id, guild_id, role_id) VALUES (?, ?, ?)'),
		byName: db.prepare('SELECT id FROM ranks WHERE name = ? COLLATE NOCASE AND id != ?'),
		directOf: db.prepare('SELECT rank_id FROM user_ranks WHERE discord_id = ?'),
		direct: db.prepare('SELECT discord_id, rank_id, added_by, added_at FROM user_ranks ORDER BY added_at'),
		assign: db.prepare('INSERT OR IGNORE INTO user_ranks (discord_id, rank_id, added_by, added_at) VALUES (?, ?, ?, ?)'),
		unassign: db.prepare('DELETE FROM user_ranks WHERE discord_id = ? AND rank_id = ?'),
	};

	function hydrate(row) {
		return {
			id: row.id,
			name: row.name,
			level: row.level,
			color: row.color,
			permissions: q.perms.all(row.id).map(r => r.permission),
			roles: q.roles.all(row.id).map(r => ({ guildId: r.guild_id, roleId: r.role_id })),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	function getOrThrow(id) {
		const row = q.get.get(id);
		if (!row) throw new NotFoundError('Rang introuvable.');
		return hydrate(row);
	}

	function validate({ name, level, color, permissions }) {
		if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 50)) {
			throw new ValidationError('Le nom du rang doit faire 1 à 50 caractères.');
		}
		if (level !== undefined && (!Number.isInteger(level) || level < 0 || level > 100)) {
			throw new ValidationError('Le niveau doit être un entier entre 0 et 100.');
		}
		if (color !== undefined && color !== null && !/^#[0-9a-f]{6}$/i.test(color)) {
			throw new ValidationError('La couleur doit ressembler à #5865f2.');
		}
		if (permissions !== undefined) {
			if (!Array.isArray(permissions)) throw new ValidationError('permissions doit être une liste.');
			const unknown = permissions.filter(p => !isKnownPermission(p));
			if (unknown.length) throw new ValidationError(`Permissions inconnues : ${unknown.join(', ')}`);
		}
	}

	// --- Anti-escalation rules -------------------------------------------------------------
	function requirePermission(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function requireBelow(actor, level) {
		if (!actor.isOwner && level >= actor.level) {
			throw new ForbiddenError(`Tu ne peux gérer que des rangs de niveau inférieur au tien (${actor.level}).`);
		}
	}

	function requireHeld(actor, permissions) {
		const missing = permissions.filter(p => !actor.can(p));
		if (missing.length) throw new ForbiddenError(`Tu ne peux pas donner des permissions que tu n’as pas : ${missing.join(', ')}`);
	}

	function assertUniqueName(name, id = -1) {
		if (q.byName.get(name.trim(), id)) throw new ConflictError(`Un rang nommé « ${name.trim()} » existe déjà.`);
	}

	function record(actor, action, target, details) {
		audit?.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(target), details });
	}

	function invalidate(userId) {
		if (userId) cache.delete(userId);
		else cache.clear();
	}

	async function computeRanks(userId) {
		const rankIds = new Set(q.directOf.all(userId).map(r => r.rank_id));

		const mainGuildId = getMainGuildId();
		if (mainGuildId) {
			const roleIds = await getMemberRoleIds(mainGuildId, userId);
			if (roleIds?.length) {
				const placeholders = roleIds.map(() => '?').join(',');
				const rows = db.prepare(`SELECT DISTINCT rank_id FROM rank_roles WHERE guild_id = ? AND role_id IN (${placeholders})`)
					.all(mainGuildId, ...roleIds);
				for (const row of rows) rankIds.add(row.rank_id);
			}
		}

		return [...rankIds].map(id => q.get.get(id)).filter(Boolean).map(hydrate);
	}

	const service = {
		system: SYSTEM,

		list() {
			return q.all.all().map(hydrate);
		},

		get: getOrThrow,

		async resolve(userId) {
			userId = String(userId);
			if (userId === ownerId) return createPrincipal({ id: userId, isOwner: true });

			const cached = cache.get(userId);
			if (cached && now() - cached.at < CACHE_TTL_MS) return cached.principal;

			const userRanks = await computeRanks(userId);
			const principal = createPrincipal({
				id: userId,
				level: Math.max(0, ...userRanks.map(r => r.level)),
				permissions: userRanks.flatMap(r => r.permissions),
				ranks: userRanks.map(({ id, name, level, color }) => ({ id, name, level, color })),
			});
			cache.set(userId, { at: now(), principal });
			return principal;
		},

		invalidate,

		create(actor, { name, level, color = null, permissions = [] }) {
			requirePermission(actor, 'ranks.manage');
			validate({ name, level, color, permissions });
			requireBelow(actor, level);
			requireHeld(actor, permissions);
			assertUniqueName(name);

			const id = db.transaction(() => {
				const at = now();
				const { lastInsertRowid } = q.insert.run(name.trim(), level, color, at, at);
				for (const permission of new Set(permissions)) q.addPerm.run(lastInsertRowid, permission);
				return Number(lastInsertRowid);
			})();

			const rank = getOrThrow(id);
			record(actor, 'ranks.create', id, { name: rank.name, level, permissions: rank.permissions });
			return rank;
		},

		update(actor, id, patch) {
			requirePermission(actor, 'ranks.manage');
			const rank = getOrThrow(id);
			validate(patch);
			requireBelow(actor, rank.level);
			if (patch.level !== undefined) requireBelow(actor, patch.level);
			if (patch.name !== undefined) assertUniqueName(patch.name, id);

			let added = [], removed = [];
			if (patch.permissions !== undefined) {
				const next = new Set(patch.permissions);
				added = [...next].filter(p => !rank.permissions.includes(p));
				removed = rank.permissions.filter(p => !next.has(p));
				requireHeld(actor, [...added, ...removed]);
			}

			db.transaction(() => {
				q.update.run(
					patch.name?.trim() ?? rank.name,
					patch.level ?? rank.level,
					patch.color !== undefined ? patch.color : rank.color,
					now(),
					id,
				);
				if (patch.permissions !== undefined) {
					q.clearPerms.run(id);
					for (const permission of new Set(patch.permissions)) q.addPerm.run(id, permission);
				}
			})();
			invalidate();

			const updated = getOrThrow(id);
			record(actor, 'ranks.update', id, {
				name: updated.name,
				...(patch.name !== undefined && patch.name !== rank.name ? { renamedFrom: rank.name } : {}),
				...(patch.level !== undefined && patch.level !== rank.level ? { level: [rank.level, patch.level] } : {}),
				...(added.length ? { added } : {}),
				...(removed.length ? { removed } : {}),
			});
			return updated;
		},

		remove(actor, id) {
			requirePermission(actor, 'ranks.manage');
			const rank = getOrThrow(id);
			requireBelow(actor, rank.level);
			q.delete.run(id);
			invalidate();
			record(actor, 'ranks.delete', id, { name: rank.name });
		},

		// Replaces the Discord roles (of the main server) that grant this rank
		setRoleLinks(actor, id, roleIds) {
			requirePermission(actor, 'ranks.manage');
			const rank = getOrThrow(id);
			requireBelow(actor, rank.level);
			const mainGuildId = getMainGuildId();
			if (!mainGuildId) throw new ValidationError('Choisis d’abord le serveur principal.');
			if (!Array.isArray(roleIds) || roleIds.some(r => typeof r !== 'string' || !r)) {
				throw new ValidationError('roleIds doit être une liste d’ID de rôles.');
			}
			// @everyone has the server's id: linking it would give the rank to every member
			if (roleIds.includes(mainGuildId)) throw new ValidationError('Le rôle @everyone ne peut pas donner de rang.');

			db.transaction(() => {
				q.clearRoles.run(id, mainGuildId);
				for (const roleId of new Set(roleIds)) q.addRole.run(id, mainGuildId, roleId);
			})();
			invalidate();
			record(actor, 'ranks.roles', id, { name: rank.name, roles: [...new Set(roleIds)] });
			return getOrThrow(id);
		},

		listDirectAssignments() {
			return q.direct.all().map(r => ({ discordId: r.discord_id, rankId: r.rank_id, addedBy: r.added_by, addedAt: r.added_at }));
		},

		async assignDirect(actor, userId, rankId) {
			return changeDirect(actor, userId, rankId, true);
		},

		async unassignDirect(actor, userId, rankId) {
			return changeDirect(actor, userId, rankId, false);
		},
	};

	async function changeDirect(actor, userId, rankId, assign) {
		userId = String(userId);
		requirePermission(actor, 'members.assign');
		if (!/^\d{17,20}$/.test(userId)) throw new ValidationError('ID Discord invalide.');
		if (userId === actor.id && !actor.isOwner) throw new ForbiddenError('Tu ne peux pas modifier tes propres rangs.');
		if (userId === ownerId) throw new ForbiddenError('Le chef du réseau a déjà toutes les permissions.');
		const rank = getOrThrow(rankId);
		requireBelow(actor, rank.level);

		if (!actor.isOwner) {
			// Resolve without cache: the target's level must be strictly below ours
			invalidate(userId);
			const target = await service.resolve(userId);
			if (target.level >= actor.level) throw new ForbiddenError('Tu ne peux pas modifier les rangs de quelqu’un de niveau égal ou supérieur au tien.');
		}

		if (assign) q.assign.run(userId, rankId, actor.id, now());
		else q.unassign.run(userId, rankId);
		invalidate(userId);
		record(actor, assign ? 'ranks.assign' : 'ranks.unassign', userId, { rank: rank.name, rankId });
	}

	return service;
}
