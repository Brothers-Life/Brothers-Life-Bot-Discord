import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeTargets as normalizePingTargets } from './announcements.js';
import { accountCreatedAt } from './ticketConfig.js';

definePermission('polls.view', { label: 'Voir les sondages et leurs résultats', category: 'Sondages' });
definePermission('polls.manage', { label: 'Créer, publier et fermer des sondages', category: 'Sondages' });

const SNOWFLAKE = /^\d{17,20}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);

// Buttons vote one choice at a time: a poll needing several choices at once (a minimum above 1, or several
// choices without changing one's vote afterwards) can only be answered with a menu
export function withVotableStyle(settings) {
	const needsMenu = settings.minChoices > 1 || (settings.maxChoices > 1 && !settings.allowChange);
	return needsMenu && settings.style !== 'select' ? { ...settings, style: 'select' } : settings;
}

export function normalizePoll(input) {
	const question = String(input.question ?? '').trim();
	if (!question || question.length > 250) throw new ValidationError('La question fait 1 à 250 caractères.');
	const seen = new Set();
	const options = (Array.isArray(input.options) ? input.options : []).slice(0, 25).map((o, i) => {
		const label = String(o?.label ?? '').trim().slice(0, 80);
		let id = typeof o?.id === 'string' && /^[a-z0-9]{1,12}$/.test(o.id) ? o.id : `o${i + 1}`;
		while (seen.has(id)) id = `${id}x`;
		seen.add(id);
		return { id, label, emoji: String(o?.emoji ?? '').trim().slice(0, 64), description: String(o?.description ?? '').trim().slice(0, 100) };
	}).filter(o => o.label);
	if (options.length < 2) throw new ValidationError('Il faut au moins 2 choix.');
	const s = input.settings ?? {};
	const multiple = Boolean(s.multiple);
	const maxChoices = multiple ? int(s.maxChoices, 1, options.length, options.length) : 1;
	return {
		question,
		description: String(input.description ?? '').slice(0, 2000),
		options,
		settings: withVotableStyle({
			multiple,
			minChoices: multiple ? Math.min(int(s.minChoices, 1, options.length, 1), maxChoices) : 1,
			maxChoices,
			allowChange: s.allowChange !== false,
			anonymous: s.anonymous !== false,
			showResults: ['live', 'end', 'never'].includes(s.showResults) ? s.showResults : 'live',
			// Buttons: 4 rows of 5 at most (the last row is for "my vote" / "who voted")
			style: options.length > 20 ? 'select' : ['buttons', 'select'].includes(s.style) ? s.style : options.length > 5 ? 'select' : 'buttons',
			requiredRoleIds: (Array.isArray(s.requiredRoleIds) ? s.requiredRoleIds : []).filter(r => SNOWFLAKE.test(r)).slice(0, 25),
			blockedRoleIds: (Array.isArray(s.blockedRoleIds) ? s.blockedRoleIds : []).filter(r => SNOWFLAKE.test(r)).slice(0, 25),
			minAccountAgeDays: int(s.minAccountAgeDays, 0, 3650, 0),
			minMemberDays: int(s.minMemberDays, 0, 3650, 0),
			maxVotes: int(s.maxVotes, 0, 1_000_000, 0),
			pin: Boolean(s.pin),
			color: COLOR.test(s.color ?? '') ? s.color : '#d6a249',
			image: typeof s.image === 'string' && /^https:\/\/\S+$/.test(s.image) ? s.image : null,
			resultsMessage: s.resultsMessage !== false,
		}),
		targets: input.targets?.length ? normalizePingTargets(input.targets) : [],
	};
}

