import { ForbiddenError, ValidationError } from './errors.js';

// Staff roles on every server: a rank can be linked to roles on each server of the network.
// Holders of the rank (roles on the main server, or direct rank) get those roles; others lose them.
// A staff role of the main server is also mirrored by name: whoever holds it there gets the role of the same
// name on every other server, without any link. Only linked or mirrored roles are ever touched.

// New places of a server's roles so that the network roles sit on top, in the given order. `all`: roles from the
// lowest to the highest; `block`: ids from the highest to the lowest. Other bots' roles and what is above the bot
// stay where they are. Empty when everything is already in place.
export function roleArrangement(all, block) {
	const movable = all.filter(r => r.belowBot && !r.managed);
	const ids = new Set(movable.map(r => r.id));
	const top = new Set(block);
	const wanted = [...movable.filter(r => !top.has(r.id)).map(r => r.id), ...block.filter(id => ids.has(id)).reverse()];
	return wanted.some((id, i) => id !== movable[i].id) ? wanted.map((role, i) => ({ role, position: movable[i].position })) : [];
}

const COPIED_KEY = 'staffSync.copiedRoles';

// How long role moves on a server are taken for the bot's own (it just put the network roles in order there)
const OWN_MOVE_MS = 20_000;

export function createStaffSync({ db, network, ranks, audit, executor, settings, logs, logger = console, now = Date.now, delayMs = 1500 }) {
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

	// Staff roles of the main server (linked to a synced rank) -> role of the same name on this server.
	// Skipped: roles above the bot, and roles with admin rights when the main role has none.
	async function mirrorOf(guildId) {
		const mainId = await network.getMainId();
		const map = new Map();
		if (!mainId || mainId === guildId) return map;
		const staff = new Map();
		for (const [rankId, roleIds] of await linksOf(mainId, { syncedOnly: true })) for (const id of roleIds) staff.set(id, rankId);
		if (!staff.size) return map;
		const target = new Map();
		for (const role of await executor.listRoles(guildId)) {
			const key = role.name.toLowerCase();
			if (!target.has(key)) target.set(key, role);
		}
		for (const role of await executor.listRoles(mainId)) {
			if (!staff.has(role.id)) continue;
			const match = target.get(role.name.toLowerCase());
			if (!match || !match.editable || (match.dangerous && !role.dangerous)) continue;
			map.set(role.id, { roleId: match.id, rankId: staff.get(role.id) });
		}
		return map;
	}

	// Network roles of a server, from the highest to the lowest: the order of the main server, then the others
	async function networkRoles(guildId) {
		const mainId = await network.getMainId();
		if (!mainId || mainId === guildId) return [];
		const [mainRoles, roles, mainLinks, links, mirror, copied] = await Promise.all([
			executor.listRoles(mainId), executor.listRoles(guildId), linksOf(mainId), linksOf(guildId), mirrorOf(guildId), settings.get(COPIED_KEY, {}),
		]);
		const place = new Map(roles.map((r, i) => [r.id, i]));
		const byPlace = list => list.filter(id => place.has(id)).sort((a, b) => place.get(a) - place.get(b));
		const named = new Set([...[...mirror.values()].map(m => m.roleId), ...copied[guildId] ?? []]);
		const block = new Set();
		for (const main of mainRoles) {
			for (const [rankId, roleIds] of mainLinks) {
				if (roleIds.includes(main.id)) for (const id of byPlace(links.get(rankId) ?? [])) block.add(id);
			}
			const same = roles.find(r => r.name.toLowerCase() === main.name.toLowerCase());
			if (same && named.has(same.id)) block.add(same.id);
		}
		for (const id of byPlace([...links.values()].flat().concat([...named]))) block.add(id);
		return [...block];
	}

	// Puts the network roles of a server on top of its own roles, in the same order everywhere.
	// `stuck`: roles above the bot's own role, which it can neither move nor pass
	async function alignRoles(guildId) {
		const name = (await network.find(guildId))?.name ?? guildId;
		try {
			const block = await networkRoles(guildId);
			if (!block.length) return null;
			const all = await executor.listRolePositions(guildId);
			const positions = roleArrangement(all, block);
			if (positions.length) {
				ownMoves.set(guildId, now() + OWN_MOVE_MS);
				await executor.moveRoles(guildId, positions);
				await audit.record({ actorId: 'system', source: 'system', action: 'staff_sync.order', guildId, target: name, details: { rôles: block.length } });
			}
			return { guildId, name, moved: positions.length > 0, stuck: all.filter(r => r.aboveBot && !r.managed).map(r => r.name) };
		}
		catch (error) {
			logger.warn(`Role order not applied on ${name}:`, error.message);
			return { guildId, name, moved: false, stuck: [], error: error.message };
		}
	}

	// Roles of the members of a server who hold one of `roleIds` or are in `userIds`: { userId: [roleId] }.
	// One call per server, answered from the member list the bot keeps: nobody is fetched one by one.
	async function snapshot(guildId, roleIds, userIds) {
		if (typeof executor.memberRoleSnapshot === 'function') return await executor.memberRoleSnapshot(guildId, { roleIds, userIds });
		const out = {};
		const ids = new Set(userIds);
		for (const member of await executor.listMembersWithAnyRole(guildId, roleIds)) ids.add(member.id);
		for (const id of ids) {
			const roles = await executor.getMemberRoleIds(guildId, id);
			if (roles) out[id] = roles;
		}
		return out;
	}

	// `known`: what a sync of the whole server already read (links, current roles, roles on the main server)
	async function syncMember(guildId, userId, { reason = 'Synchronisation du staff', mirror = null, links = null, current = null, mainRoles = null } = {}) {
		links ??= await linksOf(guildId, { syncedOnly: true });
		mirror ??= await mirrorOf(guildId);
		if (!links.size && !mirror.size) return null;
		current ??= await executor.getMemberRoleIds(guildId, userId);
		if (!current) return null;

		const principal = await ranks.resolve(userId);
		const heldRankIds = new Set(principal.isOwner ? [] : principal.ranks.map(r => r.id));
		if (mirror.size) mainRoles ??= (await executor.getMemberRoleIds(await network.getMainId(), userId)) ?? [];
		mainRoles ??= [];
		const mirroredIds = new Set([...mirror.values()].map(m => m.roleId));
		const managed = new Set([...links.values()].flat().concat([...mirroredIds]));
		const desired = new Set([...links].filter(([rankId]) => heldRankIds.has(rankId)).flatMap(([, roles]) => roles)
			.concat([...mirror].filter(([mainRoleId]) => mainRoles.includes(mainRoleId)).map(([, m]) => m.roleId)));

		const toAdd = [...desired].filter(r => !current.includes(r));
		// The chief holds no rank: only mirrored roles follow them, their linked roles are left alone
		const toRemove = current.filter(r => managed.has(r) && !desired.has(r) && (!principal.isOwner || mirroredIds.has(r)));
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

	// Who can be concerned on any server: rank holders and holders of the roles that give a rank on the main
	// server, with their roles there. Read once for a sync of several servers.
	async function holdersOfMain() {
		const mainId = await network.getMainId();
		const holders = new Set((await q.direct.all()).map(r => r.discord_id));
		const mainRolesOf = new Map();
		if (mainId) {
			const sourceRoles = new Set([...(await linksOf(mainId)).values()].flat());
			for (const [userId, roles] of Object.entries(await snapshot(mainId, [...sourceRoles], [...holders]))) {
				mainRolesOf.set(userId, roles);
				if (roles.some(r => sourceRoles.has(r))) holders.add(userId);
			}
		}
		return { holders, mainRolesOf };
	}

	// One server: order of its network roles, then the members whose roles differ from what they should hold.
	// A server already in sync costs one read of its member list and no change.
	async function syncGuild(guildId, shared = null) {
		const aligned = await alignRoles(guildId);
		const links = await linksOf(guildId, { syncedOnly: true });
		const mirror = await mirrorOf(guildId);
		if (!links.size && !mirror.size) return { aligned, changed: 0 };
		shared ??= await holdersOfMain();
		const roleIds = [...links.values()].flat().concat([...mirror.values()].map(m => m.roleId));
		let changed = 0;
		for (const [userId, current] of Object.entries(await snapshot(guildId, roleIds, [...shared.holders]))) {
			const result = await syncMember(guildId, userId, { mirror, links, current, mainRoles: shared.mainRolesOf.get(userId) ?? [] }).catch(() => null);
			if (result && (result.added.length || result.removed.length)) changed++;
		}
		return { aligned, changed };
	}

	async function syncUser(userId) {
		const results = {};
		for (const guildId of await satelliteIds()) results[guildId] = await syncMember(guildId, userId).catch(e => ({ error: e.message }));
		return results;
	}

	async function syncEverything() {
		const shared = await holdersOfMain();
		let changed = 0;
		const order = [];
		for (const guildId of await satelliteIds()) {
			const result = await syncGuild(guildId, shared);
			if (result.aligned) order.push(result.aligned);
			changed += result.changed;
		}
		return { changed, order };
	}

	// One sync at a time: two running together would give and take the same roles twice
	let chain = Promise.resolve();
	const exclusive = (work) => {
		const result = chain.then(work, work);
		chain = result.catch(() => undefined);
		return result;
	};

	// --- what has to be redone, gathered for a moment then done once ------------------------------------------------
	const ownMoves = new Map();
	const pending = { all: false, guilds: new Set(), users: new Set(), order: new Set() };
	let timer = null;

	async function flush() {
		clearTimeout(timer);
		timer = null;
		const todo = { all: pending.all, guilds: [...pending.guilds], users: [...pending.users], order: [...pending.order] };
		pending.all = false;
		for (const set of [pending.guilds, pending.users, pending.order]) set.clear();
		if (!todo.all && !todo.guilds.length && !todo.users.length && !todo.order.length) return;
		await exclusive(async () => {
			if (todo.all) return void await syncEverything();
			const satellites = new Set(await satelliteIds());
			const guilds = todo.guilds.filter(id => satellites.has(id));
			const shared = guilds.length ? await holdersOfMain() : null;
			for (const guildId of guilds) await syncGuild(guildId, shared);
			// Members: only on the servers that were not just redone as a whole
			for (const userId of todo.users) {
				for (const guildId of satellites) if (!guilds.includes(guildId)) await syncMember(guildId, userId).catch(() => null);
			}
			for (const guildId of todo.order) if (satellites.has(guildId) && !guilds.includes(guildId)) await alignRoles(guildId);
		}).catch(error => logger.error('Staff sync failed:', error));
	}

	// { all: true } | { guilds: [id] } | { users: [id] } | { order: [guildId] }: done together a moment later,
	// and only that (a change on one server never redoes the others)
	function schedule(what = {}) {
		if (what.all) pending.all = true;
		for (const key of ['guilds', 'users', 'order']) for (const id of what[key] ?? []) pending[key].add(String(id));
		// Not pushed back by each new change: a burst of changes waits `delayMs` at most
		if (timer) return;
		timer = setTimeout(() => void flush(), delayMs);
		timer.unref?.();
	}

	return {
		linksOf,
		syncMember,
		syncGuild: guildId => exclusive(() => syncGuild(guildId)),
		schedule,
		flush,

		// A role was created, renamed or moved on Discord. Roles are mirrored by name from the main server, and the
		// order of the network roles follows it: a change there concerns every server, a change elsewhere only that one.
		async roleChanged(guildId, { renamed = false, moved = false } = {}) {
			const mainId = await network.getMainId();
			if (!mainId || (await network.find(guildId))?.status !== 'active') return;
			if (renamed) return schedule(guildId === mainId ? { all: true } : { guilds: [guildId] });
			if (!moved) return;
			// The bot's own reordering comes back as "role moved" events: they ask for nothing
			if ((ownMoves.get(guildId) ?? 0) > now()) return;
			schedule({ order: guildId === mainId ? await satelliteIds() : [guildId] });
		},

		// Links of every rank on every server (main server links = roles that grant the rank)
		async overview() {
			const guilds = (await network.list()).filter(g => g.status === 'active' && g.botPresent);
			return Promise.all(guilds.map(async g => {
				const mirrored = {};
				for (const { rankId, roleId } of (await mirrorOf(g.id)).values()) (mirrored[rankId] ??= []).push(roleId);
				return { id: g.id, name: g.name, isMain: g.isMain, links: Object.fromEntries(await linksOf(g.id)), mirrored };
			}));
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
		// (color, display, mentions, permissions). The rank links follow. On a server other than the main one
		// they join the network roles: same order as the main server, above the server's own roles.
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
			const copied = results.filter(r => r.targetId).map(r => r.targetId);
			let order = null;
			if (to !== mainId && copied.length) {
				const known = await settings.get(COPIED_KEY, {});
				await settings.set(COPIED_KEY, { ...known, [to]: [...new Set([...known[to] ?? [], ...copied])] });
				order = await alignRoles(to);
			}
			const [fromGuild, toGuild] = await Promise.all([network.find(from), network.find(to)]);
			const names = status => results.filter(r => r.status === status).map(r => r.name);
			await audit.record({
				actorId: actor.id, source: actor.source ?? 'panel', action: 'staff_sync.copy_roles', guildId: to, target: toGuild?.name ?? to,
				details: { depuis: fromGuild?.name ?? from, créés: names('created'), 'mis à jour': names('updated'), échecs: names('error') },
			});
			return { results, order };
		},

		// One member, every server (e.g. their roles changed on the main server)
		syncUser,

		// Everybody concerned, on every server: rank holders and current holders of linked roles
		syncAll: () => exclusive(syncEverything),
	};
}
