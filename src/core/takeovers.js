import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeForm, nextStep, readStep } from './forms.js';

definePermission('takeovers.view', { label: 'Voir les reprises et leurs inscrits', category: 'Reprises' });
definePermission('takeovers.manage', { label: 'Gérer les reprises et désigner les repreneurs', category: 'Reprises' });

const SNOWFLAKE = /^\d{17,20}$/;
const FORM_TTL_MS = 30 * 60_000;
const MODES = ['form', 'simple'];

const DEFAULT_FORM = { steps: [
	{ title: 'Ta demande de reprise', questions: [
		{ id: 'rp_name', type: 'short', label: 'Ton nom RP', maxLength: 60 },
		{ id: 'experience', type: 'paragraph', label: 'Ton expérience', maxLength: 1500 },
		{ id: 'project', type: 'paragraph', label: 'Ton projet', maxLength: 2000 },
		{ id: 'why', type: 'paragraph', label: 'Pourquoi toi ?', maxLength: 2000 },
	] },
] };

export const CATEGORIES = {
	business: {
		label: 'Entreprises',
		panelTitle: 'Reprises d’entreprises',
		announceMessage: '🏢 **{nom}** est reprise par {repreneur}. Merci à tous les participants !',
	},
	illegal: {
		label: 'Groupes illégaux',
		panelTitle: 'Reprises de groupes illégaux',
		announceMessage: '🕶️ **{nom}** est repris par {repreneur}. Merci à tous les participants !',
	},
};

const DEFAULT_CONVOKE = 'Les entretiens pour la reprise de **{nom}** commencent. Le staff va te faire passer en vocal, reste disponible sur le serveur.';

const channel = value => (SNOWFLAKE.test(value) ? value : null);
const fillText = (text, values) => text.replace(/\{(nom|repreneur)\}/g, (all, key) => values[key] ?? all);

function normalizeCategory(category, input = {}) {
	const defaults = CATEGORIES[category];
	const form = normalizeForm(input.form ?? DEFAULT_FORM, { fallback: DEFAULT_FORM });
	if (!form.steps.length) throw new ValidationError(`${defaults.label} : le formulaire doit avoir au moins une question.`);
	return {
		panelChannelId: channel(input.panelChannelId),
		announceChannelId: channel(input.announceChannelId),
		convokeMessage: String(input.convokeMessage || DEFAULT_CONVOKE).slice(0, 1800),
		announceMessage: String(input.announceMessage || defaults.announceMessage).slice(0, 1800),
		form,
	};
}

