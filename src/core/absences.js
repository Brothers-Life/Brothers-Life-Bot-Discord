import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('absences.view', { label: 'Voir les absences du staff', category: 'Staff' });
definePermission('absences.declare', { label: 'Déclarer ses propres absences', category: 'Staff' });
definePermission('absences.manage', { label: 'Valider les absences, en déclarer pour les autres, les régler', category: 'Staff' });

const SNOWFLAKE = /^\d{17,20}$/;
const DAY_MS = 86_400_000;
const MAX_DAYS = 365;

export function normalizeAbsenceConfig(input = {}) {
	const roles = {};
	for (const [guildId, roleId] of Object.entries(input.roleByGuild ?? {})) if (SNOWFLAKE.test(guildId) && SNOWFLAKE.test(roleId)) roles[guildId] = roleId;
	return {
		requireApproval: Boolean(input.requireApproval),
		roleByGuild: roles,
		nicknamePrefix: String(input.nicknamePrefix ?? '').slice(0, 10),
		announce: SNOWFLAKE.test(input.announce?.channelId) ? { guildId: input.announce.guildId, channelId: input.announce.channelId } : null,
		remindBeforeEnd: input.remindBeforeEnd !== false,
		// Requests to validate: embed with Valider / Refuser in this channel, only for these roles (of that server)
		review: SNOWFLAKE.test(input.review?.channelId) && SNOWFLAKE.test(input.review?.guildId) ? { guildId: input.review.guildId, channelId: input.review.channelId } : null,
		reviewerRoleIds: [...new Set((Array.isArray(input.reviewerRoleIds) ? input.reviewerRoleIds : []).filter(id => SNOWFLAKE.test(id)))].slice(0, 20),
		pingReviewers: Boolean(input.pingReviewers),
	};
}

