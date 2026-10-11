import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('appeals.view', { label: 'Voir les appels de sanction', category: 'Sanctions' });
definePermission('appeals.manage', { label: 'Régler les appels de sanction (salon, questions, délais)', category: 'Sanctions' });

const SNOWFLAKE = /^\d{17,20}$/;
const TYPES = ['ban', 'timeout', 'warn', 'restrict'];
const DAY = 86_400_000;
// Decision reason of an appeal closed because its sanction had already ended (no extra status in the table)
export const MOOT = 'Sans objet : la sanction était déjà terminée.';
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
	logs.registerCategory('appeals', 'Appels de sanction', { submitted: 'Appel déposé', accepted: 'Appel accepté', rejected: 'Appel refusé', moot: 'Appel clos sans objet' });
	const q = {
		insert: db.prepare('INSERT INTO sanction_appeals (sanction_id, user_id, answers, created_at) VALUES (?, ?, ?, ?)'),
		get: db.prepare('SELECT * FROM sanction_appeals WHERE id = ?'),
		last: db.prepare('SELECT * FROM sanction_appeals WHERE sanction_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'),
		review: db.prepare('UPDATE sanction_appeals SET review_channel_id = ?, review_message_id = ? WHERE id = ?'),
		decide: db.prepare('UPDATE sanction_appeals SET status = ?, decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ? AND status = \'pending\''),
		lockSanction: db.prepare('SELECT id FROM sanctions WHERE id = ? FOR UPDATE'),
		list: db.prepare('SELECT * FROM sanction_appeals ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT 200'),
		pending: db.prepare('SELECT COUNT(*) AS n FROM sanction_appeals WHERE status = \'pending\''),
	};
	const toAppeal = row => row && ({
		id: row.id, sanctionId: row.sanction_id, userId: row.user_id, answers: JSON.parse(row.answers), status: row.status,
		decidedBy: row.decided_by, decisionReason: row.decision_reason, reviewChannelId: row.review_channel_id, reviewMessageId: row.review_message_id,
		createdAt: row.created_at, decidedAt: row.decided_at,
		// Closed without a decision: the sanction was already over (stored as rejected, see MOOT)
		moot: row.status === 'rejected' && row.decision_reason === MOOT,
	});
	const config = async () => normalizeAppealsConfig(await settings.get('appeals.config', {}));
	// Appeals whose decision is being applied
	const deciding = new Set();

	// The sanction DM gets an appeal button only when appeals are open for that kind of sanction
	sanctions.setAppealable(async (type) => {
		const cfg = await config();
		return cfg.enabled && cfg.types.includes(type);
	});

	async function getOrThrow(id) {
		const appeal = toAppeal(await q.get.get(id));
		if (!appeal) throw new NotFoundError('Appel introuvable.');
		return appeal;
	}

	async function view(appeal) {
		const sanction = await sanctions.get(appeal.sanctionId);
		return { ...appeal, sanction, questions: (await config()).questions };
	}

	async function refreshReview(appeal) {
		if (!appeal.reviewChannelId || !appeal.reviewMessageId) return;
		await executor.upsertAppealMessage(appeal.reviewChannelId, appeal.reviewMessageId, await view(appeal)).catch(error => logger.warn('Appeal message failed:', error.message));
	}

	// Whether this person can appeal this sanction now (and if not, why)
	async function check(userId, sanctionId) {
		const cfg = await config();
		if (!cfg.enabled) throw new ValidationError('Les appels sont fermés pour le moment.');
		const sanction = await sanctions.get(sanctionId);
		if (sanction.userId !== String(userId)) throw new ForbiddenError('Cette sanction ne te concerne pas.');
		if (!cfg.types.includes(sanction.type)) throw new ValidationError('Cette sanction ne peut pas faire l’objet d’un appel.');
		if (sanction.revokedAt) throw new ValidationError('Cette sanction est déjà levée.');
		if (sanction.type !== 'warn' && !sanction.active) throw new ValidationError('Cette sanction est terminée.');
		const last = toAppeal(await q.last.get(sanctionId));
		if (last?.status === 'pending') throw new ValidationError('Ton appel est en cours d’examen. Tu recevras la réponse ici.');
		if (last?.status === 'accepted') throw new ValidationError('Ton appel a déjà été accepté.');
		if (last?.status === 'rejected' && now() - last.decidedAt < cfg.cooldownDays * DAY) {
			throw new ValidationError(`Ton appel a été refusé. Tu pourras en refaire un à partir du <t:${Math.round((last.decidedAt + cfg.cooldownDays * DAY) / 1000)}:D>.`);
		}
		return { sanction, questions: cfg.questions };
	}

	async function closeMoot(actor, appeal) {
		if (!(await q.decide.run('rejected', actor.id, MOOT, now(), appeal.id)).changes) throw new ValidationError('Cet appel a déjà été traité.');
		await executor.sendDM(appeal.userId, `Ta sanction #${appeal.sanctionId} est déjà terminée, ton appel est clos.`).catch(() => null);
		const done = await getOrThrow(appeal.id);
		await refreshReview(done);
		await logs.log((await config()).guildId, 'appeals', { title: 'Appel clos (sans objet)', description: `<@${appeal.userId}> · sanction #${appeal.sanctionId} déjà terminée · par <@${actor.id}>`, color: 'neutral' }, 'moot');
		await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'appeals.moot', target: String(appeal.sanctionId), details: { member: `<@${appeal.userId}>` } });
		return done;
	}

	const service = {
		config,
		pending: async () => (await q.pending.get()).n,

		async setConfig(actor, input) {
			if (!actor.can('appeals.manage')) throw new ForbiddenError('Permission manquante : appeals.manage');
			const cfg = normalizeAppealsConfig(input);
			if (cfg.enabled && !cfg.channelId) throw new ValidationError('Choisis le salon où le staff reçoit les appels.');
			await settings.set('appeals.config', cfg);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'appeals.config' });
			return cfg;
		},

		// Click on "Faire appel": the questions of the form
		start: (userId, sanctionId) => check(userId, sanctionId),

		async submit(userId, sanctionId, answers) {
			// The sanction row is locked while checking and inserting: two submissions at once make one appeal
			const { sanction, id } = await db.transaction(async () => {
				await q.lockSanction.get(sanctionId);
				const checked = await check(userId, sanctionId);
				const clean = checked.questions.map((question, i) => ({ question, answer: String(answers[i] ?? '').trim().slice(0, 1000) }));
				if (!clean[0]?.answer) throw new ValidationError('Réponds au moins à la première question.');
				return { sanction: checked.sanction, id: Number((await q.insert.run(sanctionId, String(userId), JSON.stringify(clean), now())).lastInsertRowid) };
			})();
			const cfg = await config();
			const appeal = await getOrThrow(id);
			try {
				const messageId = await executor.upsertAppealMessage(cfg.channelId, null, await view(appeal), { pingRoleIds: cfg.pingRoleIds });
				await q.review.run(cfg.channelId, messageId, id);
			}
			catch (error) {
				logger.warn('Appeal review message failed:', error.message);
			}
			await logs.log(cfg.guildId, 'appeals', { title: 'Appel déposé', description: `<@${userId}> · sanction #${sanction.id} (${sanction.type})`, color: 'info' }, 'submitted');
			await audit.record({ actorId: String(userId), source: 'bot', action: 'appeals.submit', target: String(sanction.id), details: { member: `<@${userId}>`, sanction: sanction.id } });
			return await getOrThrow(id);
		},

		// Accepted: the sanction is lifted (the decider needs sanctions.revoke); refused: a reason for the person
		async decide(actor, id, accepted, reason = '') {
			if (!actor.can('sanctions.revoke')) throw new ForbiddenError('Il faut pouvoir lever des sanctions (sanctions.revoke) pour décider d’un appel.');
			const appeal = await getOrThrow(id);
			if (appeal.status !== 'pending' || deciding.has(appeal.id)) throw new ValidationError('Cet appel a déjà été traité.');
			const text = String(reason ?? '').trim().slice(0, 500);
			// Taken before anything is awaited: a second decision (double click, two staff members) must not slip in
			// while the sanction is read or lifted; the conditional update covers another process
			deciding.add(appeal.id);
			try {
				// The sanction ended (expired, lifted) while the appeal waited: nothing left to decide
				const sanction = await sanctions.get(appeal.sanctionId);
				if (sanction.revokedAt || (sanction.type !== 'warn' && !sanction.active)) return await closeMoot(actor, appeal);
				if (accepted) await sanctions.revoke(actor, appeal.sanctionId, `Appel accepté${text ? ` : ${text}` : ''}`, { notify: false });
				if (!(await q.decide.run(accepted ? 'accepted' : 'rejected', actor.id, text || null, now(), id)).changes) throw new ValidationError('Cet appel a déjà été traité.');
			}
			finally {
				deciding.delete(appeal.id);
			}
			const cooldown = (await config()).cooldownDays;
			const message = accepted
				? `✅ Ton appel a été **accepté** : ta sanction #${appeal.sanctionId} est levée.${text ? `\nMot du staff : ${text}` : ''}`
				: `❌ Ton appel pour la sanction #${appeal.sanctionId} a été **refusé**.${text ? `\nRaison : ${text}` : ''}${cooldown ? `\nTu pourras refaire un appel dans ${cooldown} jours.` : ''}`;
			await executor.sendDM(appeal.userId, message).catch(() => null);
			const done = await getOrThrow(id);
			await refreshReview(done);
			await logs.log((await config()).guildId, 'appeals', { title: accepted ? 'Appel accepté' : 'Appel refusé', description: `<@${appeal.userId}> · sanction #${appeal.sanctionId} · par <@${actor.id}>${text ? `\n${text}` : ''}`, color: accepted ? 'success' : 'danger' }, accepted ? 'accepted' : 'rejected');
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: accepted ? 'appeals.accept' : 'appeals.reject', target: String(appeal.sanctionId), details: { member: `<@${appeal.userId}>`, reason: text || null } });
			return done;
		},

		async list(actor) {
			if (!actor.can('appeals.view') && !actor.can('sanctions.revoke')) throw new ForbiddenError('Permission manquante : appeals.view');
			return Promise.all((await q.list.all()).map(toAppeal).map(view));
		},

		get: async id => view(await getOrThrow(id)),
	};
	return service;
}
