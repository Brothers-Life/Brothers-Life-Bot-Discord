import { ForbiddenError, ValidationError } from './errors.js';
import { snowflakeTime } from './memberInsights.js';

const NEW_ACCOUNT_MS = 30 * 86_400_000;

// Looking up and editing members across the network (roles, nickname)
export function createMembers({ db, network, ranks, sanctions, audit, executor }) {
	const linkedRoles = db.prepare('SELECT DISTINCT role_id FROM rank_roles WHERE guild_id = ?');

	async function checkTarget(actor, guildId, userId, permission = 'members.manage') {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
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
		// Shared with the moderation commands (/role, /nick), which have their own permissions
		assertCanEdit: checkTarget,
		assertGivableRole: checkRole,

		// By Discord ID, or by the beginning of a username / display name / nickname on any network server
		async search(query, limit = 10) {
			const text = String(query ?? '').trim().replace(/^@/, '');
			if (!text) return [];
			if (/^\d{17,20}$/.test(text)) {
				const user = await executor.getUser(text).catch(() => null);
				return user ? [{ ...user, nickname: null, guilds: [] }] : [];
			}
			if (text.length < 2) return [];

			const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
			const found = new Map();
			const results = await Promise.all(guilds.map(g => executor.searchMembers(g.id, text, limit).then(list => [g, list]).catch(() => [g, []])));
			for (const [guild, list] of results) {
				for (const member of list) {
					const entry = found.get(member.id) ?? { ...member, guilds: [] };
					entry.guilds.push(guild.name);
					found.set(member.id, entry);
				}
			}

			// Exact names first, then names starting with the text
			const lower = text.toLowerCase();
			const score = (m) => {
				const names = [m.username, m.globalName, m.nickname].filter(Boolean).map(n => n.toLowerCase());
				if (names.includes(lower)) return 0;
				if (names.some(n => n.startsWith(lower))) return 1;
				return 2;
			};
			return [...found.values()].sort((a, b) => score(a) - score(b) || a.username.localeCompare(b.username)).slice(0, limit);
		},

		// Everyone on the network, one entry per person, sorted by name; `q` matches anywhere in a name or the ID
		// filter: boosters, voice (in a voice channel now), new (account under 30 days), timedout
		async directory({ q = '', guildId = null, bots = false, filter = null, offset = 0, limit = 50 } = {}) {
			const active = network.list().filter(g => g.status === 'active' && g.botPresent);
			const guilds = active.filter(g => !guildId || g.id === guildId);
			const lists = await Promise.all(guilds.map(g => executor.listMembers(g.id).then(list => [g, list]).catch(() => [g, []])));
			const people = new Map();
			for (const [guild, list] of lists) {
				for (const member of list) {
					if (member.bot && !bots) continue;
					const entry = people.get(member.id) ?? { ...member, accountCreatedAt: snowflakeTime(member.id), guilds: [] };
					entry.nickname ??= member.nickname;
					entry.boosting ||= Boolean(member.boosting);
					entry.inVoice ||= Boolean(member.inVoice);
					entry.timedOut ||= Boolean(member.timedOut);
					entry.topRole ??= member.topRole ?? null;
					entry.guilds.push({ id: guild.id, name: guild.name });
					people.set(member.id, entry);
				}
			}
			const text = String(q).trim().replace(/^@/, '').toLowerCase();
			const nameOf = (m) => (m.nickname || m.globalName || m.username || '').toLowerCase();
			const all = [...people.values()]
				.filter(m => !text || m.id === text || [m.username, m.globalName, m.nickname].some(n => n?.toLowerCase().includes(text)))
				.filter(m => !filter
					|| (filter === 'boosters' && m.boosting)
					|| (filter === 'voice' && m.inVoice)
					|| (filter === 'timedout' && m.timedOut)
					|| (filter === 'new' && Date.now() - (m.accountCreatedAt ?? 0) < NEW_ACCOUNT_MS))
				.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'fr') || a.id.localeCompare(b.id));
			const items = all.slice(offset, offset + limit);
			return { guilds: active.map(g => ({ id: g.id, name: g.name })), items, total: all.length, nextOffset: offset + items.length < all.length ? offset + items.length : null };
		},

		async lookup(userId) {
			const user = (await executor.getUserProfile?.(userId)) ?? await executor.getUser(userId);
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

		async setNickname(actor, guildId, userId, nickname, permission = 'members.manage') {
			await checkTarget(actor, guildId, userId, permission);
			if (nickname !== null && (typeof nickname !== 'string' || nickname.length > 32)) throw new ValidationError('Le pseudo fait 32 caractères maximum.');
			await executor.setNickname(guildId, userId, nickname || null, `Panel : ${actor.id}`);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'members.nickname', guildId, target: userId, details: { nickname: nickname || null } });
		},
	};
}
