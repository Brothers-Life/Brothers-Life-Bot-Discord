import { ValidationError } from './errors.js';

const DAY_MS = 24 * 3600_000;
// Notifications older than this are purged
export const RETENTION_DAYS = 30;
// How many recent notifications are looked at to build someone's list
const SCAN = 300;
const URL_PATTERN = /^\/[A-Za-z0-9/_\-.?=&%#]*$/;

// Built-in types; other features add theirs with registerType (or push with type 'other')
const BUILTIN_TYPES = [
	['ticket_new', { label: 'Nouveaux tickets', permission: 'tickets.view' }],
	['ticket_assigned', { label: 'Tickets qui me sont transférés', permission: 'tickets.view' }],
	['ticket_reply', { label: 'Réponses dans mes tickets', permission: 'tickets.view' }],
	['application_new', { label: 'Nouvelles candidatures', permission: 'recruitment.view' }],
	['feedback_new', { label: 'Suggestions et bugs à traiter', permission: 'feedback.manage' }],
	['appeal_new', { label: 'Appels de sanction', permission: 'appeals.view' }],
	['absence_request', { label: 'Absences à valider', permission: 'absences.manage' }],
	['antiraid', { label: 'Anti-raid déclenché', permission: 'antiraid.view' }],
	['antinuke', { label: 'Anti-nuke : compte mis en quarantaine', permission: 'antinuke.view' }],
	['ticket_sla', { label: 'Tickets en retard (SLA dépassé)', permission: 'tickets.view' }],
	['tebex_unlinked', { label: 'Achats boutique à relier', permission: 'tebex.view' }],
	['other', { label: 'Autres', permission: null }],
];

// Panel notification center. A notification is aimed at a permission (everyone who holds it)
// and/or at one user; the list of each user is filtered when read, so permission changes apply at once.
export function createNotifications({ db, now = Date.now }) {
	const types = new Map(BUILTIN_TYPES);
	const listeners = new Set();
	let lastPurge = 0;

	const q = {
		insert: db.prepare(`
			INSERT INTO panel_notifications (type, title, body, url, guild_id, permission, user_id, actor_id, created_at)
			VALUES (@type, @title, @body, @url, @guildId, @permission, @userId, @actorId, @at)
		`),
		recent: db.prepare('SELECT * FROM panel_notifications WHERE (user_id IS NULL OR user_id = ?) AND created_at >= ? ORDER BY id DESC LIMIT ?'),
		reads: db.prepare('SELECT notification_id FROM panel_notification_reads WHERE user_id = ? AND notification_id > ?'),
		read: db.prepare('INSERT IGNORE INTO panel_notification_reads (notification_id, user_id) SELECT id, ? FROM panel_notifications WHERE id = ?'),
		prefs: db.prepare('SELECT * FROM panel_notification_prefs WHERE user_id = ?'),
		setDisabled: db.prepare('INSERT INTO panel_notification_prefs (user_id, disabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE disabled = VALUES(disabled)'),
		setReadUpTo: db.prepare('INSERT INTO panel_notification_prefs (user_id, read_up_to) VALUES (?, ?) ON DUPLICATE KEY UPDATE read_up_to = GREATEST(read_up_to, VALUES(read_up_to))'),
		purge: db.prepare('DELETE FROM panel_notifications WHERE created_at < ?'),
		lastId: db.prepare('SELECT MAX(id) AS id FROM panel_notifications'),
	};

	function toNotification(row) {
		return {
			id: row.id, type: row.type, title: row.title, body: row.body, url: row.url, guildId: row.guild_id,
			permission: row.permission, userId: row.user_id, actorId: row.actor_id, createdAt: row.created_at,
		};
	}

	async function prefsOf(userId) {
		const row = await q.prefs.get(String(userId));
		return { disabled: row ? JSON.parse(row.disabled) : [], readUpTo: row?.read_up_to ?? 0 };
	}

	// Whether `actor` (a principal) should see this notification
	async function visibleTo(actor, n, prefs = null) {
		if (!actor?.can?.('panel.access')) return false;
		if (n.userId && n.userId !== String(actor.id)) return false;
		if (n.actorId && n.actorId === String(actor.id)) return false;
		if (n.permission && !actor.can(n.permission)) return false;
		return !(prefs ?? await prefsOf(actor.id)).disabled.includes(n.type);
	}

	async function visibleList(actor) {
		const prefs = await prefsOf(actor.id);
		const rows = (await q.recent.all(String(actor.id), now() - RETENTION_DAYS * DAY_MS, SCAN)).map(toNotification);
		const read = new Set((await q.reads.all(String(actor.id), prefs.readUpTo)).map(r => r.notification_id));
		const visible = [];
		for (const n of rows) if (await visibleTo(actor, n, prefs)) visible.push({ ...n, read: n.id <= prefs.readUpTo || read.has(n.id) });
		return visible;
	}

	const service = {
		types: () => [...types].map(([key, t]) => ({ key, ...t })),

		// Lets a feature declare its own type, so people can mute it in their preferences
		registerType(key, { label, permission = null }) {
			if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw new Error(`Invalid notification type: ${key}`);
			types.set(key, { label, permission });
		},

		// Generic entry point for every feature:
		// notifications.push({ permission: 'tickets.view', title: 'Nouveau ticket', body, url: '/tickets', guildId })
		// `userId` aims at one person, `actorId` is never notified (their own action), `type` groups them in the preferences.
		async push({ type = 'other', permission, userId = null, actorId = null, title, body = null, url = null, guildId = null }) {
			const known = types.get(type);
			if (!known) throw new Error(`Unknown notification type: ${type}`);
			const text = String(title ?? '').trim();
			if (!text) throw new Error('A notification needs a title');
			const entry = {
				type,
				title: text.slice(0, 120),
				body: body ? String(body).slice(0, 300) : null,
				// Only links inside the panel
				url: url && URL_PATTERN.test(url) ? url.slice(0, 200) : null,
				guildId: guildId ? String(guildId) : null,
				permission: permission === undefined ? known.permission : permission,
				userId: userId ? String(userId) : null,
				actorId: actorId ? String(actorId) : null,
				at: now(),
			};
			// Old notifications go away on their own, at most once an hour
			if (entry.at - lastPurge > 3600_000) {
				lastPurge = entry.at;
				await service.purge();
			}
			const { lastInsertRowid } = await q.insert.run(entry);
			const saved = toNotification({ ...entry, id: Number(lastInsertRowid), guild_id: entry.guildId, user_id: entry.userId, actor_id: entry.actorId, created_at: entry.at });
			for (const listener of listeners) {
				try {
					listener(saved);
				}
				catch {
					// A closed socket never breaks the action that notified
				}
			}
			return saved;
		},

		async list(actor, { limit = 50 } = {}) {
			const all = await visibleList(actor);
			return { items: all.slice(0, Math.min(Math.max(limit, 1), 100)), unread: all.filter(n => !n.read).length };
		},

		async unreadCount(actor) {
			return (await visibleList(actor)).filter(n => !n.read).length;
		},

		visibleTo,

		async markRead(actor, ids) {
			if (!Array.isArray(ids) || ids.length > 200) throw new ValidationError('Liste de notifications invalide.');
			await db.transaction(async () => {
				for (const id of ids) if (Number.isInteger(id)) await q.read.run(String(actor.id), id);
			})();
			return { unread: await service.unreadCount(actor) };
		},

		async markAllRead(actor) {
			await q.setReadUpTo.run(String(actor.id), (await q.lastId.get()).id ?? 0);
			return { unread: await service.unreadCount(actor) };
		},

		async prefs(actor) {
			const { disabled } = await prefsOf(actor.id);
			return {
				disabled,
				// Only the types this person could receive
				types: service.types().filter(t => !t.permission || actor.can(t.permission)).map(({ key, label }) => ({ key, label })),
			};
		},

		async setPrefs(actor, { disabled }) {
			if (!Array.isArray(disabled)) throw new ValidationError('Préférences invalides.');
			const clean = [...new Set(disabled.map(String).filter(t => types.has(t)))];
			await q.setDisabled.run(String(actor.id), JSON.stringify(clean));
			return service.prefs(actor);
		},

		// A notification pushed by another process (the bot, seen from the API): only shown live, already saved
		relay(notification) {
			for (const listener of listeners) {
				try {
					listener(notification);
				}
				catch {
					// Same as push: a closed socket breaks nothing
				}
			}
		},

		// Live feed (panel WebSocket): listener(notification), filtered per user by the caller
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		async purge() {
			return (await q.purge.run(now() - RETENTION_DAYS * DAY_MS)).changes;
		},
	};
	return service;
}