// Staff absences: declared (and approved), then applied on every server (role, nickname) while they last
export function createAbsences({ db, network, ranks, audit, executor, settings, logger = console, now = Date.now }) {
	const q = {
		insert: db.prepare(`
			INSERT INTO absences (user_id, start_at, end_at, reason, status, declared_by, reviewed_by, reviewed_at, created_at)
			VALUES (@userId, @startAt, @endAt, @reason, @status, @declaredBy, @reviewedBy, @reviewedAt, @at)
		`),
		get: db.prepare('SELECT * FROM absences WHERE id = ?'),
		overlap: db.prepare('SELECT 1 FROM absences WHERE user_id = ? AND status IN (\'pending\', \'approved\', \'active\') AND start_at < ? AND end_at > ? AND id != ? LIMIT 1'),
		upcoming: db.prepare('SELECT * FROM absences WHERE user_id = ? AND status IN (\'pending\', \'approved\') ORDER BY start_at LIMIT 25'),
		setStatus: db.prepare('UPDATE absences SET status = ?, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = COALESCE(?, reviewed_at) WHERE id = ?'),
		activate: db.prepare('UPDATE absences SET status = \'active\', applied = ? WHERE id = ?'),
		end: db.prepare('UPDATE absences SET status = \'ended\', ended_at = ?, end_at = MIN(end_at, ?) WHERE id = ?'),
		extend: db.prepare('UPDATE absences SET end_at = ?, reminded_at = NULL WHERE id = ?'),
		reminded: db.prepare('UPDATE absences SET reminded_at = ? WHERE id = ?'),
		reviewMessage: db.prepare('UPDATE absences SET review_channel_id = ?, review_message_id = ? WHERE id = ?'),
		toStart: db.prepare('SELECT * FROM absences WHERE status = \'approved\' AND start_at <= ?'),
		toEnd: db.prepare('SELECT * FROM absences WHERE status = \'active\' AND end_at <= ?'),
		toRemind: db.prepare('SELECT * FROM absences WHERE status = \'active\' AND reminded_at IS NULL AND end_at - ? <= ? AND end_at > ?'),
	};

	const toAbsence = row => row && ({
		id: row.id, userId: row.user_id, startAt: row.start_at, endAt: row.end_at, reason: row.reason, status: row.status, declaredBy: row.declared_by,
		reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, createdAt: row.created_at, endedAt: row.ended_at, applied: JSON.parse(row.applied),
		reviewChannelId: row.review_channel_id, reviewMessageId: row.review_message_id,
	});

	function config() {
		return normalizeAbsenceConfig(settings.get('absences.config', {}));
	}

	function getOrThrow(id) {
		const a = toAbsence(q.get.get(id));
		if (!a) throw new NotFoundError('Absence introuvable.');
		return a;
	}

	async function outranks(actor, userId) {
		if (actor.isOwner) return true;
		const target = await ranks.resolve(userId);
		return !target.isOwner && actor.level > target.level;
	}

	// Departures and returns, as an embed in the announce channel
	async function announce(kind, absence) {
		const { announce: target } = config();
		if (!target) return;
		await executor.upsertAbsenceMessage(target.channelId, null, { kind, absence }).catch(error => logger.warn('Absence announce failed:', error.message));
	}

	// The request to validate: posted once when it is pending, then kept up to date (decision, buttons removed)
	async function syncReview(absence) {
		const cfg = config();
		const channelId = absence.reviewChannelId ?? (absence.status === 'pending' ? cfg.review?.channelId : null);
		if (!channelId) return;
		try {
			const ping = !absence.reviewMessageId && cfg.pingReviewers ? cfg.reviewerRoleIds : [];
			const messageId = await executor.upsertAbsenceMessage(channelId, absence.reviewMessageId, { kind: 'review', absence }, { pingRoleIds: ping });
			if (messageId !== absence.reviewMessageId) q.reviewMessage.run(channelId, messageId, absence.id);
		}
		catch (error) {
			logger.warn(`Absence #${absence.id} review message failed:`, error.message);
		}
	}

	// The server named in the DMs: the one where requests are reviewed, else the main one
	function serverName() {
		const guildId = config().review?.guildId;
		return (guildId && network.find(guildId)?.name) || network.getMain()?.name || 'le serveur';
	}

	// Approve or reject a pending absence (checks done by the caller)
	async function decide(actorId, source, absence, approved, reason = '') {
		// Read again with no await before the update: two reviewers clicking at once decide only once
		if (getOrThrow(absence.id).status !== 'pending') throw new ValidationError('Cette absence a déjà été traitée.');
		q.setStatus.run(approved ? 'approved' : 'rejected', actorId, now(), absence.id);
		// Validated too late: already over, so it is closed without role, nickname nor announcement
		const over = approved && absence.endAt <= now();
		if (over) q.end.run(now(), now(), absence.id);
		const why = String(reason ?? '').trim().slice(0, 500);
		const server = serverName();
		let text = `Ton absence sur **${server}** n’a pas été validée.${why ? `\nRaison : ${why}` : ''}`;
		if (approved) text = over ? `Ton absence sur **${server}** est validée (elle est déjà terminée).` : `Ton absence sur **${server}** jusqu’au ${new Date(absence.endAt).toLocaleDateString('fr-FR')} est validée.`;
		await executor.sendDM(absence.userId, text).catch(() => null);
		audit.record({ actorId, source, action: approved ? 'absences.approve' : 'absences.reject', target: absence.userId, details: { member: `<@${absence.userId}>`, reason: why || null } });
		const updated = getOrThrow(absence.id);
		if (approved && !over && updated.startAt <= now()) await apply(updated);
		await syncReview(getOrThrow(absence.id));
		return getOrThrow(absence.id);
	}

	// Role (and nickname prefix) on every server where the person is
	async function apply(absence) {
		const cfg = config();
		const applied = { roles: [], nicknames: [] };
		for (const guildId of network.activeIds()) {
			const roleId = cfg.roleByGuild[guildId];
			if (roleId && await executor.addRole(guildId, absence.userId, roleId, `Absence #${absence.id}`).then(r => r !== 'not_member').catch(() => false)) applied.roles.push({ guildId, roleId });
			if (cfg.nicknamePrefix) {
				const info = await executor.getMemberInfo(guildId, absence.userId).catch(() => null);
				if (info) {
					const user = await executor.getUser(absence.userId);
					const base = info.nickname ?? user?.globalName ?? user?.username ?? '';
					if (!base.startsWith(cfg.nicknamePrefix)) {
						const ok = await executor.setNickname(guildId, absence.userId, `${cfg.nicknamePrefix} ${base}`.slice(0, 32), `Absence #${absence.id}`).then(() => true).catch(() => false);
						if (ok) applied.nicknames.push({ guildId, previous: info.nickname });
					}
				}
			}
		}
		q.activate.run(JSON.stringify(applied), absence.id);
		await announce('away', absence);
	}

	async function unapply(absence) {
		for (const { guildId, roleId } of absence.applied.roles ?? []) await executor.removeRole(guildId, absence.userId, roleId, `Fin de l’absence #${absence.id}`).catch(() => null);
		for (const { guildId, previous } of absence.applied.nicknames ?? []) await executor.setNickname(guildId, absence.userId, previous, `Fin de l’absence #${absence.id}`).catch(() => null);
	}

	async function finish(absence) {
		q.end.run(now(), now(), absence.id);
		await unapply(absence);
		await announce('back', absence);
	}

	const service = {
		config,

		setConfig(actor, input) {
			if (!actor.can('absences.manage')) throw new ForbiddenError('Permission manquante : absences.manage');
			const cfg = normalizeAbsenceConfig(input);
			settings.set('absences.config', cfg);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'absences.config' });
			return cfg;
		},

		async declare(actor, { userId = actor.id, startAt, endAt, reason = '' }) {
			const self = userId === actor.id;
			if (self ? !actor.can('absences.declare') && !actor.can('absences.manage') : !actor.can('absences.manage')) {
				throw new ForbiddenError(self ? 'Permission manquante : absences.declare' : 'Tu ne peux déclarer une absence que pour toi.');
			}
			if (!self && !await outranks(actor, userId)) throw new ForbiddenError('Tu ne peux pas gérer l’absence de quelqu’un de niveau égal ou supérieur.');
			const start = Number.isFinite(startAt) ? startAt : now();
			if (!Number.isFinite(endAt) || endAt <= start + 3600_000) throw new ValidationError('L’absence dure au moins une heure.');
			if (endAt - start > MAX_DAYS * DAY_MS) throw new ValidationError(`Une absence dure ${MAX_DAYS} jours maximum.`);
			if (endAt < now()) throw new ValidationError('Cette absence est déjà terminée.');
			if (q.overlap.get(userId, endAt, start, 0)) throw new ValidationError('Une absence est déjà prévue sur cette période.');
			const approved = !config().requireApproval || actor.can('absences.manage');
			const id = Number(q.insert.run({
				userId, startAt: start, endAt, reason: String(reason).slice(0, 300) || null, status: approved ? 'approved' : 'pending', declaredBy: actor.id,
				reviewedBy: approved ? actor.id : null, reviewedAt: approved ? now() : null, at: now(),
			}).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'absences.declare', target: userId, details: { member: `<@${userId}>`, until: new Date(endAt).toISOString(), reason: reason || null, pending: !approved } });
			if (approved && start <= now()) await apply(getOrThrow(id));
			if (!approved) await syncReview(getOrThrow(id));
			return getOrThrow(id);
		},

		async review(actor, id, approved, reason = '') {
			if (!actor.can('absences.manage')) throw new ForbiddenError('Permission manquante : absences.manage');
			const absence = getOrThrow(id);
			if (absence.status !== 'pending') throw new ValidationError('Cette absence n’est pas en attente.');
			if (!await outranks(actor, absence.userId)) throw new ForbiddenError('Tu ne peux pas valider l’absence de quelqu’un de niveau égal ou supérieur.');
			return decide(actor.id, actor.source ?? 'panel', absence, approved, reason);
		},

		// Checks of the Valider / Refuser buttons, also run before opening the refusal modal
		async assertCanReviewByButton(userId, memberRoleIds, id) {
			const absence = getOrThrow(id);
			const cfg = config();
			const principal = await ranks.resolve(userId);
			const allowed = principal.isOwner || (cfg.reviewerRoleIds.length
				? memberRoleIds.some(roleId => cfg.reviewerRoleIds.includes(roleId))
				: principal.can('absences.manage'));
			if (!allowed) throw new ForbiddenError('Seuls les rôles chargés de valider les absences peuvent décider.');
			if (absence.userId === userId && !principal.isOwner) throw new ForbiddenError('Tu ne peux pas valider ta propre absence.');
			if (absence.status !== 'pending') throw new ValidationError('Cette absence a déjà été traitée.');
			return absence;
		},

		// Valider / Refuser buttons on Discord: only the reviewer roles (or absences.manage when none is set), never for oneself
		async reviewByButton(userId, memberRoleIds, id, approved, reason = '') {
			const absence = await service.assertCanReviewByButton(userId, memberRoleIds, id);
			return decide(userId, 'bot', absence, approved, reason);
		},

		// Cancel one's own absence that has not started yet (waiting for validation or planned)
		async cancel(actor, id) {
			const absence = getOrThrow(id);
			if (absence.userId !== actor.id && !actor.can('absences.manage')) throw new ForbiddenError('Tu ne peux annuler que tes propres absences.');
			if (!['pending', 'approved'].includes(absence.status)) {
				throw new ValidationError(absence.status === 'active' ? 'Cette absence a déjà commencé : utilise /absence retour.' : 'Cette absence est déjà terminée ou annulée.');
			}
			q.setStatus.run('cancelled', null, null, id);
			await syncReview(getOrThrow(id));
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'absences.cancel', target: absence.userId, details: { member: `<@${absence.userId}>` } });
			return getOrThrow(id);
		},

		// Absences of someone that have not started yet (soonest first)
		upcomingFor: userId => q.upcoming.all(userId).map(toAbsence),

		// Back early (or cancelled before it starts)
		async end(actor, id) {
			const absence = getOrThrow(id);
			if (absence.userId !== actor.id && !actor.can('absences.manage')) throw new ForbiddenError('Tu ne peux terminer que tes propres absences.');
			if (!['active', 'pending', 'approved'].includes(absence.status)) throw new ValidationError('Cette absence est déjà terminée.');
			if (absence.status === 'active') {
				await finish(absence);
			}
			else {
				q.setStatus.run('cancelled', null, null, id);
				await syncReview(getOrThrow(id));
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'absences.end', target: absence.userId, details: { member: `<@${absence.userId}>` } });
			return getOrThrow(id);
		},

		async extend(actor, id, endAt) {
			const absence = getOrThrow(id);
			if (absence.userId !== actor.id && !actor.can('absences.manage')) throw new ForbiddenError('Tu ne peux prolonger que tes propres absences.');
			if (!['approved', 'active', 'pending'].includes(absence.status)) throw new ValidationError('Cette absence est terminée.');
			if (!Number.isFinite(endAt) || endAt <= absence.endAt || endAt - absence.startAt > MAX_DAYS * DAY_MS) throw new ValidationError('Nouvelle date de retour invalide.');
			if (q.overlap.get(absence.userId, endAt, absence.endAt, id)) throw new ValidationError('Une autre absence est déjà prévue sur cette période.');
			// Validation required: the extra time of a validated absence is a new request, the absence itself stays as validated
			if (absence.status !== 'pending' && config().requireApproval && !actor.can('absences.manage')) {
				return service.declare(actor, { userId: absence.userId, startAt: absence.endAt, endAt, reason: `Prolongation de l’absence #${id}${absence.reason ? ` · ${absence.reason}` : ''}` });
			}
			q.extend.run(endAt, id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'absences.extend', target: absence.userId, details: { member: `<@${absence.userId}>`, until: new Date(endAt).toISOString() } });
			return getOrThrow(id);
		},

		current: () => db.prepare('SELECT * FROM absences WHERE status = \'active\' ORDER BY end_at').all().map(toAbsence),

		// Who is away right now, with the reasons: staff only, like on the panel
		currentFor(actor) {
			if (!actor.can('absences.view') && !actor.can('absences.manage')) throw new ForbiddenError('Tu n’as pas accès à la liste des absences du staff (permission absences.view).');
			return service.current();
		},
		activeFor: userId => toAbsence(db.prepare('SELECT * FROM absences WHERE user_id = ? AND status = \'active\' LIMIT 1').get(userId)),

		// Someone's own absences (no permission needed to see one's own)
		mine: userId => db.prepare('SELECT * FROM absences WHERE user_id = ? ORDER BY start_at DESC LIMIT 100').all(userId).map(toAbsence),

		list(actor, { from, to, userId, status } = {}) {
			if (!actor.can('absences.view') && !actor.can('absences.manage')) throw new ForbiddenError('Permission manquante : absences.view');
			const where = [
				Number.isFinite(from) && 'end_at >= @from',
				Number.isFinite(to) && 'start_at <= @to',
				userId && 'user_id = @userId',
				status && 'status = @status',
			].filter(Boolean);
			return db.prepare(`SELECT * FROM absences ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY start_at DESC LIMIT 500`).all({ from, to, userId, status }).map(toAbsence);
		},

		// Every minute: absences that start, end, or end tomorrow
		async tick() {
			// Ends first: an absence followed by another one (an extension) takes the role back before the next gives it again
			for (const row of q.toEnd.all(now())) {
				await finish(toAbsence(row)).catch(error => logger.warn(`Absence #${row.id} not ended:`, error.message));
				audit.record({ actorId: 'system', source: 'system', action: 'absences.end', target: row.user_id, details: { member: `<@${row.user_id}>` } });
			}
			for (const row of q.toStart.all(now())) await apply(toAbsence(row)).catch(error => logger.warn(`Absence #${row.id} not applied:`, error.message));
			if (config().remindBeforeEnd) {
				for (const row of q.toRemind.all(now(), DAY_MS, now())) {
					q.reminded.run(now(), row.id);
					await executor.sendDM(row.user_id, `Petit rappel : ton absence se termine le <t:${Math.round(row.end_at / 1000)}:f>. Tu peux la prolonger depuis le panel ou avec /absence.`).catch(() => null);
				}
			}
		},
	};
	return service;
}
