import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { listStaff } from './staffActivity.js';
import { nextOccurrence, normalizeRecurrence } from './recurrence.js';

definePermission('meetings.view', { label: 'Voir les réunions du staff, leurs présences et comptes rendus', category: 'Staff' });
definePermission('meetings.manage', { label: 'Organiser les réunions (convoquer, démarrer, terminer, compte rendu, tâches)', category: 'Staff' });

const SNOWFLAKE = /^\d{17,20}$/;
const MINUTE = 60_000;
const LATE_AFTER = 5 * MINUTE;
const ANSWERS = ['yes', 'maybe', 'no'];
const ANSWER_LABEL = { yes: 'présent', maybe: 'peut-être', no: 'absent', pending: 'sans réponse' };

const ids = list => [...new Set((Array.isArray(list) ? list : []).filter(id => SNOWFLAKE.test(String(id))).map(String))];
const clean = (text, max) => String(text ?? '').trim().slice(0, max);

export function normalizeMeeting(input = {}, { creating = true, now = Date.now() } = {}) {
	const title = clean(input.title, 100);
	if (!title) throw new ValidationError('Donne un titre à la réunion.');
	const startsAt = Number(input.startsAt);
	if (!Number.isFinite(startsAt)) throw new ValidationError('Date de début invalide.');
	if (creating && startsAt < now - 5 * MINUTE) throw new ValidationError('La réunion est dans le passé.');
	const durationMinutes = Math.round(Number(input.durationMinutes ?? 60));
	if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 600) throw new ValidationError('Durée entre 5 minutes et 10 heures.');
	if (!SNOWFLAKE.test(input.voiceChannelId ?? '')) throw new ValidationError('Choisis le salon vocal de la réunion.');
	const invites = { rankIds: [...new Set((input.invites?.rankIds ?? []).map(Number).filter(Number.isInteger))], roleIds: ids(input.invites?.roleIds), userIds: ids(input.invites?.userIds) };
	if (!invites.rankIds.length && !invites.roleIds.length && !invites.userIds.length) throw new ValidationError('Invite au moins un rang, un rôle ou une personne.');
	return {
		title,
		description: clean(input.description, 2000),
		agenda: (Array.isArray(input.agenda) ? input.agenda : []).slice(0, 30).map(item => ({ text: clean(item?.text ?? item, 200), done: Boolean(item?.done), note: clean(item?.note, 500) })).filter(i => i.text),
		startsAt,
		durationMinutes,
		voiceChannelId: input.voiceChannelId,
		announceChannelId: SNOWFLAKE.test(input.announceChannelId ?? '') ? input.announceChannelId : null,
		invites,
		reminders: [...new Set((Array.isArray(input.reminders) ? input.reminders : [1440, 60, 10]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 10_080))].sort((a, b) => b - a).slice(0, 5),
		recurrence: input.recurrence ? normalizeRecurrence(input.recurrence) : null,
	};
}

