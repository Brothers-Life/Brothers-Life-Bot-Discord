import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeForm, nextStep, readStep } from './forms.js';
import { accountCreatedAt } from './ticketConfig.js';

definePermission('recruitment.view', { label: 'Voir les candidatures', category: 'Recrutement' });
definePermission('recruitment.vote', { label: 'Voter et commenter les candidatures', category: 'Recrutement' });
definePermission('recruitment.manage', { label: 'Gérer les postes et décider des candidatures', category: 'Recrutement' });

const SNOWFLAKE = /^\d{17,20}$/;
const DAY_MS = 86_400_000;
const FORM_TTL_MS = 30 * 60_000;
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
			dm,
		},
	};
}

export function createRecruitment({ db, network, ranks, audit, executor, sanctions, stats, logger = console, now = Date.now }) {
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
		lastOf: db.prepare('SELECT * FROM recruit_applications WHERE position_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1'),
		setStatus: db.prepare('UPDATE recruit_applications SET status = ?, history = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?'),
		setReview: db.prepare('UPDATE recruit_applications SET review_channel_id = ?, review_message_id = ?, thread_id = ? WHERE id = ?'),
		setInterview: db.prepare('UPDATE recruit_applications SET interview_channel_id = ? WHERE id = ?'),
		setNotes: db.prepare('UPDATE recruit_applications SET notes = ?, updated_at = ? WHERE id = ?'),
		vote: db.prepare('INSERT INTO recruit_votes (application_id, user_id, vote, comment, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(application_id, user_id) DO UPDATE SET vote = excluded.vote, comment = COALESCE(excluded.comment, recruit_votes.comment), at = excluded.at'),
		votes: db.prepare('SELECT user_id AS userId, vote, comment, at FROM recruit_votes WHERE application_id = ? ORDER BY at'),
	};
	const forms = new Map();

	const toPosition = row => row && ({ id: row.id, guildId: row.guild_id, name: row.name, description: row.description, config: normalizePosition({ name: row.name, config: JSON.parse(row.config) }).config, panelChannelId: row.panel_channel_id, panelMessageId: row.panel_message_id });
	function toApplication(row) {
		if (!row) return null;
		const votes = q.votes.all(row.id);
		return {
			id: row.id, positionId: row.position_id, guildId: row.guild_id, userId: row.user_id, userName: row.user_name, answers: JSON.parse(row.answers), status: row.status,
			history: JSON.parse(row.history), notes: JSON.parse(row.notes), reviewChannelId: row.review_channel_id, reviewMessageId: row.review_message_id, threadId: row.thread_id,
			interviewChannelId: row.interview_channel_id, decidedBy: row.decided_by, decidedAt: row.decided_at, createdAt: row.created_at, updatedAt: row.updated_at,
			votes, score: { for: votes.filter(v => v.vote === 1).length, against: votes.filter(v => v.vote === -1).length, neutral: votes.filter(v => v.vote === 0).length },
		};
	}
	function getPosition(id) {
		const p = toPosition(q.position.get(id));
		if (!p) throw new NotFoundError('Poste introuvable.');
		return p;
	}
	function getApplication(id) {
		const a = toApplication(q.get.get(id));
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
		if (r.noSanctionDays && sanctions.list({ userId, limit: 50 }).some(s => !s.revokedAt && s.createdAt >= now() - r.noSanctionDays * DAY_MS)) {
			reasons.push(`Aucune sanction ces ${r.noSanctionDays} derniers jours.`);
		}
		if (r.minMessages) {
			const activity = await stats.member(userId, { guildIds: [guildId], days: r.activityDays }).catch(() => ({ messages: 0 }));
			if (activity.messages < r.minMessages) reasons.push(`Il faut ${r.minMessages} messages sur ${r.activityDays} jours (tu en as ${activity.messages}).`);
		}
		return reasons;
	}

	function dmText(position, status) {
		return position.config.dm[status]?.replace(/\{position\}/g, position.name) ?? null;
	}

	async function refreshReview(application) {
		if (!application.reviewChannelId || !application.reviewMessageId) return;
		const position = getPosition(application.positionId);
		await executor.upsertApplicationMessage(application.reviewChannelId, application.reviewMessageId, { position, application, status: STATUSES[application.status] })
			.catch(error => logger.warn(`Application #${application.id} not refreshed:`, error.message));
	}

	const service = {
		statuses: STATUSES,
		positions: guildId => q.positions.all(guildId).map(toPosition),
		getPosition,

		savePosition(actor, guildId, input) {
			need(actor, 'recruitment.manage');
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const p = normalizePosition(input);
			const panelChannelId = SNOWFLAKE.test(input.panelChannelId) ? input.panelChannelId : null;
			let id = input.id;
			if (id) {
				const existing = getPosition(id);
				if (existing.guildId !== guildId) throw new NotFoundError('Poste introuvable.');
				q.updatePosition.run(p.name, p.description, JSON.stringify(p.config), panelChannelId, id);
			}
			else {
				id = Number(q.insertPosition.run(guildId, p.name, p.description, JSON.stringify(p.config), panelChannelId, now()).lastInsertRowid);
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'recruitment.position', guildId, target: String(id), details: { name: p.name, open: p.config.open } });
			return getPosition(id);
		},

		deletePosition(actor, id) {
			need(actor, 'recruitment.manage');
			const p = getPosition(id);
			q.deletePosition.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'recruitment.position_delete', guildId: p.guildId, target: String(id), details: { name: p.name } });
		},

		// One message per channel listing the open positions of that channel
		async publishPanel(actor, guildId, channelId) {
			need(actor, 'recruitment.manage');
			const positions = service.positions(guildId).filter(p => p.panelChannelId === channelId);
			if (!positions.length) throw new ValidationError('Aucun poste n’a ce salon comme panneau.');
			const messageId = await executor.publishRecruitmentPanel(channelId, positions.find(p => p.panelMessageId)?.panelMessageId ?? null, positions);
			q.setPanel.run(messageId, guildId, channelId);
			return messageId;
		},

		async startApplication(positionId, userId, guildId) {
			const position = getPosition(positionId);
			if (position.guildId !== guildId) throw new NotFoundError('Poste introuvable.');
			if (!position.config.open || (position.config.closesAt && position.config.closesAt <= now())) throw new ValidationError('Les candidatures pour ce poste sont fermées.');
			const last = toApplication(q.lastOf.get(positionId, userId));
			if (last && ['received', 'review', 'interview'].includes(last.status)) throw new ValidationError('Tu as déjà une candidature en cours pour ce poste.');
			if (last && position.config.cooldownDays && last.createdAt > now() - position.config.cooldownDays * DAY_MS) {
				throw new ValidationError(`Tu pourras repostuler à ce poste dans ${Math.ceil((last.createdAt + position.config.cooldownDays * DAY_MS - now()) / DAY_MS)} jour(s).`);
			}
			const reasons = await requirements(position, userId, guildId);
			if (reasons.length) throw new ValidationError(`Tu ne remplis pas les conditions :\n• ${reasons.join('\n• ')}`);
			const step = nextStep(position.config.form, 0, []);
			forms.set(`${positionId}:${userId}`, { answers: [], step, at: now() });
			return { position, step };
		},

		submitStep(positionId, userId, step, values) {
			const position = getPosition(positionId);
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

		async submit({ positionId, guildId, userId, userName, answers }) {
			const position = getPosition(positionId);
			const id = Number(q.insert.run({ positionId, guildId, userId, userName, answers: JSON.stringify(answers), history: JSON.stringify([{ status: 'received', by: userId, at: now() }]), at: now() }).lastInsertRowid);
			let application = getApplication(id);
			if (position.config.reviewChannelId) {
				const posted = await executor.upsertApplicationMessage(position.config.reviewChannelId, null, { position, application, status: STATUSES.received }, { thread: true, pingRoleIds: position.config.pingRoleIds })
					.catch((error) => {
						logger.warn(`Application #${id} not posted:`, error.message);
						return null;
					});
				if (posted) q.setReview.run(position.config.reviewChannelId, posted.messageId, posted.threadId ?? null, id);
				application = getApplication(id);
			}
			const text = dmText(position, 'received');
			if (text) await executor.sendDM(userId, text).catch(() => null);
			audit.record({ actorId: userId, source: 'bot', action: 'recruitment.apply', guildId, target: String(id), details: { position: position.name, member: `<@${userId}>` } });
			return application;
		},

		async vote(userId, applicationId, value, comment = null) {
			const principal = await ranks.resolve(userId);
			if (!principal.can('recruitment.vote') && !principal.can('recruitment.manage')) throw new ForbiddenError('Tu ne peux pas voter sur les candidatures.');
			const application = getApplication(applicationId);
			if (application.userId === userId) throw new ForbiddenError('Tu ne peux pas voter pour ta propre candidature.');
			if (!['received', 'review', 'interview'].includes(application.status)) throw new ValidationError('Cette candidature est close.');
			if (![-1, 0, 1].includes(value)) throw new ValidationError('Vote invalide.');
			q.vote.run(applicationId, userId, value, comment ? String(comment).slice(0, 500) : null, now());
			const updated = getApplication(applicationId);
			await refreshReview(updated);
			return updated;
		},

		addNote(actor, applicationId, text) {
			need(actor, 'recruitment.vote');
			const application = getApplication(applicationId);
			const clean = String(text ?? '').trim().slice(0, 1000);
			if (!clean) throw new ValidationError('Note vide.');
			q.setNotes.run(JSON.stringify([...application.notes, { by: actor.id, at: now(), text: clean }].slice(-100)), now(), applicationId);
			return getApplication(applicationId);
		},

		// received -> review -> interview -> accepted / rejected (or withdrawn by the candidate)
		async setStatus(actor, applicationId, status, { reason = '' } = {}) {
			const application = getApplication(applicationId);
			if (status === 'withdrawn') {
				if (actor.id !== application.userId) throw new ForbiddenError('Seul le candidat peut retirer sa candidature.');
			}
			else {
				need(actor, 'recruitment.manage');
			}
			if (!STATUSES[status]) throw new ValidationError('Statut inconnu.');
			if (['accepted', 'rejected', 'withdrawn'].includes(application.status)) throw new ValidationError('Cette candidature est déjà close.');
			const position = getPosition(application.positionId);
			const history = JSON.stringify([...application.history, { status, by: actor.id, at: now(), reason: reason || null }]);
			const final = ['accepted', 'rejected', 'withdrawn'].includes(status);
			q.setStatus.run(status, history, final ? actor.id : null, final ? now() : null, now(), applicationId);

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
				if (channelId) q.setInterview.run(channelId, applicationId);
			}
			if (status === 'accepted') {
				for (const roleId of position.config.acceptRoleIds) {
					await executor.addRole(application.guildId, application.userId, roleId, `Candidature acceptée (${position.name})`).catch(error => logger.warn('Accept role failed:', error.message));
				}
				if (position.config.acceptRankId) {
					await ranks.assignDirect(actor, application.userId, position.config.acceptRankId).catch(error => logger.warn(`Rank of the new staff member not given: ${error.message}`));
				}
			}
			const updated = getApplication(applicationId);
			await refreshReview(updated);
			const text = dmText(position, status);
			if (text && status !== 'withdrawn') await executor.sendDM(application.userId, `${text}${reason ? `\n${reason}` : ''}`).catch(() => null);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'recruitment.status', guildId: application.guildId, target: String(applicationId), details: { position: position.name, member: `<@${application.userId}>`, status: STATUSES[status].label, reason: reason || null } });
			return updated;
		},

		list(actor, { guildId, positionId, status, userId } = {}) {
			need(actor, 'recruitment.view');
			const where = [guildId && 'guild_id = @guildId', positionId && 'position_id = @positionId', status && 'status = @status', userId && 'user_id = @userId'].filter(Boolean);
			return db.prepare(`SELECT * FROM recruit_applications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 500`).all({ guildId, positionId, status, userId }).map(toApplication);
		},

		get(actor, id) {
			need(actor, 'recruitment.view');
			return getApplication(id);
		},
	};
	return service;
}
