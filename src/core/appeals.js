import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('appeals.view', { label: 'Voir les appels de sanction', category: 'Sanctions' });
definePermission('appeals.manage', { label: 'Régler les appels de sanction (salon, questions, délais)', category: 'Sanctions' });

const SNOWFLAKE = /^\d{17,20}$/;
const TYPES = ['ban', 'timeout', 'warn', 'restrict'];
const DAY = 86_400_000;
export const DEFAULT_QUESTIONS = [
	'Pourquoi as-tu été sanctionné, selon toi ?',
	'Pourquoi devrions-nous lever ta sanction ?',
	'Autre chose à ajouter ?',
];

export function normalizeAppealsConfig(input = {}) {
	const questions = (Array.isArray(input.questions) ? input.questions : DEFAULT_QUESTIONS).map(q => String(q ?? '').trim().slice(0, 45)).filter(Boolean).slice(0, 5);
	return {
		enabled: Boolean(input.enabled),
		guildId: SNOWFLAKE.test(input.guildId ?? '') ? input.guildId : null,
		channelId: SNOWFLAKE.test(input.channelId ?? '') ? input.channelId : null,
		pingRoleIds: (Array.isArray(input.pingRoleIds) ? input.pingRoleIds : []).filter(id => SNOWFLAKE.test(id)).slice(0, 10),
		types: (Array.isArray(input.types) ? input.types : ['ban', 'timeout', 'restrict']).filter(t => TYPES.includes(t)),
		cooldownDays: Math.min(365, Math.max(0, Math.round(Number(input.cooldownDays ?? 14) || 0))),
		questions: questions.length ? questions : DEFAULT_QUESTIONS,
	};
}

