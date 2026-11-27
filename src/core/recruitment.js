import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeForm, nextStep, readStep } from './forms.js';
import { accountCreatedAt, fill } from './ticketConfig.js';
import { assertFivemAllowed, createVariables, usesFivem } from './variables.js';
import { createFormChats } from './formChats.js';
import { transcriptText } from './transcript.js';

definePermission('recruitment.view', { label: 'Voir les candidatures', category: 'Recrutement' });
definePermission('recruitment.vote', { label: 'Voter et commenter les candidatures', category: 'Recrutement' });
definePermission('recruitment.manage', { label: 'Gérer les postes et décider des candidatures', category: 'Recrutement' });

const SNOWFLAKE = /^\d{17,20}$/;
const DAY_MS = 86_400_000;
const HOUR_MS = 3600_000;
const FORM_TTL_MS = 30 * 60_000;
// An application filled as a conversation is dropped after this long without an answer
const CHAT_TTL_MS = 60 * 60_000;
const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);
const ids = value => (Array.isArray(value) ? value : []).filter(v => SNOWFLAKE.test(v)).slice(0, 25);

export const STATUSES = {
	received: { label: 'Reçue', emoji: '📥', color: '#8b8b8b' },
	review: { label: 'En étude', emoji: '🔎', color: '#5b9cf6' },
	interview: { label: 'Entretien', emoji: '🗣️', color: '#a855f7' },
	accepted: { label: 'Acceptée', emoji: '✅', color: '#3ccb8a' },
	rejected: { label: 'Refusée', emoji: '❌', color: '#e5484d' },
	withdrawn: { label: 'Retirée', emoji: '↩️', color: '#8b8b8b' },
};

const DEFAULT_FORM = { steps: [
	{ title: 'Qui es-tu ?', questions: [
		{ id: 'age', type: 'short', label: 'Ton âge', maxLength: 3 },
		{ id: 'availability', type: 'short', label: 'Tes disponibilités', maxLength: 200 },
		{ id: 'experience', type: 'paragraph', label: 'Ton expérience de staff', maxLength: 1500 },
	] },
	{ title: 'Motivation', questions: [
		{ id: 'why', type: 'paragraph', label: 'Pourquoi toi ?', maxLength: 2000 },
		{ id: 'situation', type: 'paragraph', label: 'Un joueur insulte un autre en vocal : que fais-tu ?', maxLength: 2000 },
	] },
] };

const DEFAULT_DM = {
	received: 'Ta candidature pour **{position}** a bien été reçue. Le staff va l’étudier.',
	review: 'Ta candidature pour **{position}** est en cours d’étude.',
	interview: 'Bonne nouvelle : le staff souhaite un entretien pour **{position}**. Un salon privé vient d’être ouvert.',
	accepted: '🎉 Ta candidature pour **{position}** est acceptée ! Bienvenue dans l’équipe.',
	rejected: 'Ta candidature pour **{position}** n’a pas été retenue cette fois. Merci d’avoir postulé.',
};

export function normalizePosition(input = {}) {
	const name = String(input.name ?? '').trim();
	if (!name || name.length > 60) throw new ValidationError('Le nom du poste fait 1 à 60 caractères.');
	const c = input.config ?? {};
	const r = c.requirements ?? {};
	const dm = {};
	for (const key of Object.keys(DEFAULT_DM)) dm[key] = String(c.dm?.[key] ?? DEFAULT_DM[key]).slice(0, 1000);
	return {
		name,
		description: String(input.description ?? '').slice(0, 1000),
		config: {
			open: c.open !== false,
			// The bot asks the questions one by one in a private channel made for the application ('channel')
			// or in private messages ('chat'); 'modal': Discord windows
			mode: ['channel', 'chat', 'modal'].includes(c.mode) ? c.mode : 'channel',
			closesAt: Number.isFinite(c.closesAt) ? c.closesAt : null,
			form: normalizeForm(c.form ?? DEFAULT_FORM, { fallback: DEFAULT_FORM }),
			requirements: {
				minAccountAgeDays: int(r.minAccountAgeDays, 0, 3650, 0),
				minMemberDays: int(r.minMemberDays, 0, 3650, 0),
				noSanctionDays: int(r.noSanctionDays, 0, 3650, 0),
				requiredRoleIds: ids(r.requiredRoleIds),
				minMessages: int(r.minMessages, 0, 100_000, 0),
				activityDays: int(r.activityDays, 1, 365, 30),
			},
			cooldownDays: int(c.cooldownDays, 0, 365, 14),
			reviewChannelId: SNOWFLAKE.test(c.reviewChannelId) ? c.reviewChannelId : null,
			pingRoleIds: ids(c.pingRoleIds),
			acceptRoleIds: ids(c.acceptRoleIds),
			acceptRankId: Number.isInteger(c.acceptRankId) ? c.acceptRankId : null,
			interviewCategoryId: SNOWFLAKE.test(c.interviewCategoryId) ? c.interviewCategoryId : null,
			interviewerRoleIds: ids(c.interviewerRoleIds),
			// Hours between the closing of an application channel and its deletion (0: kept until the staff deletes it)
			channelDeleteHours: int(c.channelDeleteHours, 0, 720, 24),
			dm,
		},
	};
}