export function createTakeovers({ db, network, audit, executor, settings, logger = console, now = Date.now }) {
	const q = {
		all: db.prepare('SELECT * FROM takeovers WHERE guild_id = ? ORDER BY finished_at DESC NULLS FIRST, id DESC'),
		get: db.prepare('SELECT * FROM takeovers WHERE id = ?'),
		insert: db.prepare('INSERT INTO takeovers (guild_id, category, name, description, mode, interview_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
		update: db.prepare('UPDATE takeovers SET category = ?, name = ?, description = ?, mode = ?, interview_at = ? WHERE id = ?'),
		setOpen: db.prepare('UPDATE takeovers SET open = ? WHERE id = ? AND finished_at IS NULL'),
		delete: db.prepare('DELETE FROM takeovers WHERE id = ?'),
		// Only once, whoever gets there first: the date that arrives or the button of the staff
		convoke: db.prepare('UPDATE takeovers SET convoked_at = ?, open = FALSE WHERE id = ? AND convoked_at IS NULL AND finished_at IS NULL'),
		due: db.prepare(`
			SELECT t.* FROM takeovers t
			WHERE t.finished_at IS NULL AND t.interview_at <= ? AND (t.convoked_at IS NULL OR EXISTS (
				SELECT 1 FROM takeover_entries e WHERE e.takeover_id = t.id AND e.status = 'active' AND e.dm_status IS NULL
			))
			ORDER BY t.id
		`),
		finish: db.prepare('UPDATE takeovers SET winner_id = ?, winner_name = ?, finished_at = ?, open = FALSE WHERE id = ? AND finished_at IS NULL'),
		unfinish: db.prepare('UPDATE takeovers SET winner_id = NULL, winner_name = NULL, finished_at = NULL WHERE id = ?'),
		entries: db.prepare('SELECT * FROM takeover_entries WHERE guild_id = ? ORDER BY created_at, id'),
		entry: db.prepare('SELECT * FROM takeover_entries WHERE id = ?'),
		entryOf: db.prepare('SELECT * FROM takeover_entries WHERE takeover_id = ? AND user_id = ?'),
		pending: db.prepare('SELECT * FROM takeover_entries WHERE takeover_id = ? AND status = \'active\' AND dm_status IS NULL ORDER BY id'),
		insertEntry: db.prepare('INSERT INTO takeover_entries (takeover_id, guild_id, user_id, user_name, answers, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (takeover_id, user_id) DO NOTHING'),
		leave: db.prepare('DELETE FROM takeover_entries WHERE takeover_id = ? AND user_id = ? AND status = \'active\''),
		remove: db.prepare('UPDATE takeover_entries SET status = \'removed\' WHERE id = ? AND status = \'active\''),
		// Claimed before the send: a restart or a second run cannot send the same DM twice
		claimDm: db.prepare('UPDATE takeover_entries SET dm_status = \'sent\' WHERE id = ? AND dm_status IS NULL'),
		failDm: db.prepare('UPDATE takeover_entries SET dm_status = \'failed\' WHERE id = ?'),
	};
	const forms = new Map();
	const keyOf = guildId => `takeovers.config.${guildId}`;

	const need = (actor, permission) => {
		if (!actor.can(permission)) throw new ForbiddenError('Ton rang ne permet pas de gérer les reprises.');
	};
	const toTakeover = row => row && ({
		id: row.id, guildId: row.guild_id, category: row.category, name: row.name, description: row.description, mode: row.mode, open: row.open,
		interviewAt: row.interview_at, convokedAt: row.convoked_at, winnerId: row.winner_id, winnerName: row.winner_name, finishedAt: row.finished_at, createdAt: row.created_at,
	});
	const toEntry = row => row && ({
		id: row.id, takeoverId: row.takeover_id, userId: row.user_id, userName: row.user_name, answers: JSON.parse(row.answers), status: row.status, dmStatus: row.dm_status, createdAt: row.created_at,
	});

	async function getTakeover(id) {
		const takeover = toTakeover(await q.get.get(id));
		if (!takeover) throw new NotFoundError('Reprise introuvable.');
		return takeover;
	}

	async function readConfig(guildId) {
		const saved = await settings.get(keyOf(guildId), {});
		return Object.fromEntries(Object.keys(CATEGORIES).map(category => [category, { ...normalizeCategory(category, saved[category]), panelMessageId: saved[category]?.panelMessageId ?? null }]));
	}

	async function renderPanel(guildId, category, config) {
		const takeovers = (await q.all.all(guildId)).map(toTakeover).filter(t => t.category === category && !t.finishedAt).reverse();
		const messageId = await executor.publishTakeoverPanel(config[category].panelChannelId, config[category].panelMessageId, { title: CATEGORIES[category].panelTitle, takeovers });
		if (messageId !== config[category].panelMessageId) {
			config[category].panelMessageId = messageId;
			await settings.set(keyOf(guildId), config);
		}
		return messageId;
	}

	// Every panel already published follows what the staff changes; a failure never blocks the change
	async function refreshPanels(guildId) {
		try {
			const config = await readConfig(guildId);
			for (const category of Object.keys(CATEGORIES)) {
				if (config[category].panelChannelId && config[category].panelMessageId) await renderPanel(guildId, category, config);
			}
		}
		catch (error) {
			logger.warn('Takeover panel refresh failed:', error.message);
		}
	}

	async function record(actor, action, takeover, details = {}) {
		await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId: takeover.guildId, target: String(takeover.id), details: { nom: takeover.name, ...details } });
	}

	async function sendConvocations(takeover) {
		const config = await readConfig(takeover.guildId);
		const content = fillText(config[takeover.category].convokeMessage, { nom: takeover.name });
		const result = { sent: 0, failed: 0 };
		for (const row of await q.pending.all(takeover.id)) {
			if (!(await q.claimDm.run(row.id)).changes) continue;
			try {
				await executor.sendDM(row.user_id, content);
				result.sent++;
			}
			catch (error) {
				logger.warn(`Takeover DM not sent to ${row.user_id}:`, error.message);
				await q.failDm.run(row.id);
				result.failed++;
			}
		}
		return result;
	}

	function assertRunning(takeover) {
		if (takeover.finishedAt) throw new ValidationError('Cette reprise est terminée.');
	}

	function readInput(input) {
		const name = String(input.name ?? '').trim();
		if (!name || name.length > 60) throw new ValidationError('Le nom fait 1 à 60 caractères.');
		if (!CATEGORIES[input.category]) throw new ValidationError('Choisis Entreprise ou Groupe illégal.');
		if (!MODES.includes(input.mode)) throw new ValidationError('Choisis un dossier ou une inscription simple.');
		return { name, category: input.category, mode: input.mode, description: String(input.description ?? '').slice(0, 1000), interviewAt: Number.isSafeInteger(input.interviewAt) ? input.interviewAt : null };
	}

	const service = {
		categories: CATEGORIES,
		getTakeover,

		async overview(actor, guildId) {
			need(actor, 'takeovers.view');
			const [takeovers, entries, config] = await Promise.all([q.all.all(guildId), q.entries.all(guildId), readConfig(guildId)]);
			const all = entries.map(toEntry);
			return { config, takeovers: takeovers.map(toTakeover).map(t => ({ ...t, entries: all.filter(e => e.takeoverId === t.id) })) };
		},

		async saveConfig(actor, guildId, input) {
			need(actor, 'takeovers.manage');
			const before = await readConfig(guildId);
			const config = {};
			for (const category of Object.keys(CATEGORIES)) {
				const next = normalizeCategory(category, input?.[category]);
				config[category] = { ...next, panelMessageId: next.panelChannelId === before[category].panelChannelId ? before[category].panelMessageId : null };
			}
			await settings.set(keyOf(guildId), config);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'takeovers.config', guildId, target: guildId, details: {} });
			await refreshPanels(guildId);
			return await readConfig(guildId);
		},

		async publishPanel(actor, guildId, category) {
			need(actor, 'takeovers.manage');
			if (!CATEGORIES[category]) throw new NotFoundError('Catégorie introuvable.');
			const config = await readConfig(guildId);
			if (!config[category].panelChannelId) throw new ValidationError('Choisis d’abord le salon du panneau et enregistre.');
			return await renderPanel(guildId, category, config);
		},

		async save(actor, guildId, input = {}) {
			need(actor, 'takeovers.manage');
			if ((await network.find(guildId))?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const t = readInput(input);
			let id = input.id;
			if (id) {
				const existing = await getTakeover(id);
				if (existing.guildId !== guildId) throw new NotFoundError('Reprise introuvable.');
				assertRunning(existing);
				if (existing.convokedAt) t.interviewAt = existing.interviewAt;
				else if (t.interviewAt !== existing.interviewAt && t.interviewAt !== null && t.interviewAt <= now()) throw new ValidationError('La date des entretiens est déjà passée.');
				await q.update.run(t.category, t.name, t.description, t.mode, t.interviewAt, id);
			}
			else {
				if (t.interviewAt !== null && t.interviewAt <= now()) throw new ValidationError('La date des entretiens est déjà passée.');
				id = Number((await q.insert.run(guildId, t.category, t.name, t.description, t.mode, t.interviewAt, now())).lastInsertRowid);
			}
			const saved = await getTakeover(id);
			await record(actor, 'takeovers.save', saved, { mode: t.mode === 'form' ? 'Dossier' : 'Inscription simple' });
			await refreshPanels(guildId);
			return saved;
		},

		async setOpen(actor, id, open) {
			need(actor, 'takeovers.manage');
			const takeover = await getTakeover(id);
			assertRunning(takeover);
			if (open && takeover.convokedAt) throw new ValidationError('Les inscrits ont déjà reçu leur MP : les inscriptions ne peuvent plus rouvrir.');
			await q.setOpen.run(Boolean(open), id);
			await record(actor, open ? 'takeovers.open' : 'takeovers.close', takeover);
			await refreshPanels(takeover.guildId);
			return await getTakeover(id);
		},

		async remove(actor, id) {
			need(actor, 'takeovers.manage');
			const takeover = await getTakeover(id);
			await q.delete.run(id);
			await record(actor, 'takeovers.delete', takeover);
			await refreshPanels(takeover.guildId);
		},

		// Register button. `step` is null in simple mode, where nothing has to be filled in
		async start(id, userId, guildId) {
			const takeover = await getTakeover(id);
			if (takeover.guildId !== guildId) throw new NotFoundError('Reprise introuvable.');
			const entry = toEntry(await q.entryOf.get(id, userId));
			if (entry?.status === 'removed') throw new ValidationError('Ta demande pour cette reprise a été écartée par le staff.');
			if (entry) return { takeover, already: true };
			if (!takeover.open || takeover.finishedAt) throw new ValidationError('Les inscriptions pour cette reprise sont fermées.');
			if (takeover.mode === 'simple') return { takeover, step: null };
			const { form } = (await readConfig(guildId))[takeover.category];
			const step = nextStep(form, 0, []);
			forms.set(`${id}:${userId}`, { answers: [], step, at: now() });
			return { takeover, form, step };
		},

		formOf: async takeover => (await readConfig(takeover.guildId))[takeover.category].form,

		async submitStep(id, userId, step, values) {
			const takeover = await getTakeover(id);
			const form = await service.formOf(takeover);
			const key = `${id}:${userId}`;
			const state = forms.get(key);
			if (!state || state.step !== step || now() - state.at > FORM_TTL_MS || !form.steps[step]) throw new ValidationError('Ce formulaire a expiré : recommence depuis le panneau.');
			state.answers.push(...readStep(form.steps[step], values));
			state.at = now();
			const next = nextStep(form, step + 1, state.answers);
			if (next >= 0) {
				state.step = next;
				return { done: false, next, total: form.steps.length };
			}
			forms.delete(key);
			return { done: true, answers: state.answers.map(({ id: field, label, value }) => ({ id: field, label, value })) };
		},

		async register({ id, guildId, userId, userName, answers = [] }) {
			const takeover = await getTakeover(id);
			if (takeover.guildId !== guildId) throw new NotFoundError('Reprise introuvable.');
			// The form may have been open for a while: the staff can have closed in the meantime
			if (!takeover.open || takeover.finishedAt) throw new ValidationError('Les inscriptions pour cette reprise viennent de fermer.');
			const { changes } = await q.insertEntry.run(id, guildId, userId, userName ?? null, JSON.stringify(answers), now());
			if (!changes) throw new ValidationError('Tu es déjà inscrit à cette reprise.');
			await record({ id: userId, source: 'bot' }, 'takeovers.register', takeover, { member: `<@${userId}>` });
			return takeover;
		},

		async leave(id, userId) {
			const takeover = await getTakeover(id);
			assertRunning(takeover);
			if (!(await q.leave.run(id, userId)).changes) throw new ValidationError('Tu n’es pas inscrit à cette reprise.');
			await record({ id: userId, source: 'bot' }, 'takeovers.leave', takeover, { member: `<@${userId}>` });
			return takeover;
		},

		async removeEntry(actor, entryId) {
			need(actor, 'takeovers.manage');
			const entry = toEntry(await q.entry.get(entryId));
			if (!entry) throw new NotFoundError('Inscription introuvable.');
			const takeover = await getTakeover(entry.takeoverId);
			assertRunning(takeover);
			if ((await q.remove.run(entryId)).changes) await record(actor, 'takeovers.remove_entry', takeover, { member: `<@${entry.userId}>` });
		},

		// DM to everyone registered, without waiting for the date
		async convoke(actor, id) {
			need(actor, 'takeovers.manage');
			const takeover = await getTakeover(id);
			assertRunning(takeover);
			if (!(await q.convoke.run(now(), id)).changes) throw new ValidationError('Les inscrits ont déjà reçu leur MP.');
			const result = await sendConvocations(takeover);
			await record(actor, 'takeovers.convoke', takeover, { envoyés: result.sent, échecs: result.failed });
			await refreshPanels(takeover.guildId);
			return result;
		},

		// The date of a takeover has arrived. Also resumes the DMs of a run cut short by a restart
		async tick(at = now()) {
			for (const row of await q.due.all(at)) {
				const takeover = toTakeover(row);
				try {
					await q.convoke.run(at, takeover.id);
					const result = await sendConvocations(takeover);
					await record({ id: 'system', source: 'system' }, 'takeovers.convoke', takeover, { envoyés: result.sent, échecs: result.failed });
					await refreshPanels(takeover.guildId);
				}
				catch (error) {
					logger.warn(`Takeover #${takeover.id} convocation failed:`, error.message);
				}
			}
		},

		// The staff names who takes it: announced publicly, and the takeover is over
		async finish(actor, id, userId) {
			need(actor, 'takeovers.manage');
			const takeover = await getTakeover(id);
			assertRunning(takeover);
			const entry = toEntry(await q.entryOf.get(id, userId));
			if (entry?.status !== 'active') throw new ValidationError('Cette personne n’est pas inscrite à cette reprise.');
			const { announceChannelId, announceMessage } = (await readConfig(takeover.guildId))[takeover.category];
			if (!announceChannelId) throw new ValidationError('Choisis d’abord le salon d’annonce dans les réglages.');
			if (!(await q.finish.run(userId, entry.userName, now(), id)).changes) throw new ValidationError('Cette reprise vient déjà d’être attribuée.');
			try {
				await executor.sendMessage(announceChannelId, { payload: { content: fillText(announceMessage, { nom: takeover.name, repreneur: `<@${userId}>` }) }, mentionUserIds: [userId] });
			}
			catch (error) {
				await q.unfinish.run(id);
				logger.warn(`Takeover #${id} announcement failed:`, error.message);
				throw new ValidationError('L’annonce n’a pas pu être envoyée : vérifie le salon et les permissions du bot. Rien n’a été attribué.');
			}
			await record(actor, 'takeovers.finish', takeover, { repreneur: `<@${userId}>` });
			await refreshPanels(takeover.guildId);
			return await getTakeover(id);
		},
	};
	return service;
}
