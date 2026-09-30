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

	function getOrThrow(id) {
		const guild = toGuild(q.get.get(String(id)));
		if (!guild) throw new NotFoundError('Server not found.');
		return guild;
	}

	function requireManage(actor) {
		if (!actor.can('network.manage')) throw new ForbiddenError('Missing permission: network.manage');
	}

	function emit(event, payload) {
		for (const listener of listeners[event]) listener(payload);
	}

	function record(actor, action, guild, details = null) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId: guild.id, target: guild.id, details: { name: guild.name, ...details } });
	}

	return {
		list() {
			return q.all.all().map(toGuild);
		},

		get: getOrThrow,

		find(id) {
			return toGuild(q.get.get(String(id)));
		},

		getMain() {
			if (mainCache === undefined) mainCache = toGuild(q.main.get());
			return mainCache;
		},

		getMainId() {
			return this.getMain()?.id ?? null;
		},

		activeIds() {
			return q.all.all().filter(r => r.status === 'active' && r.bot_present === 1).map(r => r.id);
		},

		// Called by the bot for every server it is in (startup and guildCreate)
		upsertSeen({ id, name, icon = null }) {
			const at = now();
			const existing = q.get.get(id);
			if (existing) {
				q.seen.run({ id, name, icon, at });
				if (existing.bot_present === 0) {
					audit.record({ actorId: 'system', source: 'system', action: 'network.bot_joined', guildId: id, target: id, details: { name } });
				}
			}
			else {
				q.insert.run({ id, name, icon, at });
				audit.record({ actorId: 'system', source: 'system', action: 'network.bot_joined', guildId: id, target: id, details: { name } });
			}
			mainCache = undefined;
			return getOrThrow(id);
		},

		// The bot was kicked or the server was deleted
		markLeft(id) {
			const guild = toGuild(q.get.get(String(id)));
			if (!guild) return null;
			q.left.run(now(), guild.id);
			mainCache = undefined;
			audit.record({ actorId: 'system', source: 'system', action: 'network.bot_left', guildId: guild.id, target: guild.id, details: { name: guild.name, wasMain: guild.isMain } });
			if (guild.status === 'active') emit('removed', guild);
			return getOrThrow(guild.id);
		},

		activate(actor, id) {
			requireManage(actor);
			const guild = getOrThrow(id);
			if (!guild.botPresent) throw new ValidationError('The bot is not on this server anymore.');
			if (guild.status === 'active') return guild;
			q.status.run('active', now(), now(), guild.id);
			mainCache = undefined;
			record(actor, 'network.add', guild);
			const activated = getOrThrow(guild.id);
			emit('activated', activated);
			return activated;
		},

		remove(actor, id) {
			requireManage(actor);
			const guild = getOrThrow(id);
			if (guild.isMain) throw new ValidationError('The main server cannot be removed. Choose another main server first.');
			if (guild.status === 'removed') return guild;
			const wasActive = guild.status === 'active';
			q.status.run('removed', guild.joinedNetworkAt, now(), guild.id);
			record(actor, 'network.remove', guild);
			const removed = getOrThrow(guild.id);
			if (wasActive) emit('removed', removed);
			return removed;
		},

		// The main server is always active; staff roles and permissions are managed from it
		setMain(actor, id) {
			requireManage(actor);
			const guild = getOrThrow(id);
			if (!guild.botPresent) throw new ValidationError('The bot is not on this server anymore.');
			const previous = this.getMain();
			if (previous?.id === guild.id) return guild;

			db.transaction(() => {
				q.clearMain.run();
				q.setMain.run(now(), guild.id);
				if (guild.status !== 'active') q.status.run('active', now(), now(), guild.id);
			})();
			mainCache = undefined;
			record(actor, 'network.main', guild, previous ? { previous: { id: previous.id, name: previous.name } } : null);
			const main = getOrThrow(guild.id);
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
