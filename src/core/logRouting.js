import { ForbiddenError, ValidationError } from './errors.js';

// guild_id used for the network mirror (a channel on the main server receiving logs of every server)
export const MIRROR = '*';

// Discord errors meaning "this channel can't receive logs anymore"
const DEAD_CHANNEL_CODES = new Set([10003, 50001, 50013]);

// Each log belongs to a category; each server routes each category to its own channel.
// Messages are plain objects ({ title, description, fields, color }) turned into embeds by the executor.
export function createLogRouting({ db, executor, network, audit, logger = console }) {
	const categories = new Map();
	const queues = new Map();

	const q = {
		routes: db.prepare('SELECT category, channel_id, enabled FROM log_routes WHERE guild_id = ? ORDER BY category'),
		route: db.prepare('SELECT channel_id, enabled FROM log_routes WHERE guild_id = ? AND category = ?'),
		upsert: db.prepare(`
			INSERT INTO log_routes (guild_id, category, channel_id, enabled) VALUES (?, ?, ?, ?)
			ON CONFLICT(guild_id, category) DO UPDATE SET channel_id = excluded.channel_id, enabled = excluded.enabled
		`),
		delete: db.prepare('DELETE FROM log_routes WHERE guild_id = ? AND category = ?'),
		disableChannel: db.prepare('UPDATE log_routes SET enabled = 0 WHERE channel_id = ?'),
	};

	function registerCategory(key, label) {
		categories.set(key, { key, label });
	}

	registerCategory('network', 'Réseau (serveurs ajoutés, retirés, serveur principal)');
	registerCategory('ranks', 'Rangs et permissions');
	registerCategory('panel', 'Panel (connexions, accès refusés, sessions)');
	registerCategory('system', 'Système (démarrage, crash, versions)');
	registerCategory('logs', 'Configuration des logs');

	// Sequential sends per channel: keeps order and plays nicely with rate limits
	function enqueue(channelId, task) {
		const previous = queues.get(channelId) ?? Promise.resolve();
		const next = previous.then(task, task).finally(() => {
			if (queues.get(channelId) === next) queues.delete(channelId);
		});
		queues.set(channelId, next);
		return next;
	}

	async function send(channelId, category, message) {
		try {
			await executor.sendLog(channelId, message);
		}
		catch (error) {
			if (!DEAD_CHANNEL_CODES.has(error?.code)) {
				logger.warn(`Unable to send a "${category}" log to channel ${channelId}:`, error?.message ?? error);
				return;
			}
			q.disableChannel.run(channelId);
			logger.warn(`Log channel ${channelId} is not reachable anymore (${error.code}), its routes were disabled.`);
			if (category !== 'system') {
				log(null, 'system', {
					title: 'Salon de logs désactivé',
					description: `Le salon <#${channelId}> n'est plus accessible (code ${error.code}). Ses routes de logs ont été désactivées.`,
					color: 'warning',
				});
			}
		}
	}

	function activeRoute(guildId, category) {
		const row = q.route.get(guildId, category);
		return row && row.enabled === 1 ? row.channel_id : null;
	}

	// guildId null = network-level event, logged on the main server
	function log(guildId, category, message) {
		const mainId = network.getMainId();
		const target = guildId ?? mainId;
		const sent = [];
		if (!target) return sent;

		const channelId = activeRoute(target, category);
		if (channelId) {
			sent.push(channelId);
			enqueue(channelId, () => send(channelId, category, message));
		}

		const mirrorId = activeRoute(MIRROR, category);
		if (mirrorId && target !== mainId && mirrorId !== channelId) {
			const guildName = network.find(target)?.name ?? target;
			const mirrored = { ...message, title: `[${guildName}] ${message.title ?? ''}`.trim() };
			sent.push(mirrorId);
			enqueue(mirrorId, () => send(mirrorId, category, mirrored));
		}
		return sent;
	}

	return {
		registerCategory,
		log,

		categories() {
			return [...categories.values()];
		},

		routes(guildId) {
			return q.routes.all(guildId).map(r => ({ category: r.category, channelId: r.channel_id, enabled: r.enabled === 1 }));
		},

		// channelId null removes the route
		async setRoute(actor, guildId, category, channelId, enabled = true) {
			if (!actor.can('logs.manage')) throw new ForbiddenError('Missing permission: logs.manage');
			if (!categories.has(category)) throw new ValidationError(`Unknown log category: ${category}`);
			const ownerGuild = guildId === MIRROR ? network.getMainId() : guildId;
			if (!ownerGuild) throw new ValidationError('Choose the main server first.');
			if (guildId !== MIRROR && !network.find(guildId)) throw new ValidationError('Unknown server.');

			if (channelId === null) {
				q.delete.run(guildId, category);
			}
			else {
				const channel = await executor.getTextChannel(ownerGuild, channelId);
				if (!channel) throw new ValidationError('This channel does not exist on this server or the bot cannot write in it.');
				q.upsert.run(guildId, category, channelId, enabled ? 1 : 0);
			}

			audit?.record({
				actorId: actor.id,
				source: actor.source ?? 'panel',
				action: 'logs.route',
				guildId: ownerGuild,
				target: category,
				details: { mirror: guildId === MIRROR, channelId, enabled },
			});
			return this.routes(guildId);
		},

		// Resolves once every queued message has been handled (tests, graceful shutdown)
		async flush() {
			while (queues.size) await Promise.allSettled([...queues.values()]);
		},
	};
}
