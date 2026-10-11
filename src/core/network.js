import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

// Servers the bot is in. A server only becomes part of the network when someone with
// network.manage activates it from the panel: inviting the bot is never enough.
export function createNetwork({ db, audit, now = Date.now }) {
	const q = {
		all: db.prepare('SELECT * FROM guilds ORDER BY is_main DESC, status, name'),
		get: db.prepare('SELECT * FROM guilds WHERE id = ?'),
		main: db.prepare('SELECT * FROM guilds WHERE is_main = 1'),
		insert: db.prepare(`
			INSERT INTO guilds (id, name, icon, status, is_main, bot_present, first_seen_at, updated_at)
			VALUES (@id, @name, @icon, 'pending', 0, 1, @at, @at)
		`),
		seen: db.prepare('UPDATE guilds SET name = @name, icon = @icon, bot_present = 1, updated_at = @at WHERE id = @id'),
		left: db.prepare('UPDATE guilds SET bot_present = 0, status = \'removed\', updated_at = ? WHERE id = ?'),
		status: db.prepare('UPDATE guilds SET status = ?, joined_network_at = ?, updated_at = ? WHERE id = ?'),
		clearMain: db.prepare('UPDATE guilds SET is_main = 0 WHERE is_main = 1'),
		setMain: db.prepare('UPDATE guilds SET is_main = 1, updated_at = ? WHERE id = ?'),
	};
	const listeners = { activated: new Set(), removed: new Set(), mainChanged: new Set() };
	let mainCache;

	function toGuild(row) {
		if (!row) return null;
		return {
			id: row.id,
			name: row.name,
			icon: row.icon,
			status: row.status,
			isMain: row.is_main === 1,
			botPresent: row.bot_present === 1,
			joinedNetworkAt: row.joined_network_at,
			firstSeenAt: row.first_seen_at,
		};
	}

	async function getOrThrow(id) {
		const guild = toGuild(await q.get.get(String(id)));
		if (!guild) throw new NotFoundError('Serveur introuvable.');
		return guild;
	}

	function requireManage(actor) {
		if (!actor.can('network.manage')) throw new ForbiddenError('Permission manquante : network.manage');
	}

	function emit(event, payload) {
		for (const listener of listeners[event]) {
			try {
				Promise.resolve(listener(payload)).catch(() => undefined);
			}
			catch {
				// A listener never breaks the change itself
			}
		}
	}

	function record(actor, action, guild, details = null) {
		return audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId: guild.id, target: guild.id, details: { name: guild.name, ...details } });
	}

	return {
		async list() {
			return (await q.all.all()).map(toGuild);
		},

		get: getOrThrow,

		async find(id) {
			return toGuild(await q.get.get(String(id)));
		},

		async getMain() {
			if (mainCache === undefined) mainCache = toGuild(await q.main.get());
			return mainCache;
		},

		async getMainId() {
			return (await this.getMain())?.id ?? null;
		},

		// Another process (bot or API) changed the servers
		invalidate() {
			mainCache = undefined;
		},

		async activeIds() {
			return (await q.all.all()).filter(r => r.status === 'active' && r.bot_present === 1).map(r => r.id);
		},

		// Called by the bot for every server it is in (startup and guildCreate)
		async upsertSeen({ id, name, icon = null }) {
			const at = now();
			const existing = await q.get.get(id);
			if (existing) {
				await q.seen.run({ id, name, icon, at });
				if (existing.bot_present === 0) {
					await audit.record({ actorId: 'system', source: 'system', action: 'network.bot_joined', guildId: id, target: id, details: { name } });
				}
			}
			else {
				await q.insert.run({ id, name, icon, at });
				await audit.record({ actorId: 'system', source: 'system', action: 'network.bot_joined', guildId: id, target: id, details: { name } });
			}
			mainCache = undefined;
			return getOrThrow(id);
		},

		// The bot was kicked or the server was deleted
		async markLeft(id) {
			const guild = toGuild(await q.get.get(String(id)));
			if (!guild) return null;
			await q.left.run(now(), guild.id);
			mainCache = undefined;
			await audit.record({ actorId: 'system', source: 'system', action: 'network.bot_left', guildId: guild.id, target: guild.id, details: { name: guild.name, wasMain: guild.isMain } });
			if (guild.status === 'active') emit('removed', guild);
			return getOrThrow(guild.id);
		},

		async activate(actor, id) {
			requireManage(actor);
			const guild = await getOrThrow(id);
			if (!guild.botPresent) throw new ValidationError('Le bot n’est plus sur ce serveur.');
			if (guild.status === 'active') return guild;
			await q.status.run('active', now(), now(), guild.id);
			mainCache = undefined;
			await record(actor, 'network.add', guild);
			const activated = await getOrThrow(guild.id);
			emit('activated', activated);
			return activated;
		},

		async remove(actor, id) {
			requireManage(actor);
			const guild = await getOrThrow(id);
			if (guild.isMain) throw new ValidationError('Le serveur principal ne peut pas être retiré. Choisis d’abord un autre serveur principal.');
			if (guild.status === 'removed') return guild;
			const wasActive = guild.status === 'active';
			await q.status.run('removed', guild.joinedNetworkAt, now(), guild.id);
			mainCache = undefined;
			await record(actor, 'network.remove', guild);
			const removed = await getOrThrow(guild.id);
			if (wasActive) emit('removed', removed);
			return removed;
		},

		// The main server is always active; staff roles and permissions are managed from it
		async setMain(actor, id) {
			requireManage(actor);
			const guild = await getOrThrow(id);
			if (!guild.botPresent) throw new ValidationError('Le bot n’est plus sur ce serveur.');
			const previous = await this.getMain();
			if (previous?.id === guild.id) return guild;

			await db.transaction(async () => {
				await q.clearMain.run();
				await q.setMain.run(now(), guild.id);
				if (guild.status !== 'active') await q.status.run('active', now(), now(), guild.id);
			})();
			mainCache = undefined;
			await record(actor, 'network.main', guild, previous ? { previous: { id: previous.id, name: previous.name } } : null);
			const main = await getOrThrow(guild.id);
			emit('mainChanged', { main, previous });
			if (guild.status !== 'active') emit('activated', main);
			return main;
		},

		on(event, listener) {
			listeners[event].add(listener);
			return () => listeners[event].delete(listener);
		},
	};
}
