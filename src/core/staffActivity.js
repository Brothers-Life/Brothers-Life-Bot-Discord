import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';
import { dayOf } from './stats.js';
import { zonedParts } from './recurrence.js';

definePermission('staffactivity.view', { label: 'Voir le rapport d’activité du staff', category: 'Staff' });
definePermission('staffactivity.manage', { label: 'Régler le rapport mensuel du staff', category: 'Staff' });

const DAY = 86_400_000;
const SNOWFLAKE = /^\d{17,20}$/;
const TIME_ZONE = 'Europe/Paris';

// Weight of each activity in the score (shown in the panel, so the ranking is explained)
export const WEIGHTS = { ticketsClosed: 5, ticketReplies: 1, sanctions: 3, dmReplies: 1, panelActions: 0.5, voiceHours: 2, messages: 0.05 };

// Everyone who holds a rank: through a role on the main server, or given directly in the panel
export async function listStaff({ ranks, network, executor }) {
	const mainId = network.getMainId();
	const allRanks = ranks.list();
	const members = new Map();
	const entry = (id, user) => {
		if (!members.has(id)) members.set(id, { id, username: user?.username ?? null, globalName: user?.globalName ?? null, avatar: user?.avatar ?? null, ranks: [] });
		return members.get(id);
	};
	if (mainId) {
		const links = allRanks.flatMap(r => r.roles.filter(l => l.guildId === mainId).map(l => ({ rank: r, roleId: l.roleId })));
		const withRoles = await executor.listMembersWithAnyRole(mainId, [...new Set(links.map(l => l.roleId))]);
		for (const member of withRoles) {
			for (const link of links.filter(l => member.roleIds.includes(l.roleId))) {
				entry(member.id, member).ranks.push({ id: link.rank.id, name: link.rank.name, level: link.rank.level, color: link.rank.color, via: 'role', roleId: link.roleId });
			}
		}
	}
	for (const assignment of ranks.listDirectAssignments()) {
		const rank = allRanks.find(r => r.id === assignment.rankId);
		if (!rank) continue;
		const member = members.get(assignment.discordId) ?? entry(assignment.discordId, await executor.getUser(assignment.discordId));
		member.ranks.push({ id: rank.id, name: rank.name, level: rank.level, color: rank.color, via: 'direct', addedBy: assignment.addedBy, addedAt: assignment.addedAt });
	}
	return [...members.values()].map(m => ({ ...m, level: Math.max(0, ...m.ranks.map(r => r.level)) })).sort((a, b) => b.level - a.level);
}

export function scoreOf(m) {
	return Math.round(Object.entries(WEIGHTS).reduce((n, [k, w]) => n + (m[k] ?? 0) * w, 0));
}