// Polls counted across every channel they are posted in
export function createPolls({ db, network, audit, executor, logger = console, now = Date.now }) {
	const q = {
		list: db.prepare('SELECT * FROM polls ORDER BY id DESC LIMIT 200'),
		get: db.prepare('SELECT * FROM polls WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO polls (question, description, options, settings, targets, starts_at, ends_at, created_by, created_at, updated_at)
			VALUES (@question, @description, @options, @settings, @targets, @startsAt, @endsAt, @by, @at, @at)
		`),
		update: db.prepare(`
			UPDATE polls SET question = @question, description = @description, options = @options, settings = @settings, targets = @targets,
				starts_at = @startsAt, ends_at = @endsAt, updated_at = @at WHERE id = @id
		`),
		setStatus: db.prepare('UPDATE polls SET status = ?, updated_at = ? WHERE id = ?'),
		open: db.prepare('UPDATE polls SET status = \'open\', opened_at = ?, messages = ?, closed_at = NULL, updated_at = ? WHERE id = ?'),
		close: db.prepare('UPDATE polls SET status = \'closed\', closed_at = ?, updated_at = ? WHERE id = ? AND status = \'open\''),
		setMessages: db.prepare('UPDATE polls SET messages = ? WHERE id = ?'),
		remove: db.prepare('DELETE FROM polls WHERE id = ?'),
		dueStart: db.prepare('SELECT * FROM polls WHERE status = \'scheduled\' AND starts_at <= ?'),
		dueEnd: db.prepare('SELECT * FROM polls WHERE status = \'open\' AND ends_at IS NOT NULL AND ends_at <= ?'),
		votesOf: db.prepare('SELECT choice FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
		clearVotes: db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
		addVote: db.prepare('INSERT OR IGNORE INTO poll_votes (poll_id, user_id, choice, guild_id, at) VALUES (?, ?, ?, ?, ?)'),
		counts: db.prepare('SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice'),
		voters: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?'),
		byGuild: db.prepare('SELECT guild_id AS guildId, choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY guild_id, choice'),
		votersOf: db.prepare('SELECT user_id AS userId FROM poll_votes WHERE poll_id = ? AND choice = ? ORDER BY at LIMIT 100'),
		allVotes: db.prepare('SELECT user_id AS userId, choice, guild_id AS guildId, at FROM poll_votes WHERE poll_id = ? ORDER BY at'),
	};
	// pollId -> pending refresh timer (vote bursts are grouped)
	const refreshes = new Map();
	// Polls being posted: the tick and the panel (or two ticks) must not post them twice
	const opening = new Set();

	function toPoll(row) {
		if (!row) return null;
		return {
			id: row.id,
			question: row.question,
			description: row.description,
			options: JSON.parse(row.options),
			settings: withVotableStyle(JSON.parse(row.settings)),
			targets: JSON.parse(row.targets),
			messages: JSON.parse(row.messages),
			status: row.status,
			startsAt: row.starts_at,
			endsAt: row.ends_at,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			openedAt: row.opened_at,
			closedAt: row.closed_at,
		};
	}

	function getOrThrow(id) {
		const poll = toPoll(q.get.get(id));
		if (!poll) throw new NotFoundError('Sondage introuvable.');
		return poll;
	}

	function need(actor) {
		if (!actor.can('polls.manage')) throw new ForbiddenError('Permission manquante : polls.manage');
	}

	function results(poll) {
		const counts = Object.fromEntries(q.counts.all(poll.id).map(r => [r.choice, r.n]));
		const total = Object.values(counts).reduce((a, b) => a + b, 0);
		return {
			voters: q.voters.get(poll.id).n,
			total,
			options: poll.options.map(o => ({ ...o, votes: counts[o.id] ?? 0, percent: total ? Math.round(((counts[o.id] ?? 0) / total) * 1000) / 10 : 0 })),
		};
	}

	// What the Discord message shows right now
	function view(poll) {
		const r = results(poll);
		const visible = poll.status === 'closed' ? poll.settings.showResults !== 'never' : poll.settings.showResults === 'live';
		return { poll, results: r, showResults: visible };
	}

	async function refreshMessages(poll) {
		const data = view(poll);
		for (const m of poll.messages) {
			await executor.upsertPollMessage(m.channelId, m.messageId, data).catch(error => logger.warn(`Poll #${poll.id} not refreshed in ${m.channelId}:`, error.message));
		}
	}

	function scheduleRefresh(pollId) {
		if (refreshes.has(pollId)) return;
		const timer = setTimeout(() => {
			refreshes.delete(pollId);
			const poll = toPoll(q.get.get(pollId));
			if (poll) refreshMessages(poll).catch(() => null);
		}, 5000);
		timer.unref?.();
		refreshes.set(pollId, timer);
	}

	function values(input, poll) {
		const p = normalizePoll(input);
		const startsAt = Number.isFinite(input.startsAt) ? input.startsAt : null;
		const endsAt = Number.isFinite(input.endsAt) ? input.endsAt : null;
		if (endsAt && endsAt <= (startsAt ?? now()) + 60_000) throw new ValidationError('La fin doit être au moins une minute après le début.');
		for (const t of p.targets) if (network.find(t.guildId)?.status !== 'active') throw new ValidationError('Un des serveurs ne fait pas partie du réseau.');
		if (poll && poll.status !== 'draft' && poll.status !== 'scheduled' && JSON.stringify(p.options.map(o => o.id)) !== JSON.stringify(poll.options.map(o => o.id))) {
			throw new ValidationError('Les choix d’un sondage déjà publié ne peuvent plus changer.');
		}
		return { question: p.question, description: p.description, options: JSON.stringify(p.options), settings: JSON.stringify(p.settings), targets: JSON.stringify(p.targets), startsAt, endsAt };
	}

	async function openPoll(poll) {
		if (opening.has(poll.id)) throw new ValidationError('Ce sondage est déjà en cours de publication.');
		// Opened meanwhile
		if (!['draft', 'scheduled'].includes(getOrThrow(poll.id).status)) return getOrThrow(poll.id);
		opening.add(poll.id);
		try {
			return await postPoll(poll);
		}
		finally {
			opening.delete(poll.id);
		}
	}

	async function postPoll(poll) {
		const messages = [];
		for (const target of poll.targets) {
			try {
				const messageId = await executor.upsertPollMessage(target.channelId, null, view({ ...poll, status: 'open' }), { target });
				messages.push({ guildId: target.guildId, channelId: target.channelId, messageId });
			}
			catch (error) {
				logger.warn(`Poll #${poll.id} not posted in ${target.channelId}:`, error.message);
			}
		}
		if (!messages.length) throw new ValidationError('Le sondage n’a pu être posté dans aucun salon : vérifie les permissions du bot.');
		q.open.run(now(), JSON.stringify(messages), now(), poll.id);
		return getOrThrow(poll.id);
	}

	async function closePoll(poll, by) {
		if (!q.close.run(now(), now(), poll.id).changes) return getOrThrow(poll.id);
		const closed = getOrThrow(poll.id);
		clearTimeout(refreshes.get(poll.id));
		refreshes.delete(poll.id);
		await refreshMessages(closed);
		if (closed.settings.resultsMessage && closed.settings.showResults !== 'never') {
			for (const m of closed.messages) await executor.sendPollResults(m.channelId, m.messageId, view(closed)).catch(() => null);
		}
		audit.record({ actorId: by, source: by === 'system' ? 'system' : 'panel', action: 'polls.close', target: String(poll.id), details: { question: poll.question, voters: results(closed).voters } });
		return closed;
	}

	const service = {
		list: () => q.list.all().map(toPoll).map(p => ({ ...p, results: results(p) })),
		get: id => {
			const poll = getOrThrow(id);
			return { ...poll, results: results(poll), byGuild: q.byGuild.all(id) };
		},
		results: id => results(getOrThrow(id)),

		create(actor, input) {
			need(actor);
			const v = values(input);
			const id = Number(q.insert.run({ ...v, by: actor.id, at: now() }).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'polls.create', target: String(id), details: { question: v.question } });
			return getOrThrow(id);
		},

		async update(actor, id, input) {
			need(actor);
			const poll = getOrThrow(id);
			if (poll.status === 'closed') throw new ValidationError('Un sondage fermé ne se modifie plus : duplique-le.');
			q.update.run({ ...values(input, poll), id, at: now() });
			const updated = getOrThrow(id);
			if (updated.status === 'open') await refreshMessages(updated);
			return updated;
		},

		// Now, or at its start date
		async publish(actor, id) {
			need(actor);
			const poll = getOrThrow(id);
			if (poll.status === 'open' || poll.status === 'closed') throw new ValidationError('Ce sondage est déjà publié.');
			if (!poll.targets.length) throw new ValidationError('Choisis au moins un salon.');
			if (poll.startsAt && poll.startsAt > now() + 30_000) {
				q.setStatus.run('scheduled', now(), id);
				audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'polls.schedule', target: String(id), details: { question: poll.question } });
				return getOrThrow(id);
			}
			const opened = await openPoll(poll);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'polls.publish', target: String(id), details: { question: poll.question, channels: opened.messages.length } });
			return opened;
		},

		async close(actor, id) {
			need(actor);
			const poll = getOrThrow(id);
			if (poll.status !== 'open') throw new ValidationError('Ce sondage n’est pas ouvert.');
			return closePoll(poll, actor.id);
		},

		duplicate(actor, id) {
			need(actor);
			const poll = getOrThrow(id);
			return service.create(actor, { ...poll, question: `${poll.question}`.slice(0, 250), startsAt: null, endsAt: null });
		},

		async remove(actor, id) {
			need(actor);
			const poll = getOrThrow(id);
			for (const m of poll.messages) await executor.deleteMessage(m.channelId, m.messageId).catch(() => null);
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'polls.delete', target: String(id), details: { question: poll.question } });
		},

		// A vote from Discord: choices are option ids (one for buttons, several from a menu)
		async vote(pollId, userId, guildId, choices) {
			const poll = getOrThrow(pollId);
			if (poll.status !== 'open') throw new ValidationError('Ce sondage est fermé.');
			const { settings } = poll;
			const valid = [...new Set(choices)].filter(c => poll.options.some(o => o.id === c));
			if (!valid.length) throw new ValidationError('Choix inconnu.');
			if (settings.minAccountAgeDays && now() - accountCreatedAt(userId) < settings.minAccountAgeDays * 86_400_000) {
				throw new ValidationError(`Ton compte doit avoir au moins ${settings.minAccountAgeDays} jour(s) pour voter.`);
			}
			if (settings.requiredRoleIds.length || settings.blockedRoleIds.length) {
				const roles = await executor.getMemberRoleIds(guildId, userId) ?? [];
				if (settings.blockedRoleIds.some(r => roles.includes(r))) throw new ValidationError('Tu ne peux pas voter à ce sondage.');
				if (settings.requiredRoleIds.length && !settings.requiredRoleIds.some(r => roles.includes(r))) throw new ValidationError('Il te manque un rôle pour voter.');
			}
			if (settings.minMemberDays) {
				const info = await executor.getMemberInfo(guildId, userId).catch(() => null);
				if (!info?.joinedAt || now() - info.joinedAt < settings.minMemberDays * 86_400_000) {
					throw new ValidationError(`Il faut être sur le serveur depuis au moins ${settings.minMemberDays} jour(s) pour voter.`);
				}
			}
			// Closed while the member was being checked
			if (toPoll(q.get.get(pollId))?.status !== 'open') throw new ValidationError('Ce sondage est fermé.');
			const previous = q.votesOf.all(pollId, userId).map(r => r.choice);
			let next;
			if (!settings.multiple) {
				next = [valid[0]];
				if (previous.length && previous[0] === valid[0]) return { choices: previous, changed: false, message: 'Tu as déjà voté pour ce choix.' };
			}
			else if (choices.length === 1 && previous.length && valid.length === 1) {
				// A button of a multiple choice poll toggles that choice
				next = previous.includes(valid[0]) ? previous.filter(c => c !== valid[0]) : [...previous, valid[0]];
			}
			else {
				next = valid;
			}
			if (previous.length && !settings.allowChange) throw new ValidationError('Tu as déjà voté, et ce sondage ne permet pas de changer.');
			if (next.length > settings.maxChoices) throw new ValidationError(`${settings.maxChoices} choix maximum.`);
			if (next.length && next.length < settings.minChoices) throw new ValidationError(`Choisis au moins ${settings.minChoices} réponses.`);
			db.transaction(() => {
				q.clearVotes.run(pollId, userId);
				for (const c of next) q.addVote.run(pollId, userId, c, guildId, now());
			})();
			if (settings.maxVotes && q.voters.get(pollId).n >= settings.maxVotes) await closePoll(poll, 'system');
			else if (settings.showResults === 'live') scheduleRefresh(pollId);
			const labels = next.map(c => poll.options.find(o => o.id === c)?.label).join(', ');
			return { choices: next, changed: true, message: next.length ? `Vote enregistré : ${labels}` : 'Vote retiré.' };
		},

		// Who voted for a choice (not for anonymous polls, except to know one's own vote)
		voters(pollId, choice, { own = null } = {}) {
			const poll = getOrThrow(pollId);
			if (own) return q.votesOf.all(pollId, own).map(r => r.choice).includes(choice) ? [own] : [];
			if (poll.settings.anonymous) throw new ForbiddenError('Ce sondage est anonyme.');
			return q.votersOf.all(pollId, choice).map(r => r.userId);
		},

		allVotes(actor, pollId) {
			if (!actor.can('polls.view')) throw new ForbiddenError('Permission manquante : polls.view');
			const poll = getOrThrow(pollId);
			const votes = q.allVotes.all(pollId);
			return poll.settings.anonymous ? votes.map(v => ({ ...v, userId: null })) : votes;
		},

		// Every 30 s: scheduled polls to open, open polls to close
		async tick() {
			for (const row of q.dueStart.all(now())) {
				if (opening.has(row.id)) continue;
				await openPoll(toPoll(row)).catch(error => logger.warn(`Scheduled poll #${row.id} failed:`, error.message));
			}
			for (const row of q.dueEnd.all(now())) await closePoll(toPoll(row), 'system').catch(error => logger.warn(`Poll #${row.id} failed to close:`, error.message));
		},
	};
	return service;
}