// Appeals: the sanctioned person explains themselves from the DM of the sanction; the staff accepts
// (the sanction is lifted) or refuses, from Discord or the panel. The person is told by DM.
export function createAppeals({ db, audit, settings, sanctions, executor, logs, logger = console, now = Date.now }) {
	logs.registerCategory('appeals', 'Appels de sanction', { submitted: 'Appel déposé', accepted: 'Appel accepté', rejected: 'Appel refusé' });
	const q = {
		insert: db.prepare('INSERT INTO sanction_appeals (sanction_id, user_id, answers, created_at) VALUES (?, ?, ?, ?)'),
		get: db.prepare('SELECT * FROM sanction_appeals WHERE id = ?'),
		last: db.prepare('SELECT * FROM sanction_appeals WHERE sanction_id = ? ORDER BY created_at DESC LIMIT 1'),
		review: db.prepare('UPDATE sanction_appeals SET review_channel_id = ?, review_message_id = ? WHERE id = ?'),
		decide: db.prepare('UPDATE sanction_appeals SET status = ?, decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?'),
		list: db.prepare('SELECT * FROM sanction_appeals ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC LIMIT 200'),
		pending: db.prepare('SELECT COUNT(*) AS n FROM sanction_appeals WHERE status = \'pending\''),
	};
	const toAppeal = row => row && ({
		id: row.id, sanctionId: row.sanction_id, userId: row.user_id, answers: JSON.parse(row.answers), status: row.status,
		decidedBy: row.decided_by, decisionReason: row.decision_reason, reviewChannelId: row.review_channel_id, reviewMessageId: row.review_message_id,
		createdAt: row.created_at, decidedAt: row.decided_at,
	});
	const config = () => normalizeAppealsConfig(settings.get('appeals.config', {}));
	// Appeals whose decision is being applied
	const deciding = new Set();

	// The sanction DM gets an appeal button only when appeals are open for that kind of sanction
	sanctions.setAppealable(type => config().enabled && config().types.includes(type));

	function getOrThrow(id) {
		const appeal = toAppeal(q.get.get(id));
		if (!appeal) throw new NotFoundError('Appel introuvable.');
		return appeal;
	}

	function view(appeal) {
		const sanction = sanctions.get(appeal.sanctionId);
		return { ...appeal, sanction, questions: config().questions };
	}

	async function refreshReview(appeal) {
		if (!appeal.reviewChannelId || !appeal.reviewMessageId) return;
		await executor.upsertAppealMessage(appeal.reviewChannelId, appeal.reviewMessageId, view(appeal)).catch(error => logger.warn('Appeal message failed:', error.message));
	}

	// Whether this person can appeal this sanction now (and if not, why)
	function check(userId, sanctionId) {
		const cfg = config();
		if (!cfg.enabled) throw new ValidationError('Les appels sont fermés pour le moment.');
		const sanction = sanctions.get(sanctionId);
		if (sanction.userId !== String(userId)) throw new ForbiddenError('Cette sanction ne te concerne pas.');
		if (!cfg.types.includes(sanction.type)) throw new ValidationError('Cette sanction ne peut pas faire l’objet d’un appel.');
		if (sanction.revokedAt) throw new ValidationError('Cette sanction est déjà levée.');
		if (sanction.type !== 'warn' && !sanction.active) throw new ValidationError('Cette sanction est terminée.');
		const last = toAppeal(q.last.get(sanctionId));
		if (last?.status === 'pending') throw new ValidationError('Ton appel est en cours d’examen. Tu recevras la réponse ici.');
		if (last?.status === 'accepted') throw new ValidationError('Ton appel a déjà été accepté.');
		if (last?.status === 'rejected' && now() - last.decidedAt < cfg.cooldownDays * DAY) {
			throw new ValidationError(`Ton appel a été refusé. Tu pourras en refaire un à partir du <t:${Math.round((last.decidedAt + cfg.cooldownDays * DAY) / 1000)}:D>.`);
		}
		return { sanction, questions: cfg.questions };
	}

	const service = {
		config,
		pending: () => q.pending.get().n,

		setConfig(actor, input) {
			if (!actor.can('appeals.manage')) throw new ForbiddenError('Permission manquante : appeals.manage');
			const cfg = normalizeAppealsConfig(input);
			if (cfg.enabled && !cfg.channelId) throw new ValidationError('Choisis le salon où le staff reçoit les appels.');
			settings.set('appeals.config', cfg);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'appeals.config' });
			return cfg;
		},

		// Click on "Faire appel": the questions of the form
		start: (userId, sanctionId) => check(userId, sanctionId),

		async submit(userId, sanctionId, answers) {
			const { sanction, questions } = check(userId, sanctionId);
			const clean = questions.map((question, i) => ({ question, answer: String(answers[i] ?? '').trim().slice(0, 1000) }));
			if (!clean[0]?.answer) throw new ValidationError('Réponds au moins à la première question.');
			const id = Number(q.insert.run(sanctionId, String(userId), JSON.stringify(clean), now()).lastInsertRowid);
			const cfg = config();
			const appeal = getOrThrow(id);
			try {
				const messageId = await executor.upsertAppealMessage(cfg.channelId, null, view(appeal), { pingRoleIds: cfg.pingRoleIds });
				q.review.run(cfg.channelId, messageId, id);
			}
			catch (error) {
				logger.warn('Appeal review message failed:', error.message);
			}
			logs.log(cfg.guildId, 'appeals', { title: 'Appel déposé', description: `<@${userId}> · sanction #${sanction.id} (${sanction.type})`, color: 'info' }, 'submitted');
			audit.record({ actorId: String(userId), source: 'bot', action: 'appeals.submit', target: String(sanction.id), details: { member: `<@${userId}>`, sanction: sanction.id } });
			return getOrThrow(id);
		},

		// Accepted: the sanction is lifted (the decider needs sanctions.revoke); refused: a reason for the person
		async decide(actor, id, accepted, reason = '') {
			if (!actor.can('sanctions.revoke')) throw new ForbiddenError('Il faut pouvoir lever des sanctions (sanctions.revoke) pour décider d’un appel.');
			const appeal = getOrThrow(id);
			if (appeal.status !== 'pending' || deciding.has(appeal.id)) throw new ValidationError('Cet appel a déjà été traité.');
			const text = String(reason ?? '').trim().slice(0, 500);
			// Accepting waits for the sanction to be lifted: a second decision (double click, two staff members) must not slip in
			deciding.add(appeal.id);
			try {
				if (accepted) await sanctions.revoke(actor, appeal.sanctionId, `Appel accepté${text ? ` : ${text}` : ''}`);
				q.decide.run(accepted ? 'accepted' : 'rejected', actor.id, text || null, now(), id);
			}
			finally {
				deciding.delete(appeal.id);
			}
			const cooldown = config().cooldownDays;
			const message = accepted
				? `✅ Ton appel a été **accepté** : ta sanction #${appeal.sanctionId} est levée.${text ? `\nMot du staff : ${text}` : ''}`
				: `❌ Ton appel pour la sanction #${appeal.sanctionId} a été **refusé**.${text ? `\nRaison : ${text}` : ''}${cooldown ? `\nTu pourras refaire un appel dans ${cooldown} jours.` : ''}`;
			await executor.sendDM(appeal.userId, message).catch(() => null);
			const done = getOrThrow(id);
			await refreshReview(done);
			logs.log(config().guildId, 'appeals', { title: accepted ? 'Appel accepté' : 'Appel refusé', description: `<@${appeal.userId}> · sanction #${appeal.sanctionId} · par <@${actor.id}>${text ? `\n${text}` : ''}`, color: accepted ? 'success' : 'danger' }, accepted ? 'accepted' : 'rejected');
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: accepted ? 'appeals.accept' : 'appeals.reject', target: String(appeal.sanctionId), details: { member: `<@${appeal.userId}>`, reason: text || null } });
			return done;
		},

		list(actor) {
			if (!actor.can('appeals.view') && !actor.can('sanctions.revoke')) throw new ForbiddenError('Permission manquante : appeals.view');
			return q.list.all().map(toAppeal).map(view);
		},

		get: id => view(getOrThrow(id)),
	};
	return service;
}
