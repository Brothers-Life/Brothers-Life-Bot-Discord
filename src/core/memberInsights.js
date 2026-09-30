const DISCORD_EPOCH = 1_420_070_400_000n;

// When a Discord account (or anything with an ID) was created
export function snowflakeTime(id) {
	try {
		return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
	}
	catch {
		return null;
	}
}

// Everything the network knows about someone, beyond their roles: activity, who invited them, tickets,
// applications, absences, name history and recent events. Read-only, from the bot's own records.
export function createMemberInsights({ db, stats, events }) {
	const q = {
		activity: db.prepare('SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_seconds), 0) AS voice, COUNT(DISTINCT day) AS days, MIN(day) AS first, MAX(day) AS last FROM stats_activity WHERE user_id = ?'),
		byGuild: db.prepare('SELECT guild_id AS guildId, SUM(messages) AS messages, SUM(voice_seconds) AS voice, MAX(day) AS last FROM stats_activity WHERE user_id = ? GROUP BY guild_id'),
		channels: db.prepare('SELECT guild_id AS guildId, channel_id AS channelId, SUM(messages) AS messages, SUM(voice_seconds) AS voice FROM stats_activity WHERE user_id = ? GROUP BY guild_id, channel_id ORDER BY messages + voice / 60 DESC LIMIT 5'),
		invitedBy: db.prepare('SELECT guild_id AS guildId, actor_id AS inviterId, at FROM events WHERE type = \'member_join\' AND user_id = ? ORDER BY at DESC'),
		invited: db.prepare('SELECT COUNT(DISTINCT user_id) AS people, COUNT(*) AS joins FROM events WHERE type = \'member_join\' AND actor_id = ?'),
		movements: db.prepare('SELECT type, COUNT(*) AS n FROM events WHERE user_id = ? AND type IN (\'member_join\', \'member_leave\') GROUP BY type'),
		names: db.prepare('SELECT at, guild_id AS guildId, type, details FROM events WHERE user_id = ? AND type IN (\'member_nickname\', \'member_username\') ORDER BY at DESC LIMIT 15'),
		tickets: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(status = \'open\'), 0) AS open, AVG(rating) AS rating FROM tickets WHERE opener_id = ?'),
		lastTickets: db.prepare('SELECT id, guild_id AS guildId, number, subject, status, created_at AS createdAt FROM tickets WHERE opener_id = ? ORDER BY created_at DESC LIMIT 5'),
		handled: db.prepare('SELECT COUNT(*) AS claimed, COALESCE(SUM(closed_by = ?), 0) AS closed FROM tickets WHERE claimed_by = ? OR closed_by = ?'),
		sanctionsGiven: db.prepare('SELECT COUNT(*) AS n FROM sanctions WHERE moderator_id = ?'),
		applications: db.prepare(`
			SELECT a.id, a.status, a.created_at AS createdAt, p.name AS position FROM recruit_applications a
			LEFT JOIN recruit_positions p ON p.id = a.position_id WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 5
		`),
		absences: db.prepare('SELECT id, start_at AS startAt, end_at AS endAt, status, reason FROM absences WHERE user_id = ? ORDER BY start_at DESC LIMIT 5'),
		dm: db.prepare('SELECT t.id, t.status, t.last_message_at AS lastMessageAt, (SELECT COUNT(*) FROM dm_messages m WHERE m.thread_id = t.id AND m.direction IN (\'in\', \'out\')) AS messages FROM dm_threads t WHERE t.user_id = ?'),
	};

	return {
		async of(userId) {
			const all = q.activity.get(userId);
			const recent = await stats.member(userId, { days: 30 }).catch(() => null);
			const moves = Object.fromEntries(q.movements.all(userId).map(r => [r.type, r.n]));
			const joins = q.invitedBy.all(userId);
			const tickets = q.tickets.get(userId);
			const handled = q.handled.get(userId, userId, userId);
			return {
				accountCreatedAt: snowflakeTime(userId),
				activity: {
					allTime: { messages: all.messages, voiceHours: Math.round(all.voice / 36) / 100, days: all.days, first: all.first, last: all.last },
					last30: recent ? { messages: recent.messages, voiceHours: recent.voiceHours, days: recent.days, rank: recent.rank } : null,
					byGuild: q.byGuild.all(userId).map(g => ({ ...g, voiceHours: Math.round(g.voice / 36) / 100 })),
					topChannels: q.channels.all(userId).map(c => ({ ...c, voiceHours: Math.round(c.voice / 36) / 100 })),
				},
				invites: {
					// Latest arrival on each server, with who invited them (when known)
					invitedBy: [...new Map(joins.map(j => [j.guildId, j])).values()].filter(j => j.inviterId),
					invitedPeople: q.invited.get(userId).people,
				},
				movements: { joins: moves.member_join ?? 0, leaves: moves.member_leave ?? 0 },
				names: q.names.all(userId).map(n => ({ ...n, details: n.details ? JSON.parse(n.details) : null })),
				tickets: { total: tickets.total, open: tickets.open, rating: tickets.rating ? Math.round(tickets.rating * 10) / 10 : null, last: q.lastTickets.all(userId) },
				staff: { ticketsHandled: handled.claimed, ticketsClosed: handled.closed, sanctionsGiven: q.sanctionsGiven.get(userId).n },
				applications: q.applications.all(userId),
				absences: q.absences.all(userId),
				dm: q.dm.get(userId) ?? null,
				timeline: events.query({ userId, limit: 30 }),
			};
		},
	};
}
