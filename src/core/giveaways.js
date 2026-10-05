import { randomInt } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeTargets as normalizePingTargets } from './announcements.js';
import { accountCreatedAt } from './ticketConfig.js';

definePermission('giveaways.view', { label: 'Voir les giveaways et leurs participants', category: 'Giveaways' });
definePermission('giveaways.manage', { label: 'Créer, terminer, relancer des giveaways', category: 'Giveaways' });
definePermission('giveaways.join_exempt', { label: 'Exclu des giveaways (staff)', category: 'Giveaways' });

const SNOWFLAKE = /^\d{17,20}$/;
const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);
const ids = value => (Array.isArray(value) ? value : []).filter(v => SNOWFLAKE.test(v)).slice(0, 25);
const DAY_MS = 86_400_000;

// Acts as the author of the rewards (winner role)
const GIVEAWAY = Object.freeze({ id: 'giveaway', source: 'system', isOwner: true, level: Infinity, permissions: [], ranks: [], can: () => true });

export function normalizeGiveaway(input) {
	const prize = String(input.prize ?? '').trim();
	if (!prize || prize.length > 200) throw new ValidationError('Le lot fait 1 à 200 caractères.');
	const s = input.settings ?? {};
	return {
		prize,
		description: String(input.description ?? '').slice(0, 2000),
		winnersCount: int(input.winnersCount, 1, 50, 1),
		settings: {
			requiredRoleIds: ids(s.requiredRoleIds),
			requiredMode: s.requiredMode === 'all' ? 'all' : 'any',
			blockedRoleIds: ids(s.blockedRoleIds),
			minAccountAgeDays: int(s.minAccountAgeDays, 0, 3650, 0),
			minMemberDays: int(s.minMemberDays, 0, 3650, 0),
			minMessages: int(s.minMessages, 0, 100_000, 0),
			minVoiceHours: int(s.minVoiceHours, 0, 10_000, 0),
			activityDays: int(s.activityDays, 1, 365, 30),
			requiredGuildIds: ids(s.requiredGuildIds),
			noActiveSanction: s.noActiveSanction !== false,
			noWarnDays: int(s.noWarnDays, 0, 365, 0),
			excludeStaff: Boolean(s.excludeStaff),
			// The organizer does not take part in their own giveaway (unless allowed)
			excludeHost: s.excludeHost !== false,
			excludeRecentWinnersDays: int(s.excludeRecentWinnersDays, 0, 365, 0),
			bonusRoles: (Array.isArray(s.bonusRoles) ? s.bonusRoles : []).filter(b => SNOWFLAKE.test(b?.roleId)).slice(0, 10).map(b => ({ roleId: b.roleId, entries: int(b.entries, 1, 50, 2) })),
			bonusMode: s.bonusMode === 'max' ? 'max' : 'sum',
			maxEntries: int(s.maxEntries, 1, 100, 10),
			winnerRoleId: SNOWFLAKE.test(s.winnerRoleId) ? s.winnerRoleId : null,
			winnerRoleDays: int(s.winnerRoleDays, 0, 365, 0),
			claimMinutes: int(s.claimMinutes, 0, 10_080, 0),
			dmWinners: s.dmWinners !== false,
			winnerMessage: String(s.winnerMessage ?? 'Bravo {winners} ! Vous gagnez **{prize}** 🎉').slice(0, 1000),
			color: /^#[0-9a-f]{6}$/i.test(s.color ?? '') ? s.color : '#e5484d',
			image: typeof s.image === 'string' && /^https:\/\/\S+$/.test(s.image) ? s.image : null,
		},
		targets: input.targets?.length ? normalizePingTargets(input.targets) : [],
	};
}

// Weighted draw without replacement; `pick(n)` returns an integer in [0, n)
export function weightedDraw(pool, count, pick = n => randomInt(n)) {
	const remaining = [...pool];
	const chosen = [];
	while (chosen.length < count && remaining.length) {
		const total = remaining.reduce((sum, e) => sum + e.entries, 0);
		let ticket = pick(total);
		const index = remaining.findIndex((e) => {
			ticket -= e.entries;
			return ticket < 0;
		});
		chosen.push({ ...remaining[index], ticket: total });
		remaining.splice(index, 1);
	}
	return chosen;
}

