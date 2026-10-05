import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeTargets } from './announcements.js';

definePermission('rpevents.view', { label: 'Voir les événements RP et leurs inscrits', category: 'Événements RP' });
definePermission('rpevents.manage', { label: 'Créer, modifier et annuler des événements RP', category: 'Événements RP' });

const SNOWFLAKE = /^\d{17,20}$/;
const UPLOAD = /^upload:[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
const HTTPS = /^https:\/\/\S+$/;
const MINUTE = 60_000;

export function normalizeEvent(input = {}, { now = Date.now() } = {}) {
	const title = String(input.title ?? '').trim();
	if (!title || title.length > 100) throw new ValidationError('Le titre fait 1 à 100 caractères.');
	const description = String(input.description ?? '').slice(0, 2000);
	const image = input.image ? String(input.image) : null;
	if (image && !UPLOAD.test(image) && !HTTPS.test(image)) throw new ValidationError('Image : envoie une image ou donne une adresse https://.');
	const startsAt = Number(input.startsAt);
	const endsAt = Number(input.endsAt);
	if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw new ValidationError('Dates de début et de fin obligatoires.');
	if (endsAt <= startsAt) throw new ValidationError('La fin doit être après le début.');
	if (endsAt - startsAt > 7 * 24 * 60 * MINUTE) throw new ValidationError('Un événement dure 7 jours au maximum.');
	if (endsAt < now) throw new ValidationError('Cet événement est déjà terminé.');
	const capacity = input.capacity === null || input.capacity === undefined || input.capacity === '' ? null : Number(input.capacity);
	if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000)) throw new ValidationError('Places : de 1 à 10 000, ou illimité.');
	const reminders = [...new Set((Array.isArray(input.reminders) ? input.reminders : []).map(Number).filter(m => Number.isInteger(m) && m >= 1 && m <= 10_080))].sort((a, b) => b - a).slice(0, 5);
	const roles = {};
	for (const [guildId, roleId] of Object.entries(input.roles ?? {})) if (SNOWFLAKE.test(guildId) && SNOWFLAKE.test(roleId)) roles[guildId] = roleId;
	return {
		title, description, image,
		location: String(input.location ?? '').trim().slice(0, 200) || null,
		startsAt, endsAt, capacity, allowMaybe: input.allowMaybe !== false, reminders, roles,
		targets: normalizeTargets(input.targets ?? []),
	};
}

