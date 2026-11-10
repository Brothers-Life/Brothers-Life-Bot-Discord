import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeForm, nextStep, readStep } from './forms.js';
import { isValidEmoji } from './emoji.js';

definePermission('takeovers.view', { label: 'Voir les reprises et leurs inscrits', category: 'Reprises' });
definePermission('takeovers.manage', { label: 'Gérer les reprises et désigner les repreneurs', category: 'Reprises' });

const SNOWFLAKE = /^\d{17,20}$/;
const FORM_TTL_MS = 30 * 60_000;
const MODES = ['form', 'simple'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const GROUPS_MAX = 20;
const LINKS_MAX = 10;

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
		panelTitle: '🏢 Reprises d’entreprises',
		panelDescription: 'Une entreprise te fait envie ? Clique sur son bouton pour te lancer. Quand les entretiens commencent, tu reçois un MP, puis le staff annonce qui reprend.',
		color: '#ff9628',
		announceMessage: '🏢 **{nom}** est reprise par {repreneur}. Merci à tous les participants !',
	},
	illegal: {
		label: 'Groupes illégaux',
		panelTitle: '🕶️ Reprises de groupes illégaux',
		panelDescription: 'Un groupe t’intéresse ? Clique sur son bouton pour te lancer. Quand les entretiens commencent, tu reçois un MP, puis le staff annonce qui reprend.',
		color: '#c0392b',
		announceMessage: '🕶️ **{nom}** est repris par {repreneur}. Merci à tous les participants !',
	},
};

const DEFAULT_CONVOKE = 'Les entretiens pour la reprise de **{nom}** commencent. Le staff va te faire passer en vocal, reste disponible sur le serveur.';

const channel = value => (SNOWFLAKE.test(value) ? value : null);
const imageUrl = (value) => {
	const url = String(value ?? '').trim();
	return /^https?:\/\/\S+$/i.test(url) && URL.canParse(url) ? url.slice(0, 1000) : null;
};
const fillText = (text, values) => text.replace(/\{(nom|repreneur)\}/g, (all, key) => values[key] ?? all);

// Channels of other servers of the network showing the same panel and the same announcements
function normalizeLinks(input) {
	const seen = new Set();
	return (Array.isArray(input) ? input : []).flatMap((link) => {
		if (!SNOWFLAKE.test(link?.guildId) || seen.has(link.guildId)) return [];
		seen.add(link.guildId);
		return [{ guildId: link.guildId, panelChannelId: channel(link.panelChannelId), panelMessageId: channel(link.panelMessageId), announceChannelId: channel(link.announceChannelId) }];
	}).slice(0, LINKS_MAX);
}

function normalizeCategory(category, input = {}) {
	const defaults = CATEGORIES[category];
	const form = normalizeForm(input.form ?? DEFAULT_FORM, { fallback: DEFAULT_FORM });
	if (!form.steps.length) throw new ValidationError(`${defaults.label} : le formulaire doit avoir au moins une question.`);
	return {
		panelChannelId: channel(input.panelChannelId),
		announceChannelId: channel(input.announceChannelId),
		panelTitle: String(input.panelTitle || defaults.panelTitle).trim().slice(0, 100) || defaults.panelTitle,
		panelDescription: String(input.panelDescription ?? defaults.panelDescription).slice(0, 1000),
		color: HEX_COLOR.test(input.color) ? input.color : defaults.color,
		thumbnailUrl: imageUrl(input.thumbnailUrl),
		imageUrl: imageUrl(input.imageUrl),
		links: normalizeLinks(input.links),
		convokeMessage: String(input.convokeMessage || DEFAULT_CONVOKE).slice(0, 1800),
		announceMessage: String(input.announceMessage || defaults.announceMessage).slice(0, 1800),
		form,
	};
}