// What each staff member did over a period: tickets, sanctions, private messages, panel, presence on Discord, absences
export function createStaffActivity({ db, network, ranks, audit, executor, settings, logs, logger = console, now = Date.now }) {
	logs.registerCategory('staffactivity', 'Rapport mensuel du staff');

	const count = (sql, ...args) => {
		const rows = db.prepare(sql).all(...args);
		return new Map(rows.map(r => [r.user_id, r]));
	};

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function config() {
		const c = settings.get('staffActivity.config', {});
		return { enabled: Boolean(c.enabled), guildId: c.guildId ?? null, channelId: c.channelId ?? null, lastPosted: c.lastPosted ?? null };
	}

	async function report({ from, to }) {
		if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new ValidationError('Période invalide.');
		if (to - from > 400 * DAY) throw new ValidationError('Période trop longue (400 jours au maximum).');
		const staff = await listStaff({ ranks, network, executor });
		const closed = count('SELECT closed_by AS user_id, COUNT(*) AS n, AVG(rating) AS rating FROM tickets WHERE closed_by IS NOT NULL AND closed_at BETWEEN ? AND ? GROUP BY closed_by', from, to);
		const claimed = count('SELECT claimed_by AS user_id, COUNT(*) AS n FROM tickets WHERE claimed_by IS NOT NULL AND created_at BETWEEN ? AND ? GROUP BY claimed_by', from, to);
		const replies = count('SELECT COALESCE(panel_user, author_id) AS user_id, COUNT(*) AS n FROM ticket_messages WHERE is_bot = 0 AND created_at BETWEEN ? AND ? GROUP BY COALESCE(panel_user, author_id)', from, to);
		const sanctions = count('SELECT moderator_id AS user_id, COUNT(*) AS n, SUM(type = \'ban\') AS bans, SUM(type = \'warn\') AS warns, SUM(type = \'timeout\') AS timeouts FROM sanctions WHERE created_at BETWEEN ? AND ? GROUP BY moderator_id', from, to);
		const dms = count('SELECT author_id AS user_id, COUNT(*) AS n FROM dm_messages WHERE direction = \'out\' AND at BETWEEN ? AND ? GROUP BY author_id', from, to);
		const panel = count('SELECT actor_id AS user_id, COUNT(*) AS n FROM audit_log WHERE source = \'panel\' AND at BETWEEN ? AND ? GROUP BY actor_id', from, to);
		const activity = count('SELECT user_id, SUM(messages) AS messages, SUM(voice_seconds) AS voice FROM stats_activity WHERE day BETWEEN ? AND ? GROUP BY user_id', dayOf(from), dayOf(to));
		const absences = db.prepare('SELECT user_id, start_at, end_at FROM absences WHERE status IN (\'approved\', \'active\', \'ended\') AND start_at < ? AND end_at > ?').all(to, from);

		const members = staff.map((s) => {
			const absent = absences.filter(a => a.user_id === s.id).reduce((n, a) => n + (Math.min(a.end_at, to) - Math.max(a.start_at, from)), 0);
			const m = {
				userId: s.id, name: s.globalName ?? s.username ?? s.id, avatar: s.avatar, level: s.level, ranks: s.ranks.map(r => ({ id: r.id, name: r.name, color: r.color })),
				ticketsClosed: closed.get(s.id)?.n ?? 0,
				ticketsClaimed: claimed.get(s.id)?.n ?? 0,
				ticketReplies: replies.get(s.id)?.n ?? 0,
				rating: closed.get(s.id)?.rating ? Math.round(closed.get(s.id).rating * 10) / 10 : null,
				sanctions: sanctions.get(s.id)?.n ?? 0,
				sanctionsDetail: { bans: sanctions.get(s.id)?.bans ?? 0, warns: sanctions.get(s.id)?.warns ?? 0, timeouts: sanctions.get(s.id)?.timeouts ?? 0 },
				dmReplies: dms.get(s.id)?.n ?? 0,
				panelActions: panel.get(s.id)?.n ?? 0,
				messages: activity.get(s.id)?.messages ?? 0,
				voiceHours: Math.round(((activity.get(s.id)?.voice ?? 0) / 3600) * 10) / 10,
				absentDays: Math.round((absent / DAY) * 10) / 10,
			};
			return { ...m, score: scoreOf(m) };
		}).sort((a, b) => b.score - a.score);
		return { from, to, weights: WEIGHTS, members };
	}

	function monthRange(at) {
		const p = zonedParts(at, TIME_ZONE);
		const start = Date.UTC(p.year, p.month - 2, 1);
		const end = Date.UTC(p.year, p.month - 1, 1) - 1;
		return { from: start, to: end, label: new Date(start).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }), key: `${p.year}-${p.month}` };
	}

	return {
		report,
		config,

		setConfig(actor, input) {
			need(actor, 'staffactivity.manage');
			const next = {
				...config(),
				enabled: Boolean(input.enabled),
				guildId: SNOWFLAKE.test(input.guildId ?? '') ? input.guildId : null,
				channelId: SNOWFLAKE.test(input.channelId ?? '') ? input.channelId : null,
			};
			if (next.enabled && (!next.guildId || !next.channelId)) throw new ValidationError('Choisis le salon où publier le rapport.');
			settings.set('staffActivity.config', next);
			audit.record({ actorId: actor.id, source: 'panel', action: 'staffactivity.config', target: 'staff', details: { enabled: next.enabled } });
			return next;
		},

		// The 1st of the month (from 10:00, Paris time): last month's ranking posted in the staff channel
		async tick() {
			const c = config();
			if (!c.enabled || !c.channelId) return false;
			const p = zonedParts(now(), TIME_ZONE);
			if (p.day !== 1 || p.hour < 10) return false;
			const range = monthRange(now());
			if (c.lastPosted === range.key) return false;
			const { members } = await report(range);
			const top = members.slice(0, 10);
			const medals = ['🥇', '🥈', '🥉'];
			const lines = top.map((m, i) => `${medals[i] ?? `**${i + 1}.**`} <@${m.userId}> — **${m.score}** pts · ${m.ticketsClosed} tickets · ${m.sanctions} sanctions · ${m.voiceHours} h vocal`);
			await executor.sendMessage(c.channelId, {
				payload: {
					content: '',
					embed: {
						enabled: true, title: `📊 Activité du staff — ${range.label}`, color: '#ff9628',
						description: lines.length ? lines.join('\n') : 'Aucune activité enregistrée.',
						footerText: `${members.length} membres du staff · détails dans le panel`, fields: [],
					},
				},
			}).catch(error => logger.warn('Monthly staff report failed:', error.message));
			settings.set('staffActivity.config', { ...c, lastPosted: range.key });
			audit.record({ actorId: 'system', source: 'system', action: 'staffactivity.report', target: 'staff', details: { month: range.label } });
			return true;
		},
	};
}