export function createRecruitment({ db, network, ranks, audit, executor, sanctions, stats, logger = console, now = Date.now, variables = createVariables({ executor, logger, now }), formChats = createFormChats({ db, executor, logger, now }) }) {
	const q = {
		positions: db.prepare('SELECT * FROM recruit_positions WHERE guild_id = ? ORDER BY id'),
		position: db.prepare('SELECT * FROM recruit_positions WHERE id = ?'),
		insertPosition: db.prepare('INSERT INTO recruit_positions (guild_id, name, description, config, panel_channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
		updatePosition: db.prepare('UPDATE recruit_positions SET name = ?, description = ?, config = ?, panel_channel_id = ? WHERE id = ?'),
		setPanel: db.prepare('UPDATE recruit_positions SET panel_message_id = ? WHERE guild_id = ? AND panel_channel_id = ?'),
		deletePosition: db.prepare('DELETE FROM recruit_positions WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO recruit_applications (position_id, guild_id, user_id, user_name, answers, history, created_at, updated_at)
			VALUES (@positionId, @guildId, @userId, @userName, @answers, @history, @at, @at)
		`),
		get: db.prepare('SELECT * FROM recruit_applications WHERE id = ?'),
		lastOf: db.prepare('SELECT * FROM recruit_applications WHERE position_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'),
		// Last decision of the staff (a withdrawn application does not delay the next one)
		lastDecided: db.prepare('SELECT * FROM recruit_applications WHERE position_id = ? AND user_id = ? AND status IN (\'accepted\', \'rejected\') ORDER BY COALESCE(decided_at, created_at) DESC, id DESC LIMIT 1'),
		// Only from the status that was read: two decisions at once (double click, two staff members) apply once
		setStatus: db.prepare('UPDATE recruit_applications SET status = ?, history = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = ?'),
		setReview: db.prepare('UPDATE recruit_applications SET review_channel_id = ?, review_message_id = ?, thread_id = ? WHERE id = ?'),
		setInterview: db.prepare('UPDATE recruit_applications SET interview_channel_id = ?, interview_state = \'open\', interview_closed_at = NULL WHERE id = ?'),
		// Only from the state that was read: two clicks close, reopen or delete once
		closeChannel: db.prepare('UPDATE recruit_applications SET interview_state = \'closed\', interview_closed_at = ? WHERE id = ? AND interview_state = \'open\' AND interview_channel_id IS NOT NULL'),
		reopenChannel: db.prepare('UPDATE recruit_applications SET interview_state = \'open\', interview_closed_at = NULL WHERE id = ? AND interview_state = \'closed\' AND interview_channel_id IS NOT NULL'),
		dropChannel: db.prepare('UPDATE recruit_applications SET interview_channel_id = NULL, interview_state = NULL, interview_closed_at = NULL WHERE id = ? AND interview_state = \'closed\''),
		closedChannels: db.prepare('SELECT * FROM recruit_applications WHERE interview_state = \'closed\' AND interview_closed_at IS NOT NULL ORDER BY interview_closed_at, id LIMIT 200'),
		setNotes: db.prepare('UPDATE recruit_applications SET notes = ?, updated_at = ? WHERE id = ?'),
		vote: db.prepare('INSERT INTO recruit_votes (application_id, user_id, vote, comment, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (application_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, comment = COALESCE(EXCLUDED.comment, recruit_votes.comment), at = EXCLUDED.at'),
		votes: db.prepare('SELECT user_id AS "userId", vote, comment, at FROM recruit_votes WHERE application_id = ? ORDER BY at, user_id'),
	};
	const forms = new Map();
	const toPosition = row => row && ({ id: row.id, guildId: row.guild_id, name: row.name, description: row.description, config: normalizePosition({ name: row.name, config: JSON.parse(row.config) }).config, panelChannelId: row.panel_channel_id, panelMessageId: row.panel_message_id });
	async function toApplication(row) {
		if (!row) return null;
		const votes = await q.votes.all(row.id);
		return {
			id: row.id, positionId: row.position_id, guildId: row.guild_id, userId: row.user_id, userName: row.user_name, answers: JSON.parse(row.answers), status: row.status,
			history: JSON.parse(row.history), notes: JSON.parse(row.notes), reviewChannelId: row.review_channel_id, reviewMessageId: row.review_message_id, threadId: row.thread_id,
			interviewChannelId: row.interview_channel_id, interviewState: row.interview_channel_id ? row.interview_state ?? 'open' : null, interviewClosedAt: row.interview_closed_at ?? null, decidedBy: row.decided_by, decidedAt: row.decided_at, createdAt: row.created_at, updatedAt: row.updated_at,
			votes, score: { for: votes.filter(v => v.vote === 1).length, against: votes.filter(v => v.vote === -1).length, neutral: votes.filter(v => v.vote === 0).length },
		};
	}
	async function getPosition(id) {
		const p = toPosition(await q.position.get(id));
		if (!p) throw new NotFoundError('Poste introuvable.');
		return p;
	}
	async function getApplication(id) {
		const a = await toApplication(await q.get.get(id));
		if (!a) throw new NotFoundError('Candidature introuvable.');
		return a;
	}
	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	async function requirements(position, userId, guildId) {
		const r = position.config.requirements;
		const reasons = [];
		if (r.minAccountAgeDays && now() - accountCreatedAt(userId) < r.minAccountAgeDays * DAY_MS) reasons.push(`Ton compte doit avoir au moins ${r.minAccountAgeDays} jour(s).`);
		if (r.minMemberDays) {
			const info = await executor.getMemberInfo(guildId, userId).catch(() => null);
			if (!info?.joinedAt || now() - info.joinedAt < r.minMemberDays * DAY_MS) reasons.push(`Il faut être sur le serveur depuis ${r.minMemberDays} jour(s).`);
		}
		if (r.requiredRoleIds.length) {
			const roles = await executor.getMemberRoleIds(guildId, userId) ?? [];
			if (!r.requiredRoleIds.some(id => roles.includes(id))) reasons.push('Il te manque un rôle requis pour ce poste.');
		}
		if (r.noSanctionDays && (await sanctions.list({ userId, limit: 50 })).some(s => !s.revokedAt && !s.automatic && s.createdAt >= now() - r.noSanctionDays * DAY_MS)) {
			reasons.push(`Aucune sanction ces ${r.noSanctionDays} derniers jours.`);
		}
		if (r.minMessages) {
			const activity = await stats.member(userId, { guildIds: [guildId], days: r.activityDays }).catch(() => ({ messages: 0 }));
			if (activity.messages < r.minMessages) reasons.push(`Il faut ${r.minMessages} messages sur ${r.activityDays} jours (tu en as ${activity.messages}).`);
		}
		return reasons;
	}

	// Message sent to the candidate: {position} and the shared member variables
	async function dmText(position, status, guildId, userId) {
		const text = position.config.dm[status];
		if (!text) return null;
		const vars = await variables.member(guildId, userId, { fivem: usesFivem(text) }).catch(() => ({}));
		return fill(text, { ...vars, position: position.name });
	}

	async function refreshReview(application) {
		if (!application.reviewChannelId || !application.reviewMessageId) return;
		const position = await getPosition(application.positionId);
		await executor.upsertApplicationMessage(application.reviewChannelId, application.reviewMessageId, { position, application, status: STATUSES[application.status] })
			.catch(error => logger.warn(`Application #${application.id} not refreshed:`, error.message));
	}

	// The channel of an application works like a ticket: open, closed (the candidate no longer sees it,
	// the staff keeps it and can reopen it), then deleted by the staff or some hours after its closing.
	const warn = what => error => logger.warn(`${what}:`, error.message);
	async function requireRecruiter(actor, application) {
		if (actor.can('recruitment.manage') || actor.can('recruitment.vote')) return;
		const roleIds = (await getPosition(application.positionId).catch(() => null))?.config.interviewerRoleIds ?? [];
		const mine = roleIds.length ? await executor.getMemberRoleIds(application.guildId, actor.id).catch(() => null) ?? [] : [];
		if (!roleIds.some(id => mine.includes(id))) throw new ForbiddenError('Seuls les recruteurs peuvent gérer ce salon.');
	}
	async function closeInterview(application, by) {
		if (!application.interviewChannelId || !(await q.closeChannel.run(now(), application.id)).changes) return false;
		const hours = (await getPosition(application.positionId).catch(() => null))?.config.channelDeleteHours ?? 0;
		await executor.removeChannelMember(application.interviewChannelId, application.userId).catch(warn(`Channel of application #${application.id} not closed`));
		await executor.sendInterviewNotice(application.interviewChannelId, { kind: 'closed', applicationId: application.id, by, deleteAt: hours ? now() + hours * HOUR_MS : null })
			.catch(warn(`Notice of application #${application.id} not sent`));
		return true;
	}
	// The conversation is kept as a file next to the application (its thread, or the review channel)
	async function deleteInterview(application, by) {
		if (!(await q.dropChannel.run(application.id)).changes) return false;
		const channelId = application.interviewChannelId;
		const target = application.threadId ?? application.reviewChannelId;
		const history = target ? await executor.fetchChannelHistory(channelId, { limit: 2000 }).catch(() => null) : null;
		if (history?.messages.length) {
			await executor.sendLog(target, {
				title: 'Salon de candidature supprimé',
				description: `Candidature #${application.id} de <@${application.userId}> · supprimé par ${by === 'system' ? 'le bot' : `<@${by}>`}`,
				color: 'neutral',
				files: [{ name: `candidature-${application.id}.txt`, content: transcriptText(history.messages, history.mentions) }],
			}).catch(warn(`Conversation of application #${application.id} not saved`));
		}
		await executor.deleteChannel(channelId, `Candidature #${application.id} terminée`).catch(warn(`Channel of application #${application.id} not deleted`));
		return true;
	}
	const recordChannel = (actor, action, application) => audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId: application.guildId, target: String(application.id), details: { member: `<@${application.userId}>` } });

	// Throws when this member cannot apply to this position right now
	async function eligible(positionId, userId, guildId) {
		const position = await getPosition(positionId);
		if (position.guildId !== guildId) throw new NotFoundError('Poste introuvable.');
		if (!position.config.open || (position.config.closesAt && position.config.closesAt <= now())) throw new ValidationError('Les candidatures pour ce poste sont fermées.');
		const last = await toApplication(await q.lastOf.get(positionId, userId));
		if (last && ['received', 'review', 'interview'].includes(last.status)) throw new ValidationError('Tu as déjà une candidature en cours pour ce poste.');
		// The delay counts from the decision; a withdrawn application does not count
		const decided = position.config.cooldownDays ? await toApplication(await q.lastDecided.get(positionId, userId)) : null;
		const decidedAt = decided ? decided.decidedAt ?? decided.createdAt : null;
		if (decided && decidedAt > now() - position.config.cooldownDays * DAY_MS) {
			throw new ValidationError(`Tu pourras repostuler à ce poste dans ${Math.ceil((decidedAt + position.config.cooldownDays * DAY_MS - now()) / DAY_MS)} jour(s).`);
		}
		const reasons = await requirements(position, userId, guildId);
		if (reasons.length) throw new ValidationError(`Tu ne remplis pas les conditions :\n• ${reasons.join('\n• ')}`);
		return position;
	}

	formChats.register('recruitment', {
		ttl: CHAT_TTL_MS,
		cancel: true,
		form: async session => (await getPosition(session.meta.positionId).catch(() => null))?.config.form ?? null,
		async done(session, answers) {
			const { positionId, guildId, userName } = session.meta;
			// Closed or already applied meanwhile (two devices)
			const position = await eligible(positionId, session.userId, guildId);
			await service.submit({ positionId, guildId, userId: session.userId, userName, answers: answers.map(({ id, label, value }) => ({ id, label, value })), channelId: session.channelId });
			if (session.channelId) return '✅ Merci, c’était la dernière question : ta candidature est envoyée. Le staff te répondra ici.';
			// In private messages the "received" message of the position is the confirmation
			return position.config.dm.received ? null : '✅ Merci, c’était la dernière question : ta candidature est envoyée au staff.';
		},
		// The channel of an application that was never sent is deleted
		async cancelled(session, reason) {
			if (session.channelId) {
				await executor.deleteChannel(session.channelId, 'Candidature abandonnée').catch(error => logger.warn(`Application channel ${session.channelId} not deleted:`, error.message));
				return null;
			}
			if (reason === 'cancel') return 'Candidature annulée. Tu peux recommencer quand tu veux depuis le panneau.';
			if (reason === 'expired') return 'Ta candidature a expiré faute de réponse : clique à nouveau sur **Postuler** pour recommencer.';
			return 'Le formulaire de ce poste vient de changer : clique à nouveau sur **Postuler**.';
		},
	});

	const service = {
		statuses: STATUSES,
		positions: async guildId => (await q.positions.all(guildId)).map(toPosition),
		getPosition,

		async savePosition(actor, guildId, input) {
			need(actor, 'recruitment.manage');
			if ((await network.find(guildId))?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const p = normalizePosition(input);
			assertFivemAllowed(actor, p.config?.dm ?? p, input.id ? (await q.position.get(input.id))?.config : null);
			const panelChannelId = SNOWFLAKE.test(input.panelChannelId) ? input.panelChannelId : null;
			let id = input.id;
			if (id) {
				const existing = await getPosition(id);
				if (existing.guildId !== guildId) throw new NotFoundError('Poste introuvable.');
				await q.updatePosition.run(p.name, p.description, JSON.stringify(p.config), panelChannelId, id);
			}
			else {
				id = Number((await q.insertPosition.run(guildId, p.name, p.description, JSON.stringify(p.config), panelChannelId, now())).lastInsertRowid);
			}
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'recruitment.position', guildId, target: String(id), details: { name: p.name, open: p.config.open } });
			return await getPosition(id);
		},

		// Applications open or closed in one click; the Discord panel follows (button greyed out, 🔴 fermé)
		async setOpen(actor, id, open) {
			need(actor, 'recruitment.manage');
			const p = await getPosition(id);
			await q.updatePosition.run(p.name, p.description, JSON.stringify({ ...p.config, open: Boolean(open) }), p.panelChannelId, id);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: open ? 'recruitment.open' : 'recruitment.close', guildId: p.guildId, target: String(id), details: { name: p.name } });
			if (p.panelChannelId && p.panelMessageId) {
				const positions = (await service.positions(p.guildId)).filter(x => x.panelChannelId === p.panelChannelId);
				await executor.publishRecruitmentPanel(p.panelChannelId, p.panelMessageId, positions).catch(error => logger.warn('Recruitment panel refresh failed:', error.message));
			}
			return await getPosition(id);
		},

		async deletePosition(actor, id) {
			need(actor, 'recruitment.manage');
			const p = await getPosition(id);
			await q.deletePosition.run(id);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'recruitment.position_delete', guildId: p.guildId, target: String(id), details: { name: p.name } });
		},

		// One message per channel listing the open positions of that channel
		async publishPanel(actor, guildId, channelId) {
			need(actor, 'recruitment.manage');
			const positions = (await service.positions(guildId)).filter(p => p.panelChannelId === channelId);
			if (!positions.length) throw new ValidationError('Aucun poste n’a ce salon comme panneau.');
			const messageId = await executor.publishRecruitmentPanel(channelId, positions.find(p => p.panelMessageId)?.panelMessageId ?? null, positions);
			await q.setPanel.run(messageId, guildId, channelId);
			return messageId;
		},

		async startApplication(positionId, userId, guildId) {
			const position = await eligible(positionId, userId, guildId);
			const step = nextStep(position.config.form, 0, []);
			forms.set(`${positionId}:${userId}`, { answers: [], step, at: now() });
			return { position, step };
		},

		// The bot asks the questions one by one, in a private channel made for the application ('channel')
		// or in private messages ('chat'). { sent: false } when the member does not accept private
		// messages: the caller then offers the Discord windows instead.
		async startChat(positionId, userId, guildId, userName = null) {
			const position = await eligible(positionId, userId, guildId);
			const { form, mode } = position.config;
			const meta = { positionId, guildId, userName };
			if (mode !== 'channel') {
				const intro = `📋 **Candidature : ${position.name}**\nJe te pose les questions une par une : réponds simplement ici, un message par question. Écris \`annuler\` pour arrêter.`;
				try {
					await formChats.start({ kind: 'recruitment', userId, meta, form, intro });
				}
				catch (error) {
					logger.warn(`Application of ${userId} not started in DM:`, error.message);
					return { position, sent: false, channelId: null };
				}
				return { position, sent: true, channelId: null };
			}
			// Already filling this application: back to its channel instead of a second one
			const current = formChats.find('recruitment', s => s.userId === userId && s.channelId && s.meta.positionId === positionId);
			if (current) return { position, sent: true, channelId: current.channelId };
			let channelId;
			try {
				channelId = await executor.createInterviewChannel(guildId, {
					name: `candidature-${userName ?? userId}`,
					parentId: position.config.interviewCategoryId,
					candidateId: userId,
					staffRoleIds: position.config.interviewerRoleIds,
					welcome: `<@${userId}> voici ta candidature pour **${position.name}**.`,
				});
			}
			catch (error) {
				logger.warn(`Application channel of ${userId} not created:`, error.message);
				throw new ValidationError('Impossible de créer ton salon de candidature : le bot doit pouvoir gérer les salons. Préviens le staff.');
			}
			const intro = 'Je te pose les questions une par une : réponds simplement ici, un message par question. Écris `annuler` pour arrêter (le salon sera supprimé).';
			await formChats.start({ kind: 'recruitment', userId, channelId, meta, form, intro });
			return { position, sent: true, channelId };
		},

		// A private message received by the bot: true when it was an answer to an application in progress
		chatMessage: ({ userId, content = '', attachments = [] }) => formChats.message({ userId, content, attachments }),

		async submitStep(positionId, userId, step, values) {
			const position = await getPosition(positionId);
			const key = `${positionId}:${userId}`;
			const state = forms.get(key);
			if (!state || state.step !== step || now() - state.at > FORM_TTL_MS) throw new ValidationError('Ce formulaire a expiré : recommence depuis le panneau.');
			state.answers.push(...readStep(position.config.form.steps[step], values));
			state.at = now();
			const next = nextStep(position.config.form, step + 1, state.answers);
			if (next >= 0) {
				state.step = next;
				return { done: false, next, total: position.config.form.steps.length };
			}
			forms.delete(key);
			return { done: true, answers: state.answers.map(({ id, label, value }) => ({ id, label, value })) };
		},

		// channelId: the private channel where the application was filled, kept for the interview
		async submit({ positionId, guildId, userId, userName, answers, channelId = null }) {
			const position = await getPosition(positionId);
			const id = Number((await q.insert.run({ positionId, guildId, userId, userName, answers: JSON.stringify(answers), history: JSON.stringify([{ status: 'received', by: userId, at: now() }]), at: now() })).lastInsertRowid);
			if (channelId) {
				await q.setInterview.run(channelId, id);
				await executor.sendInterviewNotice(channelId, { kind: 'opened', applicationId: id }).catch(warn(`Notice of application #${id} not sent`));
			}
			let application = await getApplication(id);
			if (position.config.reviewChannelId) {
				const posted = await executor.upsertApplicationMessage(position.config.reviewChannelId, null, { position, application, status: STATUSES.received }, { thread: true, pingRoleIds: position.config.pingRoleIds })
					.catch((error) => {
						logger.warn(`Application #${id} not posted:`, error.message);
						return null;
					});
				if (posted) await q.setReview.run(position.config.reviewChannelId, posted.messageId, posted.threadId ?? null, id);
				application = await getApplication(id);
			}
			const text = await dmText(position, 'received', guildId, userId);
			if (text) await executor.sendDM(userId, text).catch(() => null);
			await audit.record({ actorId: userId, source: 'bot', action: 'recruitment.apply', guildId, target: String(id), details: { position: position.name, member: `<@${userId}>` } });
			return application;
		},

		async vote(userId, applicationId, value, comment = null) {
			const principal = await ranks.resolve(userId);
			if (!principal.can('recruitment.vote') && !principal.can('recruitment.manage')) throw new ForbiddenError('Tu ne peux pas voter sur les candidatures.');
			const application = await getApplication(applicationId);
			if (application.userId === userId) throw new ForbiddenError('Tu ne peux pas voter pour ta propre candidature.');
			if (!['received', 'review', 'interview'].includes(application.status)) throw new ValidationError('Cette candidature est close.');
			if (![-1, 0, 1].includes(value)) throw new ValidationError('Vote invalide.');
			await q.vote.run(applicationId, userId, value, comment ? String(comment).slice(0, 500) : null, now());
			const updated = await getApplication(applicationId);
			await refreshReview(updated);
			return updated;
		},

		async addNote(actor, applicationId, text) {
			need(actor, 'recruitment.vote');
			const application = await getApplication(applicationId);
			const clean = String(text ?? '').trim().slice(0, 1000);
			if (!clean) throw new ValidationError('Note vide.');
			await q.setNotes.run(JSON.stringify([...application.notes, { by: actor.id, at: now(), text: clean }].slice(-100)), now(), applicationId);
			return await getApplication(applicationId);
		},

		// received -> review -> interview -> accepted / rejected (or withdrawn by the candidate)
		async setStatus(actor, applicationId, status, { reason = '' } = {}) {
			const application = await getApplication(applicationId);
			if (status === 'withdrawn') {
				if (actor.id !== application.userId) throw new ForbiddenError('Seul le candidat peut retirer sa candidature.');
			}
			else {
				need(actor, 'recruitment.manage');
			}
			if (!STATUSES[status]) throw new ValidationError('Statut inconnu.');
			if (['accepted', 'rejected', 'withdrawn'].includes(application.status)) throw new ValidationError('Cette candidature est déjà close.');
			const position = await getPosition(application.positionId);
			const history = JSON.stringify([...application.history, { status, by: actor.id, at: now(), reason: reason || null }]);
			const final = ['accepted', 'rejected', 'withdrawn'].includes(status);
			if (!(await q.setStatus.run(status, history, final ? actor.id : null, final ? now() : null, now(), applicationId, application.status)).changes) {
				const current = await getApplication(applicationId);
				if (['accepted', 'rejected', 'withdrawn'].includes(current.status)) throw new ValidationError('Cette candidature est déjà close.');
				throw new ValidationError('Cette candidature vient de changer de statut : réessaie.');
			}

			if (status === 'interview' && !application.interviewChannelId) {
				const channelId = await executor.createInterviewChannel(application.guildId, {
					name: `entretien-${application.userName ?? application.userId}`,
					parentId: position.config.interviewCategoryId,
					candidateId: application.userId,
					staffRoleIds: position.config.interviewerRoleIds,
				}).catch((error) => {
					logger.warn(`Interview channel of #${applicationId} failed:`, error.message);
					return null;
				});
				if (channelId) {
					await q.setInterview.run(channelId, applicationId);
					await executor.sendInterviewNotice(channelId, { kind: 'interview', applicationId }).catch(warn(`Notice of application #${applicationId} not sent`));
				}
			}
			// Decision taken: the channel is closed (the candidate no longer sees it, the staff can reopen or delete it)
			if (final) await closeInterview(await getApplication(applicationId), 'system');
			if (status === 'accepted') {
				for (const roleId of position.config.acceptRoleIds) {
					await executor.addRole(application.guildId, application.userId, roleId, `Candidature acceptée (${position.name})`).catch(error => logger.warn('Accept role failed:', error.message));
				}
				if (position.config.acceptRankId) {
					await ranks.assignDirect(actor, application.userId, position.config.acceptRankId).catch(error => logger.warn(`Rank of the new staff member not given: ${error.message}`));
				}
			}
			const updated = await getApplication(applicationId);
			await refreshReview(updated);
			const text = await dmText(position, status, application.guildId, application.userId);
			if (text && status !== 'withdrawn') await executor.sendDM(application.userId, `${text}${reason ? `\n${reason}` : ''}`).catch(() => null);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'recruitment.status', guildId: application.guildId, target: String(applicationId), details: { position: position.name, member: `<@${application.userId}>`, status: STATUSES[status].label, reason: reason || null } });
			return updated;
		},

		async closeChannel(actor, applicationId) {
			const application = await getApplication(applicationId);
			await requireRecruiter(actor, application);
			if (!application.interviewChannelId) throw new ValidationError('Cette candidature n’a pas de salon.');
			if (!await closeInterview(application, actor.id)) throw new ValidationError('Ce salon est déjà fermé.');
			await recordChannel(actor, 'recruitment.channel_close', application);
			return await getApplication(applicationId);
		},

		async reopenChannel(actor, applicationId) {
			const application = await getApplication(applicationId);
			await requireRecruiter(actor, application);
			if (!application.interviewChannelId) throw new ValidationError('Cette candidature n’a plus de salon.');
			if (!(await q.reopenChannel.run(applicationId)).changes) throw new ValidationError('Ce salon est déjà ouvert.');
			try {
				await executor.addChannelMember(application.interviewChannelId, application.userId);
			}
			catch (error) {
				// The channel is gone or the bot cannot edit it: back to closed, with what went wrong
				await q.closeChannel.run(application.interviewClosedAt, applicationId);
				logger.warn(`Channel of application #${applicationId} not reopened:`, error.message);
				throw new ValidationError('Impossible de rouvrir ce salon : il a été supprimé ou le bot ne peut plus le modifier.');
			}
			await executor.sendInterviewNotice(application.interviewChannelId, { kind: 'reopened', applicationId, by: actor.id }).catch(warn(`Notice of application #${applicationId} not sent`));
			await recordChannel(actor, 'recruitment.channel_reopen', application);
			return await getApplication(applicationId);
		},

		// Only a closed channel is deleted (the candidate was told it is over)
		async deleteChannel(actor, applicationId) {
			const application = await getApplication(applicationId);
			await requireRecruiter(actor, application);
			if (!application.interviewChannelId) throw new ValidationError('Cette candidature n’a plus de salon.');
			if (application.interviewState !== 'closed') throw new ValidationError('Ferme d’abord ce salon avant de le supprimer.');
			if (!await deleteInterview(application, actor.id)) throw new ValidationError('Ce salon vient d’être rouvert ou supprimé.');
			await recordChannel(actor, 'recruitment.channel_delete', application);
			return await getApplication(applicationId);
		},

		// Closed channels reaching the delay of their position
		async tick() {
			for (const row of await q.closedChannels.all()) {
				const hours = toPosition(await q.position.get(row.position_id))?.config.channelDeleteHours ?? 0;
				if (!hours || row.interview_closed_at + hours * HOUR_MS > now()) continue;
				await deleteInterview(await toApplication(row), 'system').catch(warn(`Channel of application #${row.id} not deleted`));
			}
		},

		async list(actor, { guildId, positionId, status, userId } = {}) {
			need(actor, 'recruitment.view');
			const where = [guildId && 'guild_id = @guildId', positionId && 'position_id = @positionId', status && 'status = @status', userId && 'user_id = @userId'].filter(Boolean);
			return Promise.all((await db.prepare(`SELECT * FROM recruit_applications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 500`).all({ guildId, positionId, status, userId })).map(toApplication));
		},

		async get(actor, id) {
			need(actor, 'recruitment.view');
			return await getApplication(id);
		},
	};
	return service;
}
