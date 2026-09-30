import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';

definePermission('events.view', { label: 'Voir les événements des serveurs', category: 'Logs' });

export const EVENT_CATEGORIES = {
	messages: 'Messages (modifiés, supprimés)',
	members: 'Membres (arrivées, départs, pseudos)',
	member_roles: 'Rôles donnés ou retirés aux membres',
	roles: 'Rôles du serveur (créés, modifiés, supprimés)',
	channels: 'Salons (créés, modifiés, supprimés)',
	voice: 'Vocal (arrivées, départs, changements)',
	invites: 'Invitations',
	server: 'Serveur et émojis',
};

const DEFAULT_RETENTION_DAYS = 30;
const DAY = 86_400_000;

// Server events (messages, members, roles, channels...): stored for the panel search
// and posted in the log channel of their category.
export function createEvents({ db, network, logs, settings, now = Date.now }) {
	for (const [key, label] of Object.entries(EVENT_CATEGORIES)) logs.registerCategory(key, label);

	const insert = db.prepare(`
		INSERT INTO events (at, guild_id, category, type, user_id, actor_id, channel_id, summary, details)
		VALUES (@at, @guildId, @category, @type, @userId, @actorId, @channelId, @summary, @details)
	`);

	function toEvent(row) {
		return {
			id: row.id,
			at: row.at,
			guildId: row.guild_id,
			category: row.category,
			type: row.type,
			userId: row.user_id,
			actorId: row.actor_id,
			channelId: row.channel_id,
			summary: row.summary,
			details: row.details ? JSON.parse(row.details) : null,
		};
	}

	// Servers being rebuilt from a template: their hundreds of changes are not logged one by one
	const muted = new Set();

	return {
		categories: () => EVENT_CATEGORIES,

		mute(guildId, on = true) {
			if (on) muted.add(guildId);
			else muted.delete(guildId);
		},

		// message: the log embed ({ title, description, fields, color }); built by the bot layer
		record({ guildId, category, type, userId = null, actorId = null, channelId = null, summary, details = null, message = null }) {
			if (!EVENT_CATEGORIES[category]) throw new Error(`Unknown event category: ${category}`);
			if (network.find(guildId)?.status !== 'active' || muted.has(guildId)) return null;
			const { lastInsertRowid } = insert.run({
				at: now(), guildId, category, type, userId, actorId, channelId,
				summary: summary.slice(0, 500),
				details: details ? JSON.stringify(details) : null,
			});
			logs.log(guildId, category, message ?? { title: summary });
			return Number(lastInsertRowid);
		},

		query({ guildId, category, userId, q, from, to, before, limit = 50 } = {}) {
			const params = {
				guildId, category, userId, from, to, before,
				q: q ? `%${String(q).replace(/[%_\\]/g, '\\$&')}%` : undefined,
				limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
			};
			const where = [
				guildId && 'guild_id = @guildId',
				category && 'category = @category',
				userId && '(user_id = @userId OR actor_id = @userId)',
				q && '(summary LIKE @q ESCAPE \'\\\' OR details LIKE @q ESCAPE \'\\\')',
				from && 'at >= @from',
				to && 'at <= @to',
				before && 'id < @before',
			].filter(Boolean);
			const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT @limit`;
			return db.prepare(sql).all(params).map(toEvent);
		},

		retentionDays() {
			return settings.get('events.retentionDays', DEFAULT_RETENTION_DAYS);
		},

		setRetention(actor, days) {
			if (!actor.can('logs.manage')) throw new ForbiddenError('Permission manquante : logs.manage');
			if (!Number.isInteger(days) || days < 1 || days > 365) throw new ValidationError('La durée de conservation doit être entre 1 et 365 jours.');
			settings.set('events.retentionDays', days);
		},

		purge() {
			return db.prepare('DELETE FROM events WHERE at < ?').run(now() - this.retentionDays() * DAY).changes;
		},
	};
}