// Staff meetings: convocation (Discord message + DM with answer buttons), reminders, start at the set time,
// attendance read from the voice channel, minutes and follow-up tasks, a summary at the end.
export function createMeetings({ db, network, ranks, audit, executor, logs, logger = console, now = Date.now }) {
	logs.registerCategory('meetings', 'Réunions du staff', { planned: 'Réunion programmée', started: 'Réunion commencée', ended: 'Réunion terminée', cancelled: 'Réunion annulée' });
	const q = {
		insert: db.prepare(`
			INSERT INTO meetings (guild_id, title, description, agenda, starts_at, duration_minutes, voice_channel_id, announce_channel_id, invites, reminders, recurrence, created_by, created_at, updated_at)
			VALUES (@guildId, @title, @description, @agenda, @startsAt, @durationMinutes, @voiceChannelId, @announceChannelId, @invites, @reminders, @recurrence, @createdBy, @at, @at)
		`),
		update: db.prepare(`
			UPDATE meetings SET title = @title, description = @description, agenda = @agenda, starts_at = @startsAt, duration_minutes = @durationMinutes, voice_channel_id = @voiceChannelId,
				announce_channel_id = @announceChannelId, invites = @invites, reminders = @reminders, recurrence = @recurrence, updated_at = @at WHERE id = @id
		`),
		get: db.prepare('SELECT * FROM meetings WHERE id = ?'),
		list: db.prepare('SELECT * FROM meetings ORDER BY CASE status WHEN \'live\' THEN 0 WHEN \'scheduled\' THEN 1 ELSE 2 END, CASE WHEN status IN (\'live\', \'scheduled\') THEN starts_at END ASC, starts_at DESC LIMIT 300'),
		active: db.prepare('SELECT * FROM meetings WHERE status IN (\'scheduled\', \'live\')'),
		status: db.prepare('UPDATE meetings SET status = ?, started_at = COALESCE(?, started_at), ended_at = COALESCE(?, ended_at), updated_at = ? WHERE id = ?'),
		reminded: db.prepare('UPDATE meetings SET reminded = ? WHERE id = ?'),
		message: db.prepare('UPDATE meetings SET message_id = ? WHERE id = ?'),
		notes: db.prepare('UPDATE meetings SET notes = ?, agenda = ?, updated_at = ? WHERE id = ?'),
		invites: db.prepare('SELECT * FROM meeting_invites WHERE meeting_id = ?'),
		invite: db.prepare('INSERT OR IGNORE INTO meeting_invites (meeting_id, user_id) VALUES (?, ?)'),
		uninvite: db.prepare('DELETE FROM meeting_invites WHERE meeting_id = ? AND user_id = ? AND rsvp = \'pending\''),
		rsvp: db.prepare('UPDATE meeting_invites SET rsvp = ?, reason = ?, responded_at = ? WHERE meeting_id = ? AND user_id = ?'),
		attendance: db.prepare('SELECT * FROM meeting_attendance WHERE meeting_id = ? ORDER BY joined_at'),
		join: db.prepare('INSERT INTO meeting_attendance (meeting_id, user_id, joined_at) VALUES (?, ?, ?)'),
		open: db.prepare('SELECT * FROM meeting_attendance WHERE meeting_id = ? AND user_id = ? AND left_at IS NULL'),
		leave: db.prepare('UPDATE meeting_attendance SET left_at = ? WHERE meeting_id = ? AND user_id = ? AND left_at IS NULL'),
		closeAll: db.prepare('UPDATE meeting_attendance SET left_at = ? WHERE meeting_id = ? AND left_at IS NULL'),
		actions: db.prepare('SELECT * FROM meeting_actions WHERE meeting_id = ? ORDER BY id'),
		allActions: db.prepare('SELECT a.*, m.title AS meeting_title FROM meeting_actions a JOIN meetings m ON m.id = a.meeting_id WHERE a.done_at IS NULL ORDER BY COALESCE(a.due_at, 9e15)'),
		action: db.prepare('SELECT * FROM meeting_actions WHERE id = ?'),
		addAction: db.prepare('INSERT INTO meeting_actions (meeting_id, text, assignee_id, due_at, created_at) VALUES (?, ?, ?, ?, ?)'),
		doneAction: db.prepare('UPDATE meeting_actions SET done_at = ? WHERE id = ?'),
		removeAction: db.prepare('DELETE FROM meeting_actions WHERE id = ?'),
		history: db.prepare('SELECT * FROM meetings WHERE status = \'ended\' AND started_at >= ? ORDER BY started_at'),
	};

	const toMeeting = row => row && ({
		id: row.id, guildId: row.guild_id, title: row.title, description: row.description, agenda: JSON.parse(row.agenda), startsAt: row.starts_at,
		durationMinutes: row.duration_minutes, voiceChannelId: row.voice_channel_id, announceChannelId: row.announce_channel_id, invites: JSON.parse(row.invites),
		reminders: JSON.parse(row.reminders), reminded: JSON.parse(row.reminded), recurrence: row.recurrence ? JSON.parse(row.recurrence) : null, status: row.status,
		startedAt: row.started_at, endedAt: row.ended_at, notes: row.notes, messageId: row.message_id, createdBy: row.created_by, createdAt: row.created_at,
	});
	const toAction = row => ({ id: row.id, meetingId: row.meeting_id, text: row.text, assigneeId: row.assignee_id, dueAt: row.due_at, doneAt: row.done_at, meetingTitle: row.meeting_title });

	function getOrThrow(id) {
		const meeting = toMeeting(q.get.get(id));
		if (!meeting) throw new NotFoundError('Réunion introuvable.');
		return meeting;
	}
	const need = (actor) => {
		if (!actor.can('meetings.manage')) throw new ForbiddenError('Permission manquante : meetings.manage');
	};

	// Who is invited: members of the ranks, of the roles (on the meeting's server), and people picked one by one
	async function resolveInvitees(guildId, invites) {
		const out = new Set(invites.userIds);
		if (invites.rankIds.length) {
			for (const member of await listStaff({ ranks, network, executor })) {
				if (member.ranks.some(r => invites.rankIds.includes(r.id))) out.add(member.id);
			}
		}
		if (invites.roleIds.length) for (const member of await executor.listMembersWithAnyRole(guildId, invites.roleIds)) out.add(member.id);
		return [...out];
	}

	// Who came, how long, late or not, excused or not
	function report(meeting) {
		const invites = q.invites.all(meeting.id);
		const stays = q.attendance.all(meeting.id);
		const reference = Math.max(meeting.startsAt, meeting.startedAt ?? meeting.startsAt);
		const end = meeting.endedAt ?? now();
		const byUser = new Map();
		for (const s of stays) {
			const entry = byUser.get(s.user_id) ?? { minutes: 0, firstJoin: s.joined_at, lastLeave: null, inVoice: false };
			entry.minutes += ((s.left_at ?? end) - s.joined_at) / MINUTE;
			entry.firstJoin = Math.min(entry.firstJoin, s.joined_at);
			entry.lastLeave = s.left_at;
			entry.inVoice ||= s.left_at === null;
			byUser.set(s.user_id, entry);
		}
		const people = invites.map((i) => {
			const presence = byUser.get(i.user_id);
			let status = 'absent';
			if (presence) status = presence.firstJoin > reference + LATE_AFTER ? 'late' : 'present';
			else if (i.rsvp === 'no') status = 'excused';
			return { userId: i.user_id, invited: true, rsvp: i.rsvp, reason: i.reason, status, minutes: Math.round(presence?.minutes ?? 0), firstJoin: presence?.firstJoin ?? null, inVoice: presence?.inVoice ?? false };
		});
		for (const [userId, presence] of byUser) {
			if (!invites.some(i => i.user_id === userId)) people.push({ userId, invited: false, rsvp: null, reason: null, status: 'guest', minutes: Math.round(presence.minutes), firstJoin: presence.firstJoin, inVoice: presence.inVoice });
		}
		const count = s => people.filter(p => p.status === s).length;
		return { people, counts: { present: count('present'), late: count('late'), excused: count('excused'), absent: count('absent'), guest: count('guest'), invited: invites.length } };
	}

	function view(meeting) {
		const invites = q.invites.all(meeting.id);
		const answers = Object.fromEntries(['yes', 'maybe', 'no', 'pending'].map(a => [a, invites.filter(i => i.rsvp === a).length]));
		return {
			...meeting,
			endsAt: meeting.startsAt + meeting.durationMinutes * MINUTE,
			answers,
			invitees: invites.map(i => ({ userId: i.user_id, rsvp: i.rsvp, reason: i.reason, respondedAt: i.responded_at })),
			report: meeting.status === 'scheduled' ? null : report(meeting),
			actions: q.actions.all(meeting.id).map(toAction),
		};
	}

	async function refreshMessage(meeting) {
		if (!meeting.announceChannelId) return;
		try {
			const messageId = await executor.upsertMeetingMessage(meeting.announceChannelId, meeting.messageId, view(meeting));
			if (messageId !== meeting.messageId) q.message.run(messageId, meeting.id);
		}
		catch (error) {
			logger.warn(`Meeting #${meeting.id} message failed:`, error.message);
		}
	}

	async function dmAll(meeting, kind, text, { answers = ['yes', 'maybe', 'pending'] } = {}) {
		const v = view(meeting);
		for (const invite of q.invites.all(meeting.id).filter(i => answers.includes(i.rsvp))) {
			await executor.sendMeetingDM(invite.user_id, v, { kind, text }).catch(() => undefined);
		}
	}

	function log(meeting, type, title, description, color = 'info') {
		logs.log(meeting.guildId, 'meetings', { title, description, color }, type);
	}

	const service = {
		list() {
			return q.list.all().map(toMeeting).map(view);
		},

		get: id => view(getOrThrow(id)),

		async create(actor, input, { notify = true } = {}) {
			need(actor);
			if (network.find(input.guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const data = normalizeMeeting(input, { now: now() });
			const id = Number(q.insert.run({
				...data, guildId: input.guildId, agenda: JSON.stringify(data.agenda), invites: JSON.stringify(data.invites), reminders: JSON.stringify(data.reminders),
				recurrence: data.recurrence ? JSON.stringify(data.recurrence) : null, createdBy: actor.id, at: now(),
			}).lastInsertRowid);
			const people = await resolveInvitees(input.guildId, data.invites);
			db.transaction(() => people.forEach(userId => q.invite.run(id, userId)))();
			const meeting = getOrThrow(id);
			await refreshMessage(meeting);
			if (notify) await dmAll(meeting, 'invite', null, { answers: ['pending'] });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'meetings.create', guildId: meeting.guildId, target: String(id), details: { réunion: meeting.title, invités: people.length, date: new Date(meeting.startsAt).toISOString() } });
			log(meeting, 'planned', 'Réunion programmée', `**${meeting.title}** · <t:${Math.round(meeting.startsAt / 1000)}:F> · ${people.length} invité(s)`);
			return service.get(id);
		},

		// Changing the date resets the reminders and tells the people; new invitees get the convocation
		async update(actor, id, input) {
			need(actor);
			const before = getOrThrow(id);
			if (before.status !== 'scheduled') throw new ValidationError('Seule une réunion pas encore commencée peut être modifiée.');
			const data = normalizeMeeting({ ...input, startsAt: input.startsAt ?? before.startsAt }, { creating: input.startsAt !== undefined && input.startsAt !== before.startsAt, now: now() });
			q.update.run({ ...data, id, agenda: JSON.stringify(data.agenda), invites: JSON.stringify(data.invites), reminders: JSON.stringify(data.reminders), recurrence: data.recurrence ? JSON.stringify(data.recurrence) : null, at: now() });
			const moved = data.startsAt !== before.startsAt;
			if (moved) q.reminded.run('[]', id);
			const people = await resolveInvitees(before.guildId, data.invites);
			const known = new Set(q.invites.all(id).map(i => i.user_id));
			const added = people.filter(p => !known.has(p));
			db.transaction(() => {
				added.forEach(userId => q.invite.run(id, userId));
				[...known].filter(p => !people.includes(p)).forEach(userId => q.uninvite.run(id, userId));
			})();
			const meeting = getOrThrow(id);
			await refreshMessage(meeting);
			for (const userId of added) await executor.sendMeetingDM(userId, view(meeting), { kind: 'invite' }).catch(() => undefined);
			if (moved) await dmAll(meeting, 'moved', `La réunion **${meeting.title}** est déplacée au <t:${Math.round(meeting.startsAt / 1000)}:F>.`);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'meetings.update', guildId: meeting.guildId, target: String(id), details: { réunion: meeting.title } });
			return service.get(id);
		},

		async cancel(actor, id, reason = '') {
			need(actor);
			const meeting = getOrThrow(id);
			if (!['scheduled', 'live'].includes(meeting.status)) throw new ValidationError('Cette réunion est déjà terminée.');
			q.status.run('cancelled', null, now(), now(), id);
			q.closeAll.run(now(), id);
			const done = getOrThrow(id);
			await refreshMessage(done);
			await dmAll(done, 'cancelled', `❌ La réunion **${done.title}** du <t:${Math.round(done.startsAt / 1000)}:f> est annulée.${reason ? `\nRaison : ${clean(reason, 300)}` : ''}`);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'meetings.cancel', guildId: done.guildId, target: String(id), details: { réunion: done.title, raison: reason || null } });
			log(done, 'cancelled', 'Réunion annulée', `**${done.title}**${reason ? ` · ${reason}` : ''}`, 'warning');
			return service.get(id);
		},

		// Answer of an invitee (from the buttons); "absent" needs a reason
		async rsvp(userId, id, answer, reason = '') {
			const meeting = getOrThrow(id);
			if (!ANSWERS.includes(answer)) throw new ValidationError('Réponse inconnue.');
			if (!['scheduled', 'live'].includes(meeting.status)) throw new ValidationError('Cette réunion est terminée.');
			if (!q.invites.all(id).some(i => i.user_id === String(userId))) throw new ForbiddenError('Tu n’es pas invité à cette réunion.');
			const why = clean(reason, 300);
			if (answer === 'no' && !why) throw new ValidationError('Dis pourquoi tu ne peux pas venir.');
			q.rsvp.run(answer, answer === 'no' ? why : null, now(), id, String(userId));
			await refreshMessage(meeting);
			return { meeting: service.get(id), label: ANSWER_LABEL[answer] };
		},

		// The meeting begins: everyone already in the voice channel is counted present
		async start(actor, id) {
			if (actor) need(actor);
			const meeting = getOrThrow(id);
			if (meeting.status !== 'scheduled') throw new ValidationError('Cette réunion a déjà commencé ou est terminée.');
			const at = now();
			q.status.run('live', at, null, at, id);
			const inVoice = await executor.voiceMembers(meeting.voiceChannelId).catch(() => []);
			db.transaction(() => inVoice.forEach(userId => q.join.run(id, userId, at)))();
			const live = getOrThrow(id);
			await refreshMessage(live);
			if (live.announceChannelId) {
				const waiting = q.invites.all(id).filter(i => i.rsvp !== 'no' && !inVoice.includes(i.user_id)).map(i => i.user_id);
				await executor.sendMessage(live.announceChannelId, {
					payload: { content: `🔴 La réunion **${live.title}** commence dans <#${live.voiceChannelId}> !${waiting.length ? `\n${waiting.slice(0, 50).map(u => `<@${u}>`).join(' ')}` : ''}`, embed: { enabled: false } },
					files: [], mentionUserIds: waiting.slice(0, 50),
				}).catch(() => undefined);
			}
			audit.record({ actorId: actor?.id ?? 'system', source: actor?.source ?? 'system', action: 'meetings.start', guildId: live.guildId, target: String(id), details: { réunion: live.title } });
			log(live, 'started', 'Réunion commencée', `**${live.title}** dans <#${live.voiceChannelId}>`);
			return service.get(id);
		},

		// The bot reports people coming and going in voice channels
		voiceChanged(guildId, userId, fromChannelId, toChannelId) {
			for (const meeting of q.active.all().map(toMeeting).filter(m => m.status === 'live' && m.guildId === guildId)) {
				if (fromChannelId === meeting.voiceChannelId && toChannelId !== meeting.voiceChannelId) q.leave.run(now(), meeting.id, userId);
				if (toChannelId === meeting.voiceChannelId && fromChannelId !== meeting.voiceChannelId && !q.open.get(meeting.id, userId)) q.join.run(meeting.id, userId, now());
			}
		},

		// Over: attendance closed, summary posted, tasks sent to their owners, next meeting of a series planned
		async end(actor, id) {
			if (actor) need(actor);
			const meeting = getOrThrow(id);
			if (meeting.status !== 'live') throw new ValidationError('Cette réunion n’est pas en cours.');
			const at = now();
			q.closeAll.run(at, id);
			q.status.run('ended', null, at, at, id);
			const done = getOrThrow(id);
			const v = view(done);
			await refreshMessage(done);
			if (done.announceChannelId) await executor.sendMeetingSummary(done.announceChannelId, v).catch(error => logger.warn('Meeting summary failed:', error.message));
			for (const action of v.actions.filter(a => a.assigneeId && !a.doneAt)) {
				await executor.sendDM(action.assigneeId, `📋 Tâche après la réunion **${done.title}** : ${action.text}${action.dueAt ? ` (pour le <t:${Math.round(action.dueAt / 1000)}:D>)` : ''}`).catch(() => null);
			}
			let next = null;
			if (done.recurrence) {
				const at2 = nextOccurrence(done.recurrence, done.startsAt + MINUTE);
				if (at2) {
					next = await service.create({ id: done.createdBy, can: () => true, source: 'system' }, {
						...done, startsAt: at2, agenda: done.agenda.map(a => ({ text: a.text })), recurrence: done.recurrence,
					}).catch(error => logger.warn('Next meeting not planned:', error.message));
				}
			}
			audit.record({ actorId: actor?.id ?? 'system', source: actor?.source ?? 'system', action: 'meetings.end', guildId: done.guildId, target: String(id), details: { réunion: done.title, présents: v.report.counts.present + v.report.counts.late, absents: v.report.counts.absent } });
			log(done, 'ended', 'Réunion terminée', `**${done.title}** · ${v.report.counts.present + v.report.counts.late} présent(s), ${v.report.counts.absent} absent(s) non excusé(s)`, 'success');
			return { meeting: service.get(id), next };
		},

		// Minutes and agenda (ticked points, notes) during or after the meeting
		saveNotes(actor, id, { notes, agenda }) {
			need(actor);
			const meeting = getOrThrow(id);
			const items = agenda === undefined ? meeting.agenda : normalizeMeeting({ ...meeting, agenda }, { creating: false }).agenda;
			q.notes.run(notes === undefined ? meeting.notes : clean(notes, 20_000), JSON.stringify(items), now(), id);
			return service.get(id);
		},

		// A line added to the minutes (/reunion note)
		addNote(actor, id, text) {
			need(actor);
			const meeting = getOrThrow(id);
			const line = `- ${clean(text, 1000)}`;
			return service.saveNotes(actor, id, { notes: meeting.notes ? `${meeting.notes}\n${line}` : line });
		},

		addAction(actor, meetingId, { text, assigneeId = null, dueAt = null }) {
			need(actor);
			getOrThrow(meetingId);
			const task = clean(text, 300);
			if (!task) throw new ValidationError('Décris la tâche.');
			if (assigneeId && !SNOWFLAKE.test(assigneeId)) throw new ValidationError('Personne invalide.');
			q.addAction.run(meetingId, task, assigneeId, Number.isFinite(dueAt) ? dueAt : null, now());
			return service.get(meetingId);
		},

		setActionDone(actor, actionId, done) {
			const action = q.action.get(actionId);
			if (!action) throw new NotFoundError('Tâche introuvable.');
			// The person in charge may tick their own task
			if (action.assignee_id !== String(actor.id)) need(actor);
			q.doneAction.run(done ? now() : null, actionId);
			return service.get(action.meeting_id);
		},

		removeAction(actor, actionId) {
			need(actor);
			const action = q.action.get(actionId);
			if (!action) throw new NotFoundError('Tâche introuvable.');
			q.removeAction.run(actionId);
			return service.get(action.meeting_id);
		},

		openActions: () => q.allActions.all().map(toAction),

		// Attendance of each person over the last `days` (meetings they were invited to)
		stats(days = 90) {
			const people = new Map();
			const meetings = q.history.all(now() - days * 86_400_000).map(toMeeting);
			for (const meeting of meetings) {
				for (const p of report(meeting).people.filter(x => x.invited)) {
					const s = people.get(p.userId) ?? { userId: p.userId, invited: 0, present: 0, late: 0, excused: 0, absent: 0, minutes: 0 };
					s.invited += 1;
					s[p.status] += 1;
					s.minutes += p.minutes;
					people.set(p.userId, s);
				}
			}
			return { meetings: meetings.length, people: [...people.values()].map(s => ({ ...s, rate: s.invited ? Math.round(((s.present + s.late) / s.invited) * 100) : 0 })).sort((a, b) => b.rate - a.rate || b.invited - a.invited) };
		},

		// Every minute: reminders, start at the set time, end once the time is over and the channel is empty
		async tick() {
			const at = now();
			for (const meeting of q.active.all().map(toMeeting)) {
				if (network.find(meeting.guildId)?.status !== 'active') continue;
				try {
					if (meeting.status === 'scheduled') {
						const due = meeting.reminders.filter(r => r > 0 && !meeting.reminded.includes(r) && at >= meeting.startsAt - r * MINUTE && at < meeting.startsAt);
						if (due.length) {
							q.reminded.run(JSON.stringify([...meeting.reminded, ...due]), meeting.id);
							await dmAll(meeting, 'reminder', `⏰ Rappel : réunion **${meeting.title}** <t:${Math.round(meeting.startsAt / 1000)}:R> dans <#${meeting.voiceChannelId}>.`);
						}
						if (at >= meeting.startsAt) await service.start(null, meeting.id);
					}
					else if (meeting.status === 'live') {
						const over = at >= meeting.startsAt + meeting.durationMinutes * MINUTE + 15 * MINUTE;
						const tooLong = at >= meeting.startsAt + meeting.durationMinutes * MINUTE + 6 * 60 * MINUTE;
						if (tooLong || (over && !(await executor.voiceMembers(meeting.voiceChannelId).catch(() => [1])).length)) await service.end(null, meeting.id);
					}
				}
				catch (error) {
					logger.warn(`Meeting #${meeting.id} tick failed:`, error.message);
				}
			}
		},
	};
	return service;
}
