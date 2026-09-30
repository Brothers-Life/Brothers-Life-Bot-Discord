import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('stats.view', { label: 'Voir les statistiques', category: 'Statistiques' });
definePermission('stats.manage', { label: 'Gérer les salons compteurs', category: 'Statistiques' });

const TIMEZONE = 'Europe/Paris';
const RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 400;

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// "2026-09-30" in Paris time
export function dayOf(at) {
	return dayFormat.format(new Date(at));
}

export const COUNTER_VARIABLES = ['members', 'humans', 'bots', 'voice', 'boosts', 'staff', 'fivem.players', 'fivem.max', 'fivem.status'];

// Collects activity in memory, writes it every minute; answers the statistics pages and commands
export function createStats({ db, network, audit, executor, logger = console, now = Date.now }) {
	const q = {
		addActivity: db.prepare(`
			INSERT INTO stats_activity (guild_id, day, user_id, channel_id, messages, voice_seconds) VALUES (@guildId, @day, @userId, @channelId, @messages, @voice)
			ON CONFLICT(guild_id, day, user_id, channel_id) DO UPDATE SET messages = messages + excluded.messages, voice_seconds = voice_seconds + excluded.voice_seconds
		`),
		addHourly: db.prepare(`
			INSERT INTO stats_hourly (guild_id, hour, messages, voice_seconds) VALUES (@guildId, @hour, @messages, @voice)
			ON CONFLICT(guild_id, hour) DO UPDATE SET messages = messages + excluded.messages, voice_seconds = voice_seconds + excluded.voice_seconds
		`),
		addMembers: db.prepare(`
			INSERT INTO stats_members (guild_id, day, joins, leaves, member_count, voice_peak) VALUES (@guildId, @day, @joins, @leaves, @memberCount, @voicePeak)
			ON CONFLICT(guild_id, day) DO UPDATE SET joins = joins + excluded.joins, leaves = leaves + excluded.leaves,
				member_count = COALESCE(excluded.member_count, member_count), voice_peak = MAX(voice_peak, excluded.voice_peak)
		`),
		purgeActivity: db.prepare('DELETE FROM stats_activity WHERE day < ?'),
		purgeHourly: db.prepare('DELETE FROM stats_hourly WHERE hour < ?'),
		purgeMembers: db.prepare('DELETE FROM stats_members WHERE day < ?'),
		counters: db.prepare('SELECT * FROM stat_counters ORDER BY id'),
		countersOf: db.prepare('SELECT * FROM stat_counters WHERE guild_id = ? ORDER BY id'),
		counter: db.prepare('SELECT * FROM stat_counters WHERE id = ?'),
		insertCounter: db.prepare('INSERT INTO stat_counters (guild_id, channel_id, template, created_at) VALUES (?, ?, ?, ?)'),
		updateCounter: db.prepare('UPDATE stat_counters SET template = ?, last_name = NULL WHERE id = ?'),
		renamedCounter: db.prepare('UPDATE stat_counters SET last_name = ?, updated_at = ? WHERE id = ?'),
		deleteCounter: db.prepare('DELETE FROM stat_counters WHERE id = ?'),
		deleteCounterByChannel: db.prepare('DELETE FROM stat_counters WHERE channel_id = ?'),
		directStaff: db.prepare('SELECT DISTINCT discord_id FROM user_ranks'),
		linkedRoles: db.prepare('SELECT DISTINCT role_id FROM rank_roles WHERE guild_id = ?'),
	};

	// `${guildId}|${day}|${userId}|${channelId}` -> { messages, voice }
	let activity = new Map();
	// `${guildId}|${hour}` -> { messages, voice }
	let hourly = new Map();
	// `${guildId}|${day}` -> { joins, leaves, voicePeak }
	let membersBuffer = new Map();
	// `${guildId}:${userId}` -> { channelId, since } of people in voice (AFK channel excluded)
	const voice = new Map();
	// Extra variables for the counters (the FiveM service adds its own)
	const variableProviders = [];

	function bump(map, key, field, amount, init) {
		const entry = map.get(key) ?? { ...init };
		entry[field] += amount;
		map.set(key, entry);
	}

	function tracked(guildId) {
		return network.find(guildId)?.status === 'active';
	}

	// Credits the voice time elapsed since the last credit, only for people who are not alone
	function creditVoice(until = now()) {
		const occupancy = new Map();
		for (const [key, session] of voice) {
			const channelKey = `${key.split(':')[0]}:${session.channelId}`;
			occupancy.set(channelKey, (occupancy.get(channelKey) ?? 0) + 1);
		}
		const peaks = new Map();
		for (const [key, session] of voice) {
			const [guildId, userId] = key.split(':');
			peaks.set(guildId, (peaks.get(guildId) ?? 0) + 1);
			const seconds = Math.floor((until - session.since) / 1000);
			if (seconds <= 0) continue;
			session.since += seconds * 1000;
			if ((occupancy.get(`${guildId}:${session.channelId}`) ?? 0) < 2) continue;
			const day = dayOf(until);
			bump(activity, `${guildId}|${day}|${userId}|${session.channelId}`, 'voice', seconds, { messages: 0, voice: 0 });
			bump(hourly, `${guildId}|${Math.floor(until / 3600_000)}`, 'voice', seconds, { messages: 0, voice: 0 });
		}
		for (const [guildId, count] of peaks) {
			const key = `${guildId}|${dayOf(until)}`;
			const entry = membersBuffer.get(key) ?? { joins: 0, leaves: 0, voicePeak: 0 };
			entry.voicePeak = Math.max(entry.voicePeak, count);
			membersBuffer.set(key, entry);
		}
	}

	function rangeOf({ from, to, days = 30 } = {}) {
		const end = Number.isFinite(to) ? to : now();
		const start = Number.isFinite(from) ? from : end - (days - 1) * DAY_MS;
		if (end - start > MAX_RANGE_DAYS * DAY_MS) throw new ValidationError(`Période de ${MAX_RANGE_DAYS} jours maximum.`);
		if (start > end) throw new ValidationError('La date de début est après la date de fin.');
		return { start, end, fromDay: dayOf(start), toDay: dayOf(end) };
	}

	function guildFilter(guildIds) {
		const ids = guildIds?.length ? guildIds : network.activeIds();
		return { sql: `guild_id IN (${ids.map(() => '?').join(',') || 'NULL'})`, params: ids };
	}

	async function staffIds() {
		const ids = new Set(q.directStaff.all().map(r => r.discord_id));
		const mainId = network.getMainId();
		if (mainId) {
			const roleIds = q.linkedRoles.all(mainId).map(r => r.role_id);
			const members = await executor.listMembersWithAnyRole(mainId, roleIds).catch(() => []);
			for (const m of members) ids.add(m.id);
		}
		return [...ids];
	}

	// WHERE clause of stats_activity for the filters of the page
	async function activityWhere({ guildIds, channelId, userId, staffOnly }, range) {
		const guilds = guildFilter(guildIds);
		const where = [guilds.sql, 'day BETWEEN ? AND ?'];
		const params = [...guilds.params, range.fromDay, range.toDay];
		if (channelId) {
			where.push('channel_id = ?');
			params.push(channelId);
		}
		if (userId) {
			where.push('user_id = ?');
			params.push(userId);
		}
		if (staffOnly) {
			const ids = await staffIds();
			where.push(`user_id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
			params.push(...ids);
		}
		return { sql: where.join(' AND '), params };
	}

	function counterName(template, vars) {
		return template.replace(/\{([a-z.]+)\}/g, (match, key) => (vars[key] !== undefined ? String(vars[key]) : match)).slice(0, 100);
	}

	async function counterVars(guildId) {
		const counts = await executor.getGuildCounts(guildId);
		const staffRoles = q.linkedRoles.all(guildId).map(r => r.role_id);
		const staff = staffRoles.length ? (await executor.listMembersWithAnyRole(guildId, staffRoles).catch(() => [])).length : 0;
		const vars = { ...counts, staff };
		for (const provider of variableProviders) Object.assign(vars, await provider(guildId).catch(() => ({})));
		// French thousands separator: 1 234
		for (const [key, value] of Object.entries(vars)) if (typeof value === 'number') vars[key] = value.toLocaleString('fr-FR');
		return vars;
	}

	const service = {
		// --- Collection ---------------------------------------------------------------------------
		message(guildId, channelId, userId, bot) {
			if (bot || !tracked(guildId)) return;
			bump(activity, `${guildId}|${dayOf(now())}|${userId}|${channelId}`, 'messages', 1, { messages: 0, voice: 0 });
			bump(hourly, `${guildId}|${Math.floor(now() / 3600_000)}`, 'messages', 1, { messages: 0, voice: 0 });
		},

		// channelId null: left the voice; afk: joined the AFK channel (not counted)
		voiceState(guildId, userId, channelId, { bot = false, afk = false } = {}) {
			if (bot || !tracked(guildId)) return;
			creditVoice();
			const key = `${guildId}:${userId}`;
			if (!channelId || afk) voice.delete(key);
			else voice.set(key, { channelId, since: now() });
		},

		// On startup: who is already in voice
		seedVoice(states) {
			for (const s of states) service.voiceState(s.guildId, s.userId, s.channelId, s);
		},

		memberJoined(guildId) {
			if (!tracked(guildId)) return;
			bump(membersBuffer, `${guildId}|${dayOf(now())}`, 'joins', 1, { joins: 0, leaves: 0, voicePeak: 0 });
		},

		memberLeft(guildId) {
			if (!tracked(guildId)) return;
			bump(membersBuffer, `${guildId}|${dayOf(now())}`, 'leaves', 1, { joins: 0, leaves: 0, voicePeak: 0 });
		},

		// Every minute: everything collected goes to the database
		async flush() {
			creditVoice();
			const [a, h, m] = [activity, hourly, membersBuffer];
			activity = new Map();
			hourly = new Map();
			membersBuffer = new Map();
			const counts = new Map();
			for (const guildId of network.activeIds()) {
				const info = await executor.getGuildInfo(guildId).catch(() => null);
				if (info) counts.set(guildId, info.memberCount);
			}
			db.transaction(() => {
				for (const [key, v] of a) {
					const [guildId, day, userId, channelId] = key.split('|');
					q.addActivity.run({ guildId, day, userId, channelId, messages: v.messages, voice: v.voice });
				}
				for (const [key, v] of h) {
					const [guildId, hour] = key.split('|');
					q.addHourly.run({ guildId, hour: Number(hour), messages: v.messages, voice: v.voice });
				}
				const today = dayOf(now());
				const keys = new Set([...m.keys(), ...[...counts.keys()].map(g => `${g}|${today}`)]);
				for (const key of keys) {
					const [guildId, day] = key.split('|');
					const v = m.get(key) ?? { joins: 0, leaves: 0, voicePeak: 0 };
					q.addMembers.run({ guildId, day, joins: v.joins, leaves: v.leaves, memberCount: day === today ? counts.get(guildId) ?? null : null, voicePeak: v.voicePeak });
				}
			})();
		},

		purge() {
			const limit = now() - RETENTION_DAYS * DAY_MS;
			q.purgeActivity.run(dayOf(limit));
			q.purgeHourly.run(Math.floor(limit / 3600_000));
			q.purgeMembers.run(dayOf(limit));
		},

		// --- Reading -------------------------------------------------------------------------------
		async overview(filters = {}) {
			const range = rangeOf(filters);
			const where = await activityWhere(filters, range);
			const guilds = guildFilter(filters.guildIds);
			const perDay = db.prepare(`
				SELECT day, SUM(messages) AS messages, SUM(voice_seconds) AS voice, COUNT(DISTINCT user_id) AS active
				FROM stats_activity WHERE ${where.sql} GROUP BY day
			`).all(...where.params);
			const totals = db.prepare(`
				SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_seconds), 0) AS voice, COUNT(DISTINCT user_id) AS active
				FROM stats_activity WHERE ${where.sql}
			`).get(...where.params);
			const members = db.prepare(`
				SELECT day, SUM(joins) AS joins, SUM(leaves) AS leaves, SUM(member_count) AS memberCount, MAX(voice_peak) AS voicePeak
				FROM stats_members WHERE ${guilds.sql} AND day BETWEEN ? AND ? GROUP BY day
			`).all(...guilds.params, range.fromDay, range.toDay);
			const days = [];
			for (let at = range.start; dayOf(at) <= range.toDay; at += DAY_MS) {
				const day = dayOf(at);
				if (days.at(-1)?.day === day) continue;
				const a = perDay.find(r => r.day === day);
				const mm = members.find(r => r.day === day);
				days.push({ day, messages: a?.messages ?? 0, voiceHours: Math.round((a?.voice ?? 0) / 36) / 100, active: a?.active ?? 0, joins: mm?.joins ?? 0, leaves: mm?.leaves ?? 0, memberCount: mm?.memberCount ?? null });
			}
			const memberCounts = days.map(d => d.memberCount).filter(v => v !== null);
			return {
				from: range.fromDay,
				to: range.toDay,
				totals: {
					messages: totals.messages,
					voiceHours: Math.round(totals.voice / 36) / 100,
					active: totals.active,
					joins: days.reduce((n, d) => n + d.joins, 0),
					leaves: days.reduce((n, d) => n + d.leaves, 0),
					memberCount: memberCounts.at(-1) ?? null,
					memberGrowth: memberCounts.length > 1 ? memberCounts.at(-1) - memberCounts[0] : null,
				},
				days,
			};
		},

		// 7 x 24: messages and voice hours by weekday (Monday first) and hour, Paris time
		heatmap(filters = {}) {
			const range = rangeOf(filters);
			const guilds = guildFilter(filters.guildIds);
			const rows = db.prepare(`SELECT hour, SUM(messages) AS messages, SUM(voice_seconds) AS voice FROM stats_hourly WHERE ${guilds.sql} AND hour BETWEEN ? AND ? GROUP BY hour`)
				.all(...guilds.params, Math.floor(range.start / 3600_000) - 24, Math.floor(range.end / 3600_000));
			const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ messages: 0, voiceHours: 0 })));
			for (const row of rows) {
				const parts = Object.fromEntries(partsFormat.formatToParts(new Date(row.hour * 3600_000)).map(p => [p.type, p.value]));
				const cell = grid[WEEKDAYS[parts.weekday]][Number(parts.hour)];
				cell.messages += row.messages;
				cell.voiceHours = Math.round((cell.voiceHours + row.voice / 3600) * 100) / 100;
			}
			return grid;
		},

		async topMembers(filters = {}, { metric = 'messages', limit = 50 } = {}) {
			const range = rangeOf(filters);
			const where = await activityWhere(filters, range);
			const order = metric === 'voice' ? 'voice' : 'messages';
			return db.prepare(`
				SELECT user_id AS userId, SUM(messages) AS messages, SUM(voice_seconds) AS voice, COUNT(DISTINCT day) AS days
				FROM stats_activity WHERE ${where.sql} GROUP BY user_id ORDER BY ${order} DESC LIMIT ?
			`).all(...where.params, Math.min(Math.max(limit, 1), 200))
				.map(r => ({ ...r, voiceHours: Math.round(r.voice / 36) / 100 }));
		},

		async topChannels(filters = {}, { limit = 50 } = {}) {
			const range = rangeOf(filters);
			const where = await activityWhere(filters, range);
			return db.prepare(`
				SELECT guild_id AS guildId, channel_id AS channelId, SUM(messages) AS messages, SUM(voice_seconds) AS voice, COUNT(DISTINCT user_id) AS members
				FROM stats_activity WHERE ${where.sql} GROUP BY guild_id, channel_id ORDER BY messages + voice / 60 DESC LIMIT ?
			`).all(...where.params, Math.min(Math.max(limit, 1), 200))
				.map(r => ({ ...r, voiceHours: Math.round(r.voice / 36) / 100 }));
		},

		// Work of the staff: sanctions given, tickets handled, satisfaction, activity
		async staff(filters = {}) {
			const range = rangeOf(filters);
			const guilds = guildFilter(filters.guildIds);
			const sanctions = db.prepare(`
				SELECT moderator_id AS userId, type, COUNT(*) AS n FROM sanctions
				WHERE created_at BETWEEN ? AND ? AND (origin_guild_id IS NULL OR ${guilds.sql.replace('guild_id', 'origin_guild_id')}) AND moderator_id GLOB '[0-9]*'
				GROUP BY moderator_id, type
			`).all(range.start, range.end + DAY_MS, ...guilds.params);
			const tickets = db.prepare(`
				SELECT claimed_by AS userId, COUNT(*) AS claimed, SUM(status = 'closed') AS closed,
					AVG(CASE WHEN closed_at IS NOT NULL THEN closed_at - created_at END) AS avgResolutionMs, AVG(rating) AS rating, COUNT(rating) AS ratings
				FROM tickets WHERE claimed_by IS NOT NULL AND created_at BETWEEN ? AND ? AND ${guilds.sql} GROUP BY claimed_by
			`).all(range.start, range.end + DAY_MS, ...guilds.params);
			const ids = new Set([...await staffIds(), ...sanctions.map(s => s.userId), ...tickets.map(t => t.userId)]);
			const where = await activityWhere({ ...filters, staffOnly: false }, range);
			const activityRows = ids.size
				? db.prepare(`SELECT user_id AS userId, SUM(messages) AS messages, SUM(voice_seconds) AS voice FROM stats_activity WHERE ${where.sql} AND user_id IN (${[...ids].map(() => '?').join(',')}) GROUP BY user_id`)
					.all(...where.params, ...ids)
				: [];
			return [...ids].map((userId) => {
				const s = sanctions.filter(x => x.userId === userId);
				const t = tickets.find(x => x.userId === userId);
				const a = activityRows.find(x => x.userId === userId);
				return {
					userId,
					sanctions: Object.fromEntries(s.map(x => [x.type, x.n])),
					sanctionsTotal: s.reduce((n, x) => n + x.n, 0),
					ticketsClaimed: t?.claimed ?? 0,
					ticketsClosed: t?.closed ?? 0,
					avgResolutionHours: t?.avgResolutionMs ? Math.round(t.avgResolutionMs / 36_000) / 100 : null,
					rating: t?.rating ? Math.round(t.rating * 10) / 10 : null,
					ratings: t?.ratings ?? 0,
					messages: a?.messages ?? 0,
					voiceHours: a ? Math.round(a.voice / 36) / 100 : 0,
				};
			}).sort((x, y) => (y.sanctionsTotal + y.ticketsClaimed) - (x.sanctionsTotal + x.ticketsClaimed) || y.messages - x.messages);
		},

		async member(userId, filters = {}) {
			const range = rangeOf(filters);
			const where = await activityWhere({ ...filters, userId }, range);
			const totals = db.prepare(`SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_seconds), 0) AS voice, COUNT(DISTINCT day) AS days FROM stats_activity WHERE ${where.sql}`).get(...where.params);
			const channels = db.prepare(`SELECT channel_id AS channelId, SUM(messages) AS messages FROM stats_activity WHERE ${where.sql} GROUP BY channel_id ORDER BY messages DESC LIMIT 3`).all(...where.params);
			const rankRow = db.prepare(`
				SELECT COUNT(*) + 1 AS rank FROM (SELECT user_id, SUM(messages) AS m FROM stats_activity WHERE ${(await activityWhere({ ...filters, userId: null }, range)).sql} GROUP BY user_id)
				WHERE m > ?
			`).get(...(await activityWhere({ ...filters, userId: null }, range)).params, totals.messages);
			return { ...totals, voiceHours: Math.round(totals.voice / 36) / 100, topChannels: channels, rank: rankRow.rank, from: range.fromDay, to: range.toDay };
		},

		// --- Counter channels ----------------------------------------------------------------------
		addVariables(provider) {
			variableProviders.push(provider);
		},

		counters(guildId) {
			return (guildId ? q.countersOf.all(guildId) : q.counters.all()).map(r => ({ id: r.id, guildId: r.guild_id, channelId: r.channel_id, template: r.template, lastName: r.last_name, updatedAt: r.updated_at }));
		},

		async createCounter(actor, guildId, { template, channelId = null, categoryId = null }) {
			if (!actor.can('stats.manage')) throw new ForbiddenError('Permission manquante : stats.manage');
			if (!tracked(guildId)) throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const text = String(template ?? '').trim();
			if (!text || text.length > 90) throw new ValidationError('Le nom du compteur fait 1 à 90 caractères.');
			if (!/\{[a-z.]+\}/.test(text)) throw new ValidationError('Mets au moins une variable, par exemple {members}.');
			if (q.countersOf.all(guildId).length >= 10) throw new ValidationError('10 compteurs maximum par serveur.');
			const name = counterName(text, await counterVars(guildId));
			const id = channelId ?? await executor.createCounterChannel(guildId, { name, categoryId });
			q.insertCounter.run(guildId, id, text, now());
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'stats.counter_add', guildId, target: id, details: { template: text } });
			await service.updateCounters(guildId);
			return service.counters(guildId).find(c => c.channelId === id);
		},

		async updateCounter(actor, id, template) {
			if (!actor.can('stats.manage')) throw new ForbiddenError('Permission manquante : stats.manage');
			const row = q.counter.get(id);
			if (!row) throw new NotFoundError('Compteur introuvable.');
			const text = String(template ?? '').trim();
			if (!text || text.length > 90 || !/\{[a-z.]+\}/.test(text)) throw new ValidationError('Nom de 1 à 90 caractères, avec au moins une variable.');
			q.updateCounter.run(text, id);
			await service.updateCounters(row.guild_id);
			return service.counters(row.guild_id).find(c => c.id === id);
		},

		async deleteCounter(actor, id, { deleteChannel = false } = {}) {
			if (!actor.can('stats.manage')) throw new ForbiddenError('Permission manquante : stats.manage');
			const row = q.counter.get(id);
			if (!row) throw new NotFoundError('Compteur introuvable.');
			q.deleteCounter.run(id);
			if (deleteChannel) await executor.deleteChannel(row.channel_id, 'Compteur supprimé').catch(() => null);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'stats.counter_delete', guildId: row.guild_id, target: row.channel_id });
		},

		counterDeleted(channelId) {
			q.deleteCounterByChannel.run(channelId);
		},

		// Every 10 minutes (Discord allows 2 renames per 10 minutes per channel)
		async updateCounters(onlyGuildId = null) {
			const rows = onlyGuildId ? q.countersOf.all(onlyGuildId) : q.counters.all();
			const byGuild = new Map();
			for (const row of rows) byGuild.set(row.guild_id, [...(byGuild.get(row.guild_id) ?? []), row]);
			for (const [guildId, list] of byGuild) {
				if (!tracked(guildId)) continue;
				const vars = await counterVars(guildId).catch(() => null);
				if (!vars) continue;
				for (const row of list) {
					const name = counterName(row.template, vars);
					if (name === row.last_name) continue;
					try {
						await executor.renameChannel(row.channel_id, name);
						q.renamedCounter.run(name, now(), row.id);
					}
					catch (error) {
						logger.warn(`Counter ${row.channel_id} not renamed:`, error.message);
					}
				}
			}
		},
	};
	return service;
}
