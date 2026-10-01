import { ForbiddenError, ValidationError } from './errors.js';
import { LOG_PACKS } from './logCatalog.js';

// guild_id used for the network mirror (a channel on the main server receiving logs of every server)
export const MIRROR = '*';

// Discord errors meaning "this channel can't receive logs anymore"
const DEAD_CHANNEL_CODES = new Set([10003, 50001, 50013]);
// Channel of a type route that turns that type off
export const OFF = '0';

// Each log belongs to a category (and a type within it); each server routes each category to a channel,
// and may send one type elsewhere or turn it off ("messages:message_delete" routes override "messages").
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

	function registerCategory(key, label, types = {}) {
		const known = categories.get(key)?.types ?? {};
		categories.set(key, { key, label, types: { ...known, ...types } });
	}

	// Types a category can carry: { type: label }
	function registerTypes(key, types) {
		const category = categories.get(key);
		if (category) category.types = { ...category.types, ...types };
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

	// "Rangs et permissions" for the footer of a log, the type label when there is one
	function shortLabel(category) {
		return categories.get(category)?.label?.replace(/\s*\(.*\)$/, '') ?? category;
	}

	// The type route wins over the category route (a disabled type route = that type is not logged)
	function activeRoute(guildId, category, type = null) {
		const row = (type && q.route.get(guildId, `${category}:${type}`)) || q.route.get(guildId, category);
		return row && row.enabled === 1 && row.channel_id !== OFF ? row.channel_id : null;
	}

	// guildId null = network-level event, logged on the main server
	function log(guildId, category, message, type = null) {
		const mainId = network.getMainId();
		const target = guildId ?? mainId;
		const sent = [];
		if (!target) return sent;
		// The category (emoji, footer) travels with the message
		message = { categoryLabel: shortLabel(category), ...message, category, type };

		const channelId = activeRoute(target, category, type);
		if (channelId) {
			sent.push(channelId);
			enqueue(channelId, () => send(channelId, category, message));
		}

		const mirrorId = activeRoute(MIRROR, category, type);
		if (mirrorId && target !== mainId && mirrorId !== channelId) {
			const guildName = network.find(target)?.name ?? target;
			const mirrored = { ...message, title: `[${guildName}] ${message.title ?? ''}`.trim() };
			sent.push(mirrorId);
			enqueue(mirrorId, () => send(mirrorId, category, mirrored));
		}
		return sent;
	}

	function checkTarget(actor, guildId) {
		if (!actor.can('logs.manage')) throw new ForbiddenError('Permission manquante : logs.manage');
		const ownerGuild = guildId === MIRROR ? network.getMainId() : guildId;
		if (!ownerGuild) throw new ValidationError('Choisis d’abord le serveur principal.');
		if (guildId !== MIRROR && !network.find(guildId)) throw new ValidationError('Serveur inconnu.');
		return ownerGuild;
	}

	return {
		registerCategory,
		registerTypes,
		log,
		activeRoute,

		categories() {
			return [...categories.values()].map(c => ({ ...c, types: Object.entries(c.types).map(([key, label]) => ({ key, label })) }));
		},

		packs: () => Object.entries(LOG_PACKS).map(([key, p]) => ({ key, label: p.label, hint: p.hint, channels: p.channels.map(c => c.name) })),

		// Creates (or reuses) a private "logs" category with the pack's channels, then routes every category there.
		// Routes of single types are kept. staffRoleIds: roles that may read the logs.
		async applyPack(actor, guildId, packKey, { categoryName = 'Logs', staffRoleIds = [] } = {}) {
			if (guildId === MIRROR) throw new ValidationError('Les packs s’appliquent à un serveur, pas au miroir.');
			checkTarget(actor, guildId);
			const pack = LOG_PACKS[packKey];
			if (!pack) throw new ValidationError('Pack de logs inconnu.');
			const name = String(categoryName).trim().slice(0, 100) || 'Logs';
			const created = await executor.createLogChannels(guildId, { categoryName: name, channels: pack.channels.map(c => c.name), staffRoleIds });
			const listed = new Set(pack.channels.flatMap(c => c.categories));
			const rest = pack.channels.find(c => c.rest);
			const plan = new Map();
			for (const c of pack.channels) for (const category of c.categories) if (categories.has(category)) plan.set(category, created.channels[c.name]);
			if (rest) for (const key of categories.keys()) if (!listed.has(key)) plan.set(key, created.channels[rest.name]);
			db.transaction(() => {
				for (const [category, channelId] of plan) q.upsert.run(guildId, category, channelId, 1);
			})();
			audit?.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'logs.pack', guildId, target: packKey, details: { pack: pack.label, channels: pack.channels.length, categories: plan.size, created: created.createdCount } });
			return { routes: this.routes(guildId), created: created.createdCount, channels: created.channels };
		},

		// Every category routed to one existing channel (types routed apart are kept)
		async routeAll(actor, guildId, channelId) {
			const ownerGuild = checkTarget(actor, guildId);
			const channel = await executor.getTextChannel(ownerGuild, channelId);
			if (!channel) throw new ValidationError('Ce salon n’existe pas sur ce serveur, ou le bot ne peut pas y écrire.');
			db.transaction(() => {
				for (const key of categories.keys()) q.upsert.run(guildId, key, channelId, 1);
			})();
			audit?.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'logs.route', guildId: ownerGuild, target: '*', details: { mirror: guildId === MIRROR, channelId, all: true } });
			return this.routes(guildId);
		},

		routes(guildId) {
			return q.routes.all(guildId).map(r => ({ category: r.category, channelId: r.channel_id, enabled: r.enabled === 1 }));
		},

		// channelId null removes the route; "category:type" routes one type apart, OFF turns that type off
		async setRoute(actor, guildId, category, channelId, enabled = true) {
			const [base, type] = category.split(':');
			if (!categories.has(base) || category.split(':').length > 2) throw new ValidationError(`Catégorie de logs inconnue : ${category}`);
			if (type !== undefined && !/^[a-z0-9_]{1,40}$/.test(type)) throw new ValidationError(`Type de log invalide : ${type}`);
			if (channelId === OFF && !type) throw new ValidationError('Pour couper une catégorie entière, retire son salon.');
			const ownerGuild = checkTarget(actor, guildId);

			if (channelId === null) {
				q.delete.run(guildId, category);
			}
			else if (channelId === OFF) {
				q.upsert.run(guildId, category, OFF, 0);
			}
			else {
				const channel = await executor.getTextChannel(ownerGuild, channelId);
				if (!channel) throw new ValidationError('Ce salon n’existe pas sur ce serveur, ou le bot ne peut pas y écrire.');
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