export function createGiveaways({ db, network, ranks, audit, executor, sanctions, stats, moderation, logger = console, now = Date.now }) {
	const q = {
		list: db.prepare('SELECT * FROM giveaways ORDER BY id DESC LIMIT 200'),
		get: db.prepare('SELECT * FROM giveaways WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO giveaways (prize, description, winners_count, settings, targets, starts_at, ends_at, created_by, created_at, updated_at)
			VALUES (@prize, @description, @winnersCount, @settings, @targets, @startsAt, @endsAt, @by, @at, @at)
		`),
		update: db.prepare(`
			UPDATE giveaways SET prize = @prize, description = @description, winners_count = @winnersCount, settings = @settings, targets = @targets,
				starts_at = @startsAt, ends_at = @endsAt, updated_at = @at WHERE id = @id
		`),
		setStatus: db.prepare('UPDATE giveaways SET status = ?, updated_at = ? WHERE id = ?'),
		open: db.prepare('UPDATE giveaways SET status = \'open\', messages = ?, updated_at = ? WHERE id = ?'),
		end: db.prepare('UPDATE giveaways SET status = \'ended\', ended_at = ?, draw = ?, updated_at = ? WHERE id = ? AND status = \'open\''),
		setDraw: db.prepare('UPDATE giveaways SET draw = ? WHERE id = ?'),
		remove: db.prepare('DELETE FROM giveaways WHERE id = ?'),
		dueStart: db.prepare('SELECT * FROM giveaways WHERE status = \'scheduled\' AND starts_at <= ?'),
		dueEnd: db.prepare('SELECT * FROM giveaways WHERE status = \'open\' AND ends_at <= ?'),
		entry: db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'),
		entries: db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ? ORDER BY at'),
		entryCount: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(entries), 0) AS tickets FROM giveaway_entries WHERE giveaway_id = ?'),
		addEntry: db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id, guild_id, entries, at) VALUES (?, ?, ?, ?, ?)'),
		removeEntry: db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'),
		winners: db.prepare('SELECT * FROM giveaway_winners WHERE giveaway_id = ? ORDER BY id'),
		addWinner: db.prepare('INSERT INTO giveaway_winners (giveaway_id, user_id, drawn_at) VALUES (?, ?, ?)'),
		setWinnerStatus: db.prepare('UPDATE giveaway_winners SET status = ? WHERE id = ?'),
		claim: db.prepare('UPDATE giveaway_winners SET claimed_at = ? WHERE giveaway_id = ? AND user_id = ? AND status = \'winner\' AND claimed_at IS NULL'),
		recentWin: db.prepare('SELECT 1 FROM giveaway_winners WHERE user_id = ? AND status = \'winner\' AND drawn_at >= ? LIMIT 1'),
		unclaimed: db.prepare(`
			SELECT w.*, g.settings FROM giveaway_winners w JOIN giveaways g ON g.id = w.giveaway_id
			WHERE w.status = 'winner' AND w.claimed_at IS NULL AND g.status = 'ended'
		`),
	};
	const refreshes = new Map();
	// Giveaways being opened, drawn or rerolled: the tick and the panel can reach the same one together
	const busy = new Set();

	async function exclusive(id, fn) {
		if (busy.has(id)) throw new ValidationError('Une action est déjà en cours sur ce giveaway, réessaie dans un instant.');
		busy.add(id);
		try {
			return await fn();
		}
		finally {
			busy.delete(id);
		}
	}

	function toGiveaway(row) {
		if (!row) return null;
		return {
			id: row.id,
			prize: row.prize,
			description: row.description,
			winnersCount: row.winners_count,
			settings: JSON.parse(row.settings),
			targets: JSON.parse(row.targets),
			messages: JSON.parse(row.messages),
			status: row.status,
			startsAt: row.starts_at,
			endsAt: row.ends_at,
			draw: row.draw ? JSON.parse(row.draw) : null,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			endedAt: row.ended_at,
		};
	}

	function getOrThrow(id) {
		const g = toGiveaway(q.get.get(id));
		if (!g) throw new NotFoundError('Giveaway introuvable.');
		return g;
	}

	function need(actor) {
		if (!actor.can('giveaways.manage')) throw new ForbiddenError('Permission manquante : giveaways.manage');
	}

	function counts(id) {
		const c = q.entryCount.get(id);
		return { participants: c.n, entries: c.tickets };
	}

	function view(g) {
		return { giveaway: g, ...counts(g.id), winners: q.winners.all(g.id).filter(w => w.status === 'winner').map(w => ({ userId: w.user_id, claimedAt: w.claimed_at })) };
	}

	async function refreshMessages(g) {
		const data = view(g);
		for (const m of g.messages) await executor.upsertGiveawayMessage(m.channelId, m.messageId, data).catch(error => logger.warn(`Giveaway #${g.id} not refreshed:`, error.message));
	}

	function scheduleRefresh(id) {
		if (refreshes.has(id)) return;
		const timer = setTimeout(() => {
			refreshes.delete(id);
			const g = toGiveaway(q.get.get(id));
			if (g) refreshMessages(g).catch(() => null);
		}, 10_000);
		timer.unref?.();
		refreshes.set(id, timer);
	}

	// Every reason why this member can't enter (empty: eligible); also computes the entries
	async function check(g, userId, guildId) {
		const s = g.settings;
		const reasons = [];
		const roles = await executor.getMemberRoleIds(guildId, userId).catch(() => null);
		if (!roles) return { reasons: ['Tu n’es plus membre du serveur.'], entries: 0 };
		if (s.requiredRoleIds.length) {
			const ok = s.requiredMode === 'all' ? s.requiredRoleIds.every(r => roles.includes(r)) : s.requiredRoleIds.some(r => roles.includes(r));
			if (!ok) reasons.push(s.requiredMode === 'all' ? 'Il te manque un des rôles requis.' : 'Il te faut un des rôles requis.');
		}
		if (s.blockedRoleIds.some(r => roles.includes(r))) reasons.push('Un de tes rôles est exclu de ce giveaway.');
		if (s.minAccountAgeDays && now() - accountCreatedAt(userId) < s.minAccountAgeDays * DAY_MS) reasons.push(`Ton compte doit avoir au moins ${s.minAccountAgeDays} jour(s).`);
		if (s.minMemberDays) {
			const info = await executor.getMemberInfo(guildId, userId).catch(() => null);
			if (!info?.joinedAt || now() - info.joinedAt < s.minMemberDays * DAY_MS) reasons.push(`Il faut être sur le serveur depuis ${s.minMemberDays} jour(s).`);
		}
		if (s.minMessages || s.minVoiceHours) {
			const activity = await stats.member(userId, { guildIds: [guildId], days: s.activityDays }).catch(() => ({ messages: 0, voiceHours: 0 }));
			if (s.minMessages && activity.messages < s.minMessages) reasons.push(`Il faut ${s.minMessages} messages sur ${s.activityDays} jours (tu en as ${activity.messages}).`);
			if (s.minVoiceHours && activity.voiceHours < s.minVoiceHours) reasons.push(`Il faut ${s.minVoiceHours} h de vocal sur ${s.activityDays} jours (tu en as ${activity.voiceHours}).`);
		}
		for (const other of s.requiredGuildIds) {
			if (await executor.getMemberRoleIds(other, userId).catch(() => null) === null) reasons.push(`Il faut aussi être sur ${network.find(other)?.name ?? 'un autre serveur du réseau'}.`);
		}
		if (s.noActiveSanction && sanctions.list({ userId, active: true, limit: 1 }).length) reasons.push('Tu as une sanction en cours.');
		if (s.noWarnDays && sanctions.list({ userId, type: 'warn', limit: 20 }).some(w => !w.revokedAt && w.createdAt >= now() - s.noWarnDays * DAY_MS)) reasons.push(`Pas d’avertissement dans les ${s.noWarnDays} derniers jours.`);
		if (s.excludeStaff) {
			const principal = await ranks.resolve(userId);
			if (principal.isOwner || principal.can('giveaways.join_exempt') || principal.level > 0) reasons.push('Le staff ne participe pas à ce giveaway.');
		}
		if (s.excludeHost !== false && g.createdBy && userId === g.createdBy) reasons.push('Tu organises ce giveaway : tu ne peux pas y participer.');
		if (s.excludeRecentWinnersDays && q.recentWin.get(userId, now() - s.excludeRecentWinnersDays * DAY_MS)) reasons.push(`Tu as déjà gagné un giveaway ces ${s.excludeRecentWinnersDays} derniers jours.`);
		const bonuses = s.bonusRoles.filter(b => roles.includes(b.roleId)).map(b => b.entries);
		const bonus = !bonuses.length ? 0 : s.bonusMode === 'max' ? Math.max(...bonuses) - 1 : bonuses.reduce((a, b) => a + b - 1, 0);
		return { reasons, entries: Math.min(1 + bonus, s.maxEntries) };
	}

	function values(input) {
		const v = normalizeGiveaway(input);
		const startsAt = Number.isFinite(input.startsAt) ? input.startsAt : null;
		const endsAt = Number.isFinite(input.endsAt) ? input.endsAt : null;
		if (!endsAt || endsAt < (startsAt ?? now()) + 60_000) throw new ValidationError('La fin doit être au moins une minute après le début.');
		for (const t of v.targets) if (network.find(t.guildId)?.status !== 'active') throw new ValidationError('Un des serveurs ne fait pas partie du réseau.');
		return { prize: v.prize, description: v.description, winnersCount: v.winnersCount, settings: JSON.stringify(v.settings), targets: JSON.stringify(v.targets), startsAt, endsAt };
	}

	async function openGiveaway(g) {
		// Opened meanwhile (by an earlier tick or the panel)
		if (!['draft', 'scheduled'].includes(getOrThrow(g.id).status)) return getOrThrow(g.id);
		const messages = [];
		for (const target of g.targets) {
			try {
				const messageId = await executor.upsertGiveawayMessage(target.channelId, null, view({ ...g, status: 'open' }), { target });
				messages.push({ guildId: target.guildId, channelId: target.channelId, messageId });
			}
			catch (error) {
				logger.warn(`Giveaway #${g.id} not posted in ${target.channelId}:`, error.message);
			}
		}
		if (!messages.length) throw new ValidationError('Le giveaway n’a pu être posté dans aucun salon : vérifie les permissions du bot.');
		q.open.run(JSON.stringify(messages), now(), g.id);
		return getOrThrow(g.id);
	}

	// Draws `count` winners among eligible entries (re-checked now), never someone already drawn.
	// Not stored here: the caller saves them once the draw is sure to count.
	async function drawWinners(g, count, exclude = new Set()) {
		const pool = [];
		const skipped = [];
		for (const e of q.entries.all(g.id)) {
			if (exclude.has(e.user_id)) continue;
			const { reasons } = await check(g, e.user_id, e.guild_id);
			if (reasons.length) skipped.push({ userId: e.user_id, reason: reasons[0] });
			else pool.push({ userId: e.user_id, guildId: e.guild_id, entries: e.entries });
		}
		const chosen = weightedDraw(pool, count);
		return { chosen, pool: pool.length, skipped };
	}

	// Server of a winner's entry, its name and the link to the giveaway message there
	function placeOf(g, userId) {
		const guildId = q.entry.get(g.id, userId)?.guild_id ?? null;
		const message = g.messages.find(m => m.guildId === guildId) ?? g.messages[0] ?? null;
		const serverId = guildId ?? message?.guildId ?? null;
		return {
			guildId,
			serverName: (serverId && network.find(serverId)?.name) || null,
			link: message ? `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.messageId}` : null,
		};
	}

	// A winner who lost the prize (not claimed in time, or replaced by a reroll): the winner role goes away
	async function unreward(g, userId, reason) {
		const s = g.settings;
		const { guildId, serverName } = placeOf(g, userId);
		if (s.winnerRoleId && guildId) {
			await moderation.takeRole(GIVEAWAY, { guildId, userId, roleId: s.winnerRoleId, reason: `Lot du giveaway #${g.id} perdu` })
				.catch(error => logger.warn(`Winner role of giveaway #${g.id} not removed:`, error.message));
		}
		if (reason === 'expired' && s.dmWinners) {
			const where = serverName ? ` sur **${serverName}**` : '';
			await executor.sendDM(userId, `⌛ Tu n’as pas réclamé ton lot à temps${where} : **${g.prize}** (giveaway #${g.id}) a été remis en jeu.`).catch(() => null);
		}
	}

	async function reward(g, userIds) {
		const s = g.settings;
		for (const userId of userIds) {
			const { guildId, serverName, link } = placeOf(g, userId);
			if (s.winnerRoleId) {
				if (guildId) {
					await moderation.giveRole(GIVEAWAY, { guildId, userId, roleId: s.winnerRoleId, durationMs: s.winnerRoleDays ? s.winnerRoleDays * DAY_MS : null, reason: `Gagnant du giveaway #${g.id}` })
						.catch(error => logger.warn(`Winner role of giveaway #${g.id} failed:`, error.message));
				}
			}
			if (s.dmWinners) {
				const claim = s.claimMinutes ? ` Réclame ton lot dans les ${s.claimMinutes} minutes avec le bouton « Je réclame » sous l’annonce.` : '';
				const where = serverName ? ` sur **${serverName}**` : '';
				await executor.sendDM(userId, `🎉 Tu as gagné **${g.prize}** au giveaway #${g.id}${where} !${claim}${link ? `\n${link}` : ''}`).catch(() => null);
			}
		}
	}

	async function announce(g, userIds, { reroll = false } = {}) {
		const text = userIds.length
			? g.settings.winnerMessage.replace(/\{winners\}/g, userIds.map(id => `<@${id}>`).join(', ')).replace(/\{prize\}/g, g.prize)
			: `Personne ne remplissait les conditions : pas de gagnant pour **${g.prize}**.`;
		for (const m of g.messages) {
			await executor.announceGiveawayWinners(m.channelId, m.messageId, { giveaway: g, text: reroll ? `🔁 Nouveau tirage : ${text}` : text, userIds })
				.catch(error => logger.warn(`Winners of giveaway #${g.id} not announced:`, error.message));
		}
	}

	async function endGiveaway(g, by) {
		if (getOrThrow(g.id).status !== 'open') return getOrThrow(g.id);
		const result = await drawWinners(g, g.winnersCount);
		const draw = {
			at: now(),
			pool: result.pool,
			skipped: result.skipped.slice(0, 200),
			picks: result.chosen.map(c => ({ userId: c.userId, entries: c.entries, of: c.ticket })),
			method: 'crypto.randomInt, pondéré par les entrées, sans remise',
		};
		if (!q.end.run(now(), JSON.stringify(draw), now(), g.id).changes) return getOrThrow(g.id);
		for (const c of result.chosen) q.addWinner.run(g.id, c.userId, now());
		const ended = getOrThrow(g.id);
		const winners = result.chosen.map(c => c.userId);
		await refreshMessages(ended);
		await announce(ended, winners);
		await reward(ended, winners);
		audit.record({ actorId: by, source: by === 'system' ? 'system' : 'panel', action: 'giveaways.end', target: String(g.id), details: { prize: g.prize, winners: winners.map(id => `<@${id}>`).join(', ') || 'aucun', participants: counts(g.id).participants } });
		return ended;
	}

	async function redraw(g, { userId = null, count = 1, by, reason = 'reroll' }) {
		const current = q.winners.all(g.id);
		const replaced = userId ? current.filter(w => w.user_id === userId && w.status === 'winner') : [];
		if (userId && !replaced.length) throw new ValidationError('Cette personne n’est pas gagnante de ce giveaway.');
		for (const w of replaced) q.setWinnerStatus.run(reason === 'expired' ? 'expired' : 'rerolled', w.id);
		for (const w of replaced) await unreward(g, w.user_id, reason);
		const exclude = new Set(current.map(w => w.user_id));
		const result = await drawWinners(g, userId ? replaced.length : count, exclude);
		const winners = result.chosen.map(c => c.userId);
		for (const c of result.chosen) q.addWinner.run(g.id, c.userId, now());
		const draw = { ...(g.draw ?? {}), rerolls: [...(g.draw?.rerolls ?? []), { at: now(), replaced: replaced.map(w => w.user_id), picks: winners, reason }] };
		q.setDraw.run(JSON.stringify(draw), g.id);
		await refreshMessages(getOrThrow(g.id));
		await announce(getOrThrow(g.id), winners, { reroll: true });
		await reward(g, winners);
		audit.record({ actorId: by, source: by === 'system' ? 'system' : 'panel', action: 'giveaways.reroll', target: String(g.id), details: { prize: g.prize, winners: winners.map(id => `<@${id}>`).join(', ') || 'aucun', reason } });
		return winners;
	}

	const service = {
		list: () => q.list.all().map(toGiveaway).map(g => ({ ...g, ...counts(g.id), winners: q.winners.all(g.id).filter(w => w.status === 'winner').map(w => w.user_id) })),
		get: (id) => {
			const g = getOrThrow(id);
			return { ...g, ...counts(id), winners: q.winners.all(id).map(w => ({ userId: w.user_id, status: w.status, drawnAt: w.drawn_at, claimedAt: w.claimed_at })) };
		},
		entries: id => q.entries.all(id).map(e => ({ userId: e.user_id, guildId: e.guild_id, entries: e.entries, at: e.at })),

		create(actor, input) {
			need(actor);
			const v = values(input);
			const id = Number(q.insert.run({ ...v, by: actor.id, at: now() }).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'giveaways.create', target: String(id), details: { prize: v.prize } });
			return getOrThrow(id);
		},

		async update(actor, id, input) {
			need(actor);
			const g = getOrThrow(id);
			if (g.status === 'ended' || g.status === 'cancelled') throw new ValidationError('Ce giveaway est terminé : duplique-le.');
			q.update.run({ ...values(input), id, at: now() });
			const updated = getOrThrow(id);
			if (updated.status === 'open') await refreshMessages(updated);
			return updated;
		},

		async publish(actor, id) {
			need(actor);
			const g = getOrThrow(id);
			if (g.status !== 'draft') throw new ValidationError('Ce giveaway est déjà publié.');
			if (!g.targets.length) throw new ValidationError('Choisis au moins un salon.');
			if (g.startsAt && g.startsAt > now() + 30_000) {
				q.setStatus.run('scheduled', now(), id);
				return getOrThrow(id);
			}
			const opened = await exclusive(id, () => openGiveaway(g));
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'giveaways.publish', target: String(id), details: { prize: g.prize } });
			return opened;
		},

		async end(actor, id) {
			need(actor);
			const g = getOrThrow(id);
			if (g.status !== 'open') throw new ValidationError('Ce giveaway n’est pas en cours.');
			return exclusive(id, () => endGiveaway(g, actor.id));
		},

		async reroll(actor, id, { userId = null, count = 1 } = {}) {
			need(actor);
			const g = getOrThrow(id);
			if (g.status !== 'ended') throw new ValidationError('Le giveaway doit être terminé pour relancer un tirage.');
			return exclusive(id, () => redraw(getOrThrow(id), { userId, count: int(count, 1, 50, 1), by: actor.id }));
		},

		async cancel(actor, id) {
			need(actor);
			const g = getOrThrow(id);
			if (g.status === 'ended' || g.status === 'cancelled') throw new ValidationError('Ce giveaway est déjà terminé.');
			q.setStatus.run('cancelled', now(), id);
			await refreshMessages(getOrThrow(id));
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'giveaways.cancel', target: String(id), details: { prize: g.prize } });
			return getOrThrow(id);
		},

		duplicate(actor, id) {
			const g = getOrThrow(id);
			const duration = Math.max((g.endsAt ?? 0) - (g.startsAt ?? g.createdAt), 3600_000);
			return service.create(actor, { ...g, startsAt: null, endsAt: now() + duration });
		},

		async remove(actor, id) {
			need(actor);
			const g = getOrThrow(id);
			for (const m of g.messages) await executor.deleteMessage(m.channelId, m.messageId).catch(() => null);
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'giveaways.delete', target: String(id), details: { prize: g.prize } });
		},

		// The "Participate" button: joins, or leaves when already in
		async toggleEntry(id, userId, guildId) {
			const g = getOrThrow(id);
			if (g.status !== 'open') throw new ValidationError('Ce giveaway n’est pas ouvert.');
			if (q.entry.get(id, userId)) {
				q.removeEntry.run(id, userId);
				scheduleRefresh(id);
				return { joined: false, message: 'Participation retirée.' };
			}
			const { reasons, entries } = await check(g, userId, guildId);
			if (reasons.length) throw new ValidationError(`Tu ne peux pas participer :\n• ${reasons.join('\n• ')}`);
			q.addEntry.run(id, userId, guildId, entries, now());
			scheduleRefresh(id);
			return { joined: true, entries, message: `Tu participes${entries > 1 ? ` avec ${entries} entrées` : ''} ! Clique à nouveau pour te retirer.` };
		},

		// Eligibility of everyone, for the panel (why someone would be skipped at the draw)
		async participants(actor, id) {
			if (!actor.can('giveaways.view')) throw new ForbiddenError('Permission manquante : giveaways.view');
			const g = getOrThrow(id);
			const list = [];
			for (const e of q.entries.all(id)) {
				const { reasons } = g.status === 'open' ? await check(g, e.user_id, e.guild_id) : { reasons: [] };
				list.push({ userId: e.user_id, guildId: e.guild_id, entries: e.entries, at: e.at, eligible: !reasons.length, reason: reasons[0] ?? null });
			}
			return list;
		},

		claim(id, userId) {
			const g = getOrThrow(id);
			if (!q.claim.run(now(), id, userId).changes) throw new ValidationError('Rien à réclamer : tu n’es pas gagnant, ou c’est déjà fait.');
			audit.record({ actorId: userId, source: 'bot', action: 'giveaways.claim', target: String(id), details: { prize: g.prize, member: `<@${userId}>` } });
			return { message: `Lot réclamé ! Le staff va te contacter pour **${g.prize}**.` };
		},

		// Every 30 s: scheduled giveaways to open, ended ones to draw, unclaimed prizes to reroll
		async tick() {
			// A giveaway already being handled is left to the next tick
			for (const row of q.dueStart.all(now())) {
				if (!busy.has(row.id)) await exclusive(row.id, () => openGiveaway(toGiveaway(row))).catch(error => logger.warn(`Giveaway #${row.id} failed to open:`, error.message));
			}
			for (const row of q.dueEnd.all(now())) {
				if (!busy.has(row.id)) await exclusive(row.id, () => endGiveaway(toGiveaway(row), 'system')).catch(error => logger.warn(`Giveaway #${row.id} failed to end:`, error.message));
			}
			for (const w of q.unclaimed.all()) {
				const settings = JSON.parse(w.settings);
				if (settings.claimMinutes && w.drawn_at + settings.claimMinutes * 60_000 <= now() && !busy.has(w.giveaway_id)) {
					await exclusive(w.giveaway_id, async () => {
						// Claimed or rerolled meanwhile
						const still = q.winners.all(w.giveaway_id).find(x => x.id === w.id);
						if (still?.status !== 'winner' || still.claimed_at) return;
						await redraw(getOrThrow(w.giveaway_id), { userId: w.user_id, by: 'system', reason: 'expired' });
					}).catch(error => logger.warn(`Reroll of giveaway #${w.giveaway_id} failed:`, error.message));
				}
			}
		},
	};
	return service;
}