// RP events: sign-ups with buttons (with a waiting list when full), DM reminders, a "participant" role while it lasts
export function createRpEvents({ db, network, audit, executor, uploads = null, logger = console, now = Date.now }) {
	const q = {
		insert: db.prepare(`
			INSERT INTO rp_events (title, description, image, location, starts_at, ends_at, capacity, allow_maybe, targets, roles, reminders, created_by, created_at, updated_at)
			VALUES (@title, @description, @image, @location, @startsAt, @endsAt, @capacity, @allowMaybe, @targets, @roles, @reminders, @by, @at, @at)
		`),
		update: db.prepare(`
			UPDATE rp_events SET title = @title, description = @description, image = @image, location = @location, starts_at = @startsAt, ends_at = @endsAt,
				capacity = @capacity, allow_maybe = @allowMaybe, targets = @targets, roles = @roles, reminders = @reminders, updated_at = @at WHERE id = @id
		`),
		get: db.prepare('SELECT * FROM rp_events WHERE id = ?'),
		list: db.prepare('SELECT * FROM rp_events ORDER BY starts_at DESC LIMIT 300'),
		upcoming: db.prepare('SELECT * FROM rp_events WHERE status IN (\'scheduled\', \'live\') ORDER BY starts_at'),
		setStatus: db.prepare('UPDATE rp_events SET status = ?, updated_at = ? WHERE id = ?'),
		setMessages: db.prepare('UPDATE rp_events SET messages = ? WHERE id = ?'),
		setReminded: db.prepare('UPDATE rp_events SET reminded = ? WHERE id = ?'),
		delete: db.prepare('DELETE FROM rp_events WHERE id = ?'),
		rsvps: db.prepare('SELECT * FROM rp_event_rsvps WHERE event_id = ? ORDER BY at'),
		rsvp: db.prepare('SELECT * FROM rp_event_rsvps WHERE event_id = ? AND user_id = ?'),
		upsertRsvp: db.prepare('INSERT INTO rp_event_rsvps (event_id, user_id, status, at) VALUES (?, ?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status, at = CASE WHEN rp_event_rsvps.status = excluded.status THEN rp_event_rsvps.at ELSE excluded.at END'),
		deleteRsvp: db.prepare('DELETE FROM rp_event_rsvps WHERE event_id = ? AND user_id = ?'),
		countGoing: db.prepare('SELECT COUNT(*) AS n FROM rp_event_rsvps WHERE event_id = ? AND status = \'going\''),
		firstWaiting: db.prepare('SELECT * FROM rp_event_rsvps WHERE event_id = ? AND status = \'waitlist\' ORDER BY at LIMIT 1'),
	};

	function toEvent(row) {
		if (!row) return null;
		const rsvps = q.rsvps.all(row.id).map(r => ({ userId: r.user_id, status: r.status, at: r.at }));
		return {
			id: row.id, title: row.title, description: row.description, image: row.image, location: row.location, startsAt: row.starts_at, endsAt: row.ends_at,
			capacity: row.capacity, allowMaybe: Boolean(row.allow_maybe), targets: JSON.parse(row.targets), roles: JSON.parse(row.roles),
			reminders: JSON.parse(row.reminders), reminded: JSON.parse(row.reminded), messages: JSON.parse(row.messages), status: row.status,
			createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, rsvps,
			counts: { going: rsvps.filter(r => r.status === 'going').length, maybe: rsvps.filter(r => r.status === 'maybe').length, waitlist: rsvps.filter(r => r.status === 'waitlist').length },
		};
	}

	function getOrThrow(id) {
		const e = toEvent(q.get.get(id));
		if (!e) throw new NotFoundError('Événement introuvable.');
		return e;
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function imageFiles(e) {
		if (!e.image || !UPLOAD.test(e.image)) return { imageUrl: e.image, files: [] };
		const id = e.image.slice(7);
		return { imageUrl: `attachment://${id}`, files: uploads ? [{ name: id, attachment: uploads.file(id) }] : [] };
	}

	// The message of the event in each channel, created or kept up to date
	async function refreshMessages(e, { create = false } = {}) {
		const { imageUrl, files } = imageFiles(e);
		const view = { ...e, imageUrl };
		const known = new Map(e.messages.map(m => [m.channelId, m.messageId]));
		const messages = [];
		for (const t of e.targets) {
			const messageId = known.get(t.channelId) ?? null;
			if (!messageId && !create) continue;
			try {
				messages.push({ channelId: t.channelId, messageId: await executor.upsertEventMessage(t.channelId, messageId, view, { target: t, files: messageId ? [] : files }) });
			}
			catch (error) {
				logger.warn(`Event #${e.id} message in ${t.channelId} failed:`, error.message);
				if (messageId) messages.push({ channelId: t.channelId, messageId });
			}
		}
		// Channels removed from the event: their message goes too
		if (create) {
			for (const m of e.messages) if (!e.targets.some(t => t.channelId === m.channelId)) await executor.deleteMessage(m.channelId, m.messageId).catch(() => null);
		}
		q.setMessages.run(JSON.stringify(messages), e.id);
	}

	function record(actor, action, e, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(e.id), details: { title: e.title, ...details } });
	}

	async function setRoles(e, add) {
		const going = e.rsvps.filter(r => r.status === 'going');
		for (const [guildId, roleId] of Object.entries(e.roles)) {
			if (network.find(guildId)?.status !== 'active') continue;
			for (const r of going) {
				const fn = add ? executor.addRole : executor.removeRole;
				await fn.call(executor, guildId, r.userId, roleId, `Événement « ${e.title} »`).catch(() => null);
			}
		}
	}

	// Free seats (capacity raised or removed): the waiting list moves up in order. Returns who got a seat
	function promoteWaitlist(e) {
		const promoted = [];
		let going = e.counts.going;
		for (const r of e.rsvps.filter(x => x.status === 'waitlist')) {
			if (e.capacity !== null && going >= e.capacity) break;
			q.upsertRsvp.run(e.id, r.userId, 'going', now());
			promoted.push(r.userId);
			going += 1;
		}
		return promoted;
	}

	return {
		list: () => q.list.all().map(toEvent),
		get: getOrThrow,
		upcoming: () => q.upcoming.all().map(toEvent),

		async save(actor, input) {
			need(actor, 'rpevents.manage');
			const current = input.id ? getOrThrow(input.id) : null;
			if (current && ['ended', 'cancelled'].includes(current.status)) throw new ValidationError('Cet événement est terminé ou annulé.');
			const c = normalizeEvent(input, { now: now() });
			if (!c.targets.length) throw new ValidationError('Choisis au moins un salon où annoncer l’événement.');
			for (const t of c.targets) if (network.find(t.guildId)?.status !== 'active') throw new ValidationError('Un des serveurs choisis ne fait pas partie du réseau.');
			if (c.image && UPLOAD.test(c.image) && uploads && !uploads.exists(c.image.slice(7))) throw new ValidationError('L’image envoyée n’existe plus : renvoie-la.');
			const row = { ...c, allowMaybe: c.allowMaybe ? 1 : 0, targets: JSON.stringify(c.targets), roles: JSON.stringify(c.roles), reminders: JSON.stringify(c.reminders), by: actor.id, at: now() };
			let id = current?.id;
			if (current) q.update.run({ ...row, id });
			else id = Number(q.insert.run(row).lastInsertRowid);
			const moved = current && current.startsAt !== c.startsAt;
			// New date: the reminders are sent again before it
			if (moved) q.setReminded.run('[]', id);
			const promoted = current ? promoteWaitlist(getOrThrow(id)) : [];
			const e = getOrThrow(id);
			// New channels get the message, the others are edited
			await refreshMessages(e, { create: true });
			if (moved) {
				const when = `<t:${Math.floor(e.startsAt / 1000)}:F>`;
				for (const r of e.rsvps) await executor.sendDM(r.userId, `📅 L’événement « ${e.title} » a été déplacé au ${when}.`).catch(() => null);
			}
			for (const userId of promoted) {
				await executor.sendDM(userId, `🎟️ Des places ont été ajoutées : tu es inscrit à « ${e.title} » (<t:${Math.floor(e.startsAt / 1000)}:F>).`).catch(() => null);
				if (e.status === 'live') {
					for (const [guildId, roleId] of Object.entries(e.roles)) await executor.addRole(guildId, userId, roleId, `Événement « ${e.title} »`).catch(() => null);
				}
			}
			record(actor, current ? 'rpevents.update' : 'rpevents.create', e, { when: new Date(e.startsAt).toISOString() });
			return getOrThrow(id);
		},

		async cancel(actor, id, reason = '') {
			need(actor, 'rpevents.manage');
			const e = getOrThrow(id);
			if (['ended', 'cancelled'].includes(e.status)) throw new ValidationError('Cet événement est déjà terminé ou annulé.');
			if (e.status === 'live') await setRoles(e, false);
			q.setStatus.run('cancelled', now(), id);
			const cancelled = getOrThrow(id);
			await refreshMessages(cancelled);
			// Everyone who answered: registered, maybe and waiting list
			for (const r of cancelled.rsvps) {
				await executor.sendDM(r.userId, `❌ L’événement « ${e.title} » est annulé.${reason ? ` ${String(reason).slice(0, 300)}` : ''}`).catch(() => null);
			}
			record(actor, 'rpevents.cancel', e, { reason: reason || null });
			return cancelled;
		},

		async remove(actor, id) {
			need(actor, 'rpevents.manage');
			const e = getOrThrow(id);
			if (e.status === 'live') await setRoles(e, false);
			for (const m of e.messages) await executor.deleteMessage(m.channelId, m.messageId).catch(() => null);
			q.delete.run(id);
			record(actor, 'rpevents.delete', e);
		},

		// A member's answer from the buttons: going, maybe or leave. Returns { status, event, promoted }
		async rsvp(userId, id, choice) {
			const e = getOrThrow(id);
			if (!['scheduled', 'live'].includes(e.status)) throw new ValidationError('Les inscriptions sont fermées.');
			if (choice === 'maybe' && !e.allowMaybe) throw new ValidationError('« Peut-être » n’est pas proposé pour cet événement.');
			const before = q.rsvp.get(id, userId);
			let status = choice;
			let promoted = null;
			if (choice === 'leave') {
				q.deleteRsvp.run(id, userId);
				status = null;
			}
			else if (choice === 'going') {
				const full = e.capacity !== null && q.countGoing.get(id).n >= e.capacity && before?.status !== 'going';
				status = full ? 'waitlist' : 'going';
				q.upsertRsvp.run(id, userId, status, now());
			}
			else {
				q.upsertRsvp.run(id, userId, 'maybe', now());
			}
			// A seat freed: the first on the waiting list takes it
			if (before?.status === 'going' && status !== 'going' && e.capacity !== null) {
				const next = q.firstWaiting.get(id);
				if (next) {
					q.upsertRsvp.run(id, next.user_id, 'going', now());
					promoted = next.user_id;
					await executor.sendDM(next.user_id, `🎟️ Une place s’est libérée : tu es inscrit à « ${e.title} » (<t:${Math.floor(e.startsAt / 1000)}:F>).`).catch(() => null);
				}
			}
			const updated = getOrThrow(id);
			// Already live: the role follows the sign-ups
			if (updated.status === 'live') {
				for (const [guildId, roleId] of Object.entries(updated.roles)) {
					if (status === 'going') await executor.addRole(guildId, userId, roleId, `Événement « ${e.title} »`).catch(() => null);
					else if (before?.status === 'going') await executor.removeRole(guildId, userId, roleId, `Événement « ${e.title} »`).catch(() => null);
					if (promoted) await executor.addRole(guildId, promoted, roleId, `Événement « ${e.title} »`).catch(() => null);
				}
			}
			await refreshMessages(updated);
			return { status, event: updated, promoted };
		},

		// Every minute: reminders, start (role given), end (role taken back, message closed)
		async tick() {
			for (const e of q.upcoming.all().map(toEvent)) {
				const due = e.reminders.filter(m => !e.reminded.includes(m) && now() >= e.startsAt - m * MINUTE && now() < e.startsAt);
				if (due.length) {
					// Marked first: sending many DMs is slow, a run at the same time must not send them again
					q.setReminded.run(JSON.stringify([...e.reminded, ...due]), e.id);
					for (const r of e.rsvps.filter(x => x.status === 'going' || x.status === 'maybe')) {
						await executor.sendDM(r.userId, `⏰ Rappel : « ${e.title} » commence <t:${Math.floor(e.startsAt / 1000)}:R>${e.location ? ` · 📍 ${e.location}` : ''}.`).catch(() => null);
					}
				}
				if (e.status === 'scheduled' && now() >= e.startsAt && now() < e.endsAt) {
					q.setStatus.run('live', now(), e.id);
					const live = getOrThrow(e.id);
					await setRoles(live, true);
					await refreshMessages(live);
				}
				if (now() >= e.endsAt) {
					if (e.status === 'live') await setRoles(e, false);
					q.setStatus.run('ended', now(), e.id);
					await refreshMessages(getOrThrow(e.id));
				}
			}
		},
	};
}