export function createTakeovers({ db, network, audit, executor, settings, logger = console, now = Date.now }) {
	const q = {
		all: db.prepare('SELECT * FROM takeovers WHERE guild_id = ? ORDER BY finished_at DESC NULLS FIRST, position, id'),
		get: db.prepare('SELECT * FROM takeovers WHERE id = ?'),
		insert: db.prepare('INSERT INTO takeovers (guild_id, category, group_id, name, description, mode, interview_at, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
		update: db.prepare('UPDATE takeovers SET category = ?, group_id = ?, name = ?, description = ?, mode = ?, interview_at = ?, position = ? WHERE id = ?'),
		nextPosition: db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM takeovers WHERE guild_id = ? AND category = ?'),
		placeItem: db.prepare('UPDATE takeovers SET group_id = ?, position = ? WHERE id = ? AND guild_id = ? AND category = ? AND finished_at IS NULL'),
		groups: db.prepare('SELECT * FROM takeover_groups WHERE guild_id = ? ORDER BY position, id'),
		group: db.prepare('SELECT * FROM takeover_groups WHERE id = ?'),
		nextGroupPosition: db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(position), 0) + 1 AS n FROM takeover_groups WHERE guild_id = ? AND category = ?'),
		insertGroup: db.prepare('INSERT INTO takeover_groups (guild_id, category, name, emoji, position, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
		updateGroup: db.prepare('UPDATE takeover_groups SET name = ?, emoji = ? WHERE id = ?'),
		placeGroup: db.prepare('UPDATE takeover_groups SET position = ? WHERE id = ?'),
		deleteGroup: db.prepare('DELETE FROM takeover_groups WHERE id = ?'),
		counts: db.prepare('SELECT takeover_id, COUNT(*) AS n FROM takeover_entries WHERE guild_id = ? AND status = \'active\' GROUP BY takeover_id'),
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
	// Registrations come in bursts: their counters reach the panels on the next tick, in one edit
	const stalePanels = new Set();
	const keyOf = guildId => `takeovers.config.${guildId}`;

	const need = (actor, permission) => {
		if (!actor.can(permission)) throw new ForbiddenError('Ton rang ne permet pas de gérer les reprises.');
	};
	const toTakeover = row => row && ({
		id: row.id, guildId: row.guild_id, category: row.category, groupId: row.group_id, position: row.position, name: row.name, description: row.description, mode: row.mode, open: row.open,
		interviewAt: row.interview_at, convokedAt: row.convoked_at, winnerId: row.winner_id, winnerName: row.winner_name, finishedAt: row.finished_at, createdAt: row.created_at,
	});
	const toGroup = row => row && ({ id: row.id, guildId: row.guild_id, category: row.category, name: row.name, emoji: row.emoji, position: row.position });
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

	// `onlyPublished`: following a change never posts a panel nobody asked for yet
	async function renderPanel(guildId, category, config, { onlyPublished = false } = {}) {
		const [rows, groups, counts] = await Promise.all([q.all.all(guildId), q.groups.all(guildId), q.counts.all(guildId)]);
		const registered = new Map(counts.map(c => [c.takeover_id, c.n]));
		const takeovers = rows.map(toTakeover).filter(t => t.category === category && !t.finishedAt).map(t => ({ ...t, registered: registered.get(t.id) ?? 0 }));
		const { panelTitle, panelDescription, color, thumbnailUrl, imageUrl: image } = config[category];
		const view = {
			home: guildId, category, title: panelTitle, description: panelDescription, color, thumbnailUrl, imageUrl: image, takeovers,
			groups: groups.map(toGroup).filter(g => g.category === category),
		};
		const main = config[category];
		let changed = false;
		for (const target of [main, ...main.links]) {
			if (!target.panelChannelId || (onlyPublished && !target.panelMessageId)) continue;
			try {
				const messageId = await executor.publishTakeoverPanel(target.panelChannelId, target.panelMessageId, view);
				changed ||= messageId !== target.panelMessageId;
				target.panelMessageId = messageId;
			}
			catch (error) {
				// A server that refuses never blocks the others; only asking for the main panel reports it
				if (target === main && !onlyPublished) throw error;
				logger.warn(`Takeover panel not published in ${target.panelChannelId}:`, error.message);
			}
		}
		if (changed) await settings.set(keyOf(guildId), config);
		return main.panelMessageId;
	}

	async function checkLinks(guildId, category, links, previous) {
		const { label } = CATEGORIES[category];
		for (const link of links) {
			if (link.guildId === guildId) throw new ValidationError(`${label} : ce serveur porte déjà ces reprises.`);
			if ((await network.find(link.guildId))?.status !== 'active') throw new ValidationError(`${label} : un serveur relié ne fait pas partie du réseau.`);
			if (!link.panelChannelId && !link.announceChannelId) throw new ValidationError(`${label} : choisis au moins un salon pour chaque serveur relié.`);
			const channels = new Set((await executor.listTextChannels(link.guildId)).map(c => c.id));
			if ([link.panelChannelId, link.announceChannelId].some(id => id && !channels.has(id))) throw new ValidationError(`${label} : un salon relié n’appartient pas au serveur choisi.`);
			const same = previous.find(p => p.guildId === link.guildId);
			link.panelMessageId = same?.panelChannelId === link.panelChannelId ? same.panelMessageId : null;
		}
		return links;
	}

	// A link removed or moved must not leave a panel whose buttons no longer work
	async function dropOldPanels(before, after) {
		for (const category of Object.keys(CATEGORIES)) {
			for (const old of before[category].links) {
				if (!old.panelMessageId || after[category].links.some(l => l.guildId === old.guildId && l.panelChannelId === old.panelChannelId)) continue;
				await executor.deleteMessage(old.panelChannelId, old.panelMessageId).catch(error => logger.warn('Old takeover panel not deleted:', error.message));
			}
		}
	}

	// The panel can be used from the server of the takeover or from one linked to it
	async function assertReachable(home, category, guildId) {
		if (home === guildId) return;
		const { links } = (await readConfig(home))[category];
		if (!links.some(l => l.guildId === guildId)) throw new NotFoundError('Reprise introuvable.');
	}

	// Every panel already published follows what the staff changes; a failure never blocks the change
	async function refreshPanels(guildId) {
		try {
			const config = await readConfig(guildId);
			for (const category of Object.keys(CATEGORIES)) {
				if ([config[category], ...config[category].links].some(t => t.panelChannelId && t.panelMessageId)) await renderPanel(guildId, category, config, { onlyPublished: true });
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

	async function getGroup(id, guildId) {
		const group = toGroup(await q.group.get(id));
		if (!group || group.guildId !== guildId) throw new NotFoundError('Catégorie introuvable.');
		return group;
	}

	async function assertGroupFits(groupId, guildId, category) {
		if (groupId === null) return;
		const group = toGroup(await q.group.get(groupId));
		if (group?.guildId !== guildId || group.category !== category) throw new ValidationError('Cette catégorie n’existe plus ou ne correspond pas à ce type de reprise.');
	}

	function assertRunning(takeover) {
		if (takeover.finishedAt) throw new ValidationError('Cette reprise est terminée.');
	}

	function readInput(input) {
		const name = String(input.name ?? '').trim();
		if (!name || name.length > 60) throw new ValidationError('Le nom fait 1 à 60 caractères.');
		if (!CATEGORIES[input.category]) throw new ValidationError('Choisis Entreprise ou Groupe illégal.');
		if (!MODES.includes(input.mode)) throw new ValidationError('Choisis un dossier ou une inscription simple.');
		const groupId = input.groupId === undefined ? undefined : (Number.isSafeInteger(input.groupId) ? input.groupId : null);
		return { name, category: input.category, groupId, mode: input.mode, description: String(input.description ?? '').slice(0, 1000), interviewAt: Number.isSafeInteger(input.interviewAt) ? input.interviewAt : null };
	}

	const service = {
		categories: CATEGORIES,
		getTakeover,

		async overview(actor, guildId) {
			need(actor, 'takeovers.view');
			const [takeovers, entries, config, groups] = await Promise.all([q.all.all(guildId), q.entries.all(guildId), readConfig(guildId), q.groups.all(guildId)]);
			const all = entries.map(toEntry);
			return { config, groups: groups.map(toGroup), takeovers: takeovers.map(toTakeover).map(t => ({ ...t, entries: all.filter(e => e.takeoverId === t.id) })) };
		},

		async saveConfig(actor, guildId, input) {
			need(actor, 'takeovers.manage');
			const before = await readConfig(guildId);
			const config = {};
			for (const category of Object.keys(CATEGORIES)) {
				const next = normalizeCategory(category, input?.[category]);
				for (const key of ['thumbnailUrl', 'imageUrl']) {
					if (input?.[category]?.[key] && !next[key]) throw new ValidationError(`${CATEGORIES[category].label} : l’adresse de l’image doit commencer par http:// ou https://.`);
				}
				const links = await checkLinks(guildId, category, next.links, before[category].links);
				config[category] = { ...next, links, panelMessageId: next.panelChannelId === before[category].panelChannelId ? before[category].panelMessageId : null };
			}
			await settings.set(keyOf(guildId), config);
			await dropOldPanels(before, config);
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
				if (t.groupId === undefined) t.groupId = existing.category === t.category ? existing.groupId : null;
				await assertGroupFits(t.groupId, guildId, t.category);
				if (existing.convokedAt) t.interviewAt = existing.interviewAt;
				else if (t.interviewAt !== existing.interviewAt && t.interviewAt !== null && t.interviewAt <= now()) throw new ValidationError('La date des entretiens est déjà passée.');
				// Moved to another category: it goes to the end of it
				const moved = t.category !== existing.category || t.groupId !== existing.groupId;
				const position = moved ? (await q.nextPosition.get(guildId, t.category)).n : existing.position;
				await q.update.run(t.category, t.groupId, t.name, t.description, t.mode, t.interviewAt, position, id);
			}
			else {
				if (t.interviewAt !== null && t.interviewAt <= now()) throw new ValidationError('La date des entretiens est déjà passée.');
				t.groupId ??= null;
				await assertGroupFits(t.groupId, guildId, t.category);
				const { n } = await q.nextPosition.get(guildId, t.category);
				id = Number((await q.insert.run(guildId, t.category, t.groupId, t.name, t.description, t.mode, t.interviewAt, now(), n)).lastInsertRowid);
			}
			const saved = await getTakeover(id);
			await record(actor, 'takeovers.save', saved, { mode: t.mode === 'form' ? 'Dossier' : 'Inscription simple' });
			await refreshPanels(guildId);
			return saved;
		},

		async saveGroup(actor, guildId, input = {}) {
			need(actor, 'takeovers.manage');
			const name = String(input.name ?? '').trim();
			if (!name || name.length > 40) throw new ValidationError('Le nom de la catégorie fait 1 à 40 caractères.');
			const emoji = input.emoji ? String(input.emoji).trim() : null;
			if (emoji && !isValidEmoji(emoji)) throw new ValidationError('Cet émoji n’est pas valide.');
			let id = input.id;
			if (id) {
				await getGroup(id, guildId);
				await q.updateGroup.run(name, emoji, id);
			}
			else {
				if (!CATEGORIES[input.category]) throw new ValidationError('Choisis Entreprise ou Groupe illégal.');
				const { count, n } = await q.nextGroupPosition.get(guildId, input.category);
				if (count >= GROUPS_MAX) throw new ValidationError(`Pas plus de ${GROUPS_MAX} catégories par type de reprise.`);
				id = Number((await q.insertGroup.run(guildId, input.category, name, emoji, n, now())).lastInsertRowid);
			}
			const saved = await getGroup(id, guildId);
			await record(actor, 'takeovers.group_save', saved);
			await refreshPanels(guildId);
			return saved;
		},

		// Its takeovers stay, without category
		async removeGroup(actor, id, guildId) {
			need(actor, 'takeovers.manage');
			const group = await getGroup(id, guildId);
			await q.deleteGroup.run(id);
			await record(actor, 'takeovers.group_delete', group);
			await refreshPanels(guildId);
		},

		// layout: [{ id: <category or null>, items: [<takeover>, …] }, …], each in the wanted order
		async reorder(actor, guildId, category, layout) {
			need(actor, 'takeovers.manage');
			if (!CATEGORIES[category]) throw new NotFoundError('Catégorie introuvable.');
			const known = new Set((await q.groups.all(guildId)).filter(g => g.category === category).map(g => g.id));
			if (layout.some(({ id }) => id !== null && !known.has(id))) throw new ValidationError('Une catégorie vient d’être supprimée : recharge la page.');
			await db.transaction(async () => {
				let groupPosition = 0;
				let position = 0;
				for (const group of layout) {
					if (group.id !== null) await q.placeGroup.run(++groupPosition, group.id);
					for (const item of group.items) await q.placeItem.run(group.id, ++position, item, guildId, category);
				}
			})();
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'takeovers.reorder', guildId, target: guildId, details: { type: CATEGORIES[category].label } });
			await refreshPanels(guildId);
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
			await assertReachable(takeover.guildId, takeover.category, guildId);
			const entry = toEntry(await q.entryOf.get(id, userId));
			if (entry?.status === 'removed') throw new ValidationError('Ta demande pour cette reprise a été écartée par le staff.');
			if (entry) return { takeover, already: true };
			if (!takeover.open || takeover.finishedAt) throw new ValidationError('Les inscriptions pour cette reprise sont fermées.');
			if (takeover.mode === 'simple') return { takeover, step: null };
			const { form } = (await readConfig(takeover.guildId))[takeover.category];
			const step = nextStep(form, 0, []);
			forms.set(`${id}:${userId}`, { answers: [], step, at: now() });
			return { takeover, form, step };
		},

		// Button of a category on the panel: what can still be joined in it. groupId 0 = no category
		async openIn(home, fromGuildId, category, groupId) {
			if (!CATEGORIES[category]) throw new NotFoundError('Catégorie introuvable.');
			await assertReachable(home, category, fromGuildId);
			const [rows, groups] = await Promise.all([q.all.all(home), q.groups.all(home)]);
			const sameType = groups.map(toGroup).filter(g => g.category === category);
			const group = groupId ? sameType.find(g => g.id === groupId) : null;
			if (groupId && !group) throw new ValidationError('Cette catégorie n’existe plus.');
			const takeovers = rows.map(toTakeover).filter(t => t.category === category && t.open && !t.finishedAt && t.groupId === (group?.id ?? null));
			if (!takeovers.length) throw new ValidationError('Plus aucune inscription ouverte ici pour le moment.');
			return { name: group?.name ?? (sameType.length ? 'Autres' : CATEGORIES[category].label), takeovers };
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
			await assertReachable(takeover.guildId, takeover.category, guildId);
			// The form may have been open for a while: the staff can have closed in the meantime
			if (!takeover.open || takeover.finishedAt) throw new ValidationError('Les inscriptions pour cette reprise viennent de fermer.');
			const { changes } = await q.insertEntry.run(id, takeover.guildId, userId, userName ?? null, JSON.stringify(answers), now());
			if (!changes) throw new ValidationError('Tu es déjà inscrit à cette reprise.');
			await record({ id: userId, source: 'bot' }, 'takeovers.register', takeover, { member: `<@${userId}>` });
			stalePanels.add(takeover.guildId);
			return takeover;
		},

		async leave(id, userId) {
			const takeover = await getTakeover(id);
			assertRunning(takeover);
			if (!(await q.leave.run(id, userId)).changes) throw new ValidationError('Tu n’es pas inscrit à cette reprise.');
			await record({ id: userId, source: 'bot' }, 'takeovers.leave', takeover, { member: `<@${userId}>` });
			stalePanels.add(takeover.guildId);
			return takeover;
		},

		async removeEntry(actor, entryId) {
			need(actor, 'takeovers.manage');
			const entry = toEntry(await q.entry.get(entryId));
			if (!entry) throw new NotFoundError('Inscription introuvable.');
			const takeover = await getTakeover(entry.takeoverId);
			assertRunning(takeover);
			if ((await q.remove.run(entryId)).changes) {
				await record(actor, 'takeovers.remove_entry', takeover, { member: `<@${entry.userId}>` });
				await refreshPanels(takeover.guildId);
			}
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
			for (const guildId of [...stalePanels]) {
				stalePanels.delete(guildId);
				await refreshPanels(guildId);
			}
		},

		// The staff names who takes it: announced publicly, and the takeover is over
		async finish(actor, id, userId) {
			need(actor, 'takeovers.manage');
			const takeover = await getTakeover(id);
			assertRunning(takeover);
			const entry = toEntry(await q.entryOf.get(id, userId));
			if (entry?.status !== 'active') throw new ValidationError('Cette personne n’est pas inscrite à cette reprise.');
			const { announceChannelId, announceMessage, links } = (await readConfig(takeover.guildId))[takeover.category];
			if (!announceChannelId) throw new ValidationError('Choisis d’abord le salon d’annonce dans les réglages.');
			if (!(await q.finish.run(userId, entry.userName, now(), id)).changes) throw new ValidationError('Cette reprise vient déjà d’être attribuée.');
			const announcement = () => ({ payload: { content: fillText(announceMessage, { nom: takeover.name, repreneur: `<@${userId}>` }) }, mentionUserIds: [userId] });
			try {
				await executor.sendMessage(announceChannelId, announcement());
			}
			catch (error) {
				await q.unfinish.run(id);
				logger.warn(`Takeover #${id} announcement failed:`, error.message);
				throw new ValidationError('L’annonce n’a pas pu être envoyée : vérifie le salon et les permissions du bot. Rien n’a été attribué.');
			}
			for (const link of links) {
				if (link.announceChannelId) await executor.sendMessage(link.announceChannelId, announcement()).catch(error => logger.warn(`Takeover announcement not sent in ${link.announceChannelId}:`, error.message));
			}
			await record(actor, 'takeovers.finish', takeover, { repreneur: `<@${userId}>` });
			await refreshPanels(takeover.guildId);
			return await getTakeover(id);
		},
	};
	return service;
}
