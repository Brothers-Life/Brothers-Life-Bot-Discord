const SOURCES = new Set(['bot', 'panel', 'native', 'system']);

export function createAudit({ db, now = Date.now }) {
	const insert = db.prepare(`
		INSERT INTO audit_log (at, actor_id, source, action, guild_id, target, details, results)
		VALUES (@at, @actorId, @source, @action, @guildId, @target, @details, @results)
	`);
	const listeners = new Set();

	function toEntry(row) {
		return {
			id: row.id,
			at: row.at,
			actorId: row.actor_id,
			source: row.source,
			action: row.action,
			guildId: row.guild_id,
			target: row.target,
			details: row.details ? JSON.parse(row.details) : null,
			results: row.results ? JSON.parse(row.results) : null,
		};
	}

	return {
		// action is "<category>.<verb>", e.g. "ranks.create": the category drives log routing
		record({ actorId, source, action, guildId = null, target = null, details = null, results = null }) {
			// Automod actions are system actions whose author is "automod"
			if (source === 'automod') source = 'system';
			if (!SOURCES.has(source)) throw new Error(`Unknown audit source: ${source}`);
			const entry = { at: now(), actorId: String(actorId), source, action, guildId, target, details, results };
			const { lastInsertRowid } = insert.run({
				...entry,
				details: details === null ? null : JSON.stringify(details),
				results: results === null ? null : JSON.stringify(results),
			});
			const saved = { id: Number(lastInsertRowid), ...entry };
			for (const listener of listeners) {
				try {
					listener(saved);
				}
				catch {
					// A failing listener (e.g. Discord log) must never break the action itself
				}
			}
			return saved.id;
		},

		// Newest first, paginated with `before` (an id)
		query({ actorId, action, guildId, from, to, before, limit = 50 } = {}) {
			const filters = {
				actorId: ['actor_id = @actorId', actorId],
				action: ['(action = @action OR action LIKE @actionPrefix)', action],
				guildId: ['guild_id = @guildId', guildId],
				from: ['at >= @from', from],
				to: ['at <= @to', to],
				before: ['id < @before', before],
			};
			const where = [];
			const params = {};
			for (const [key, [clause, value]] of Object.entries(filters)) {
				if (value === undefined || value === null || value === '') continue;
				where.push(clause);
				params[key] = value;
			}
			if (params.action) params.actionPrefix = `${params.action}.%`;
			params.limit = Math.min(Math.max(Number(limit) || 50, 1), 200);

			const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT @limit`;
			return db.prepare(sql).all(params).map(toEntry);
		},

		onRecord(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
