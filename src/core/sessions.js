import crypto from 'node:crypto';

const TOUCH_THROTTLE_MS = 60_000;

// Server-side sessions: the browser only holds a random id in an HttpOnly cookie
export function createSessions({ db, ttlMs = 12 * 3600_000, idleMs = 2 * 3600_000, now = Date.now }) {
	const q = {
		insert: db.prepare(`
			INSERT INTO sessions (id, discord_id, username, avatar, created_at, last_seen_at, expires_at, ip, user_agent)
			VALUES (@id, @discordId, @username, @avatar, @at, @at, @expiresAt, @ip, @userAgent)
		`),
		get: db.prepare('SELECT * FROM sessions WHERE id = ?'),
		touch: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?'),
		delete: db.prepare('DELETE FROM sessions WHERE id = ?'),
		deleteUser: db.prepare('DELETE FROM sessions WHERE discord_id = ?'),
		all: db.prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC'),
		byUser: db.prepare('SELECT * FROM sessions WHERE discord_id = ? ORDER BY last_seen_at DESC'),
		purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?'),
	};

	function toSession(row) {
		return {
			id: row.id,
			discordId: row.discord_id,
			username: row.username,
			avatar: row.avatar,
			createdAt: row.created_at,
			lastSeenAt: row.last_seen_at,
			expiresAt: row.expires_at,
			ip: row.ip,
			userAgent: row.user_agent,
		};
	}

	function isExpired(row, at) {
		return row.expires_at <= at || row.last_seen_at <= at - idleMs;
	}

	return {
		create({ discordId, username = null, avatar = null, ip = null, userAgent = null }) {
			const id = crypto.randomBytes(32).toString('base64url');
			const at = now();
			q.insert.run({ id, discordId: String(discordId), username, avatar, at, expiresAt: at + ttlMs, ip, userAgent: userAgent?.slice(0, 300) ?? null });
			return id;
		},

		// Returns the session if still valid and refreshes its activity, otherwise deletes it
		touch(id) {
			if (typeof id !== 'string' || !id) return null;
			const row = q.get.get(id);
			if (!row) return null;
			const at = now();
			if (isExpired(row, at)) {
				q.delete.run(id);
				return null;
			}
			if (at - row.last_seen_at > TOUCH_THROTTLE_MS) {
				q.touch.run(at, id);
				row.last_seen_at = at;
			}
			return toSession(row);
		},

		get(id) {
			const row = q.get.get(id);
			return row ? toSession(row) : null;
		},

		revoke(id) {
			return q.delete.run(id).changes > 0;
		},

		revokeAllFor(discordId) {
			return q.deleteUser.run(String(discordId)).changes;
		},

		list(discordId) {
			const at = now();
			const rows = discordId ? q.byUser.all(String(discordId)) : q.all.all();
			return rows.filter(row => !isExpired(row, at)).map(toSession);
		},

		purgeExpired() {
			const at = now();
			return q.purge.run(at, at - idleMs).changes;
		},
	};
}
