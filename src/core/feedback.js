import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizeForm, nextStep, readStep } from './forms.js';

definePermission('feedback.view', { label: 'Voir les suggestions et les reports de bug', category: 'Suggestions' });
definePermission('feedback.manage', { label: 'Traiter les suggestions et bugs (statut, assignation), configurer les boîtes', category: 'Suggestions' });
definePermission('feedback.staff', { label: 'Voir et signaler les bugs internes du staff', category: 'Suggestions' });

const SNOWFLAKE = /^\d{17,20}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const FORM_TTL_MS = 15 * 60_000;
const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);
const snowflakeOrNull = value => (SNOWFLAKE.test(value) ? value : null);

export const PRESETS = {
	suggestions: {
		name: 'Suggestions', kind: 'public', type: 'suggestion',
		form: { steps: [{ title: 'Ta suggestion', questions: [
			{ id: 'title', type: 'short', label: 'Ta suggestion en une phrase', maxLength: 150 },
			{ id: 'details', type: 'paragraph', label: 'Explique en détail', required: false, maxLength: 1500 },
		] }] },
		statuses: [
			{ key: 'pending', label: 'En attente', emoji: '🕐', color: '#8b8b8b' },
			{ key: 'review', label: 'En étude', emoji: '🔎', color: '#5b9cf6' },
			{ key: 'accepted', label: 'Acceptée', emoji: '✅', color: '#3ccb8a', final: true },
			{ key: 'rejected', label: 'Refusée', emoji: '❌', color: '#e5484d', final: true },
			{ key: 'done', label: 'Faite', emoji: '🎉', color: '#d6a249', final: true },
			{ key: 'duplicate', label: 'Doublon', emoji: '♻️', color: '#8b8b8b', final: true },
		],
	},
	bugs: {
		name: 'Reports de bug', kind: 'public', type: 'bug',
		form: { steps: [{ title: 'Signaler un bug', questions: [
			{ id: 'title', type: 'short', label: 'Le bug en une phrase', maxLength: 150 },
			{ id: 'steps', type: 'paragraph', label: 'Comment le reproduire ?', maxLength: 1500 },
			{ id: 'severity', type: 'select', label: 'Gravité', options: [{ label: 'Gênant' }, { label: 'Bloquant' }, { label: 'Critique' }] },
			{ id: 'proof', type: 'file', label: 'Capture (facultatif)', required: false, maxValues: 3 },
		] }] },
		statuses: [
			{ key: 'new', label: 'Nouveau', emoji: '🆕', color: '#8b8b8b' },
			{ key: 'confirmed', label: 'Confirmé', emoji: '🐛', color: '#e5b25d' },
			{ key: 'progress', label: 'En cours', emoji: '🛠️', color: '#5b9cf6' },
			{ key: 'fixed', label: 'Corrigé', emoji: '✅', color: '#3ccb8a', final: true },
			{ key: 'invalid', label: 'Pas un bug', emoji: '❌', color: '#e5484d', final: true },
		],
	},
	staff: {
		name: 'Bugs internes du staff', kind: 'staff', type: 'bug',
		form: { steps: [{ title: 'Bug interne', questions: [
			{ id: 'title', type: 'short', label: 'Le problème', maxLength: 150 },
			{ id: 'details', type: 'paragraph', label: 'Détails', maxLength: 1500 },
			{ id: 'urgency', type: 'select', label: 'Urgence', options: [{ label: 'Basse', value: 'low' }, { label: 'Moyenne', value: 'medium' }, { label: 'Haute', value: 'high' }, { label: 'Critique', value: 'critical' }] },
		] }] },
		statuses: [
			{ key: 'new', label: 'Nouveau', emoji: '🆕', color: '#8b8b8b' },
			{ key: 'assigned', label: 'Assigné', emoji: '👤', color: '#5b9cf6' },
			{ key: 'progress', label: 'En cours', emoji: '🛠️', color: '#d6a249' },
			{ key: 'testing', label: 'En test', emoji: '🧪', color: '#a855f7' },
			{ key: 'resolved', label: 'Résolu', emoji: '✅', color: '#3ccb8a', final: true },
			{ key: 'rejected', label: 'Rejeté', emoji: '❌', color: '#e5484d', final: true },
		],
	},
};

export const URGENCIES = [
	{ key: 'low', label: 'Basse', color: '#8b8b8b', slaMinutes: 0 },
	{ key: 'medium', label: 'Moyenne', color: '#e5b25d', slaMinutes: 24 * 60 },
	{ key: 'high', label: 'Haute', color: '#f0883e', slaMinutes: 4 * 60 },
	{ key: 'critical', label: 'Critique', color: '#e5484d', slaMinutes: 30 },
];

export const BOX_TYPES = ['suggestion', 'bug'];

// Preset whose defaults fill what a stored config lacks
function presetOf(kind, type) {
	if (kind === 'staff') return PRESETS.staff;
	return type === 'bug' ? PRESETS.bugs : PRESETS.suggestions;
}

// Boxes made before the type existed: a name speaking of bugs (or a staff box) is a bug box
function typeOf(row, config) {
	if (BOX_TYPES.includes(config.type)) return config.type;
	return row.kind === 'staff' || /bug|beug|report/i.test(row.name) ? 'bug' : 'suggestion';
}

export function normalizeBoxConfig(input = {}, preset = PRESETS.suggestions) {
	const seen = new Set();
	const statuses = (Array.isArray(input.statuses) && input.statuses.length ? input.statuses : preset.statuses).slice(0, 15).map((s) => {
		const key = /^[a-z0-9_]{1,20}$/.test(s?.key) ? s.key : null;
		if (!key || seen.has(key)) throw new ValidationError(`Statut invalide ou en double : « ${s?.key} ».`);
		seen.add(key);
		return { key, label: String(s.label ?? key).slice(0, 40), emoji: String(s.emoji ?? '').slice(0, 64), color: COLOR.test(s.color ?? '') ? s.color : '#8b8b8b', final: Boolean(s.final) };
	});
	if (statuses.length < 2) throw new ValidationError('Il faut au moins 2 statuts.');
	const urgencies = (Array.isArray(input.urgencies) && input.urgencies.length ? input.urgencies : URGENCIES).slice(0, 6).map(u => ({
		key: /^[a-z0-9_]{1,20}$/.test(u?.key) ? u.key : 'low',
		label: String(u?.label ?? '').slice(0, 30) || u?.key,
		color: COLOR.test(u?.color ?? '') ? u.color : '#8b8b8b',
		pingRoleIds: (Array.isArray(u?.pingRoleIds) ? u.pingRoleIds : []).filter(r => SNOWFLAKE.test(r)).slice(0, 10),
		slaMinutes: int(u?.slaMinutes, 0, 10_080, 0),
	}));
	return {
		// What the box collects: /proposer lists the suggestion boxes, /bug the bug ones
		type: preset.kind === 'staff' ? 'bug' : BOX_TYPES.includes(input.type) ? input.type : preset.type ?? 'suggestion',
		channelId: snowflakeOrNull(input.channelId),
		reviewChannelId: snowflakeOrNull(input.reviewChannelId),
		acceptedChannelId: snowflakeOrNull(input.acceptedChannelId),
		rejectedChannelId: snowflakeOrNull(input.rejectedChannelId),
		form: normalizeForm(input.form ?? preset.form, { fallback: preset.form }),
		statuses,
		votes: input.votes !== undefined ? Boolean(input.votes) : preset.kind === 'public',
		anonymousAllowed: Boolean(input.anonymousAllowed),
		allowedRoleIds: (Array.isArray(input.allowedRoleIds) ? input.allowedRoleIds : []).filter(r => SNOWFLAKE.test(r)).slice(0, 25),
		cooldownMinutes: int(input.cooldownMinutes, 0, 10_080, preset.kind === 'public' ? 10 : 0),
		thread: input.thread !== false,
		dmAuthor: input.dmAuthor !== false,
		urgencies,
	};
}

export function createFeedback({ db, network, ranks, audit, executor, logger = console, now = Date.now }) {
	const q = {
		boxes: db.prepare('SELECT * FROM feedback_boxes WHERE guild_id = ? ORDER BY id'),
		allBoxes: db.prepare('SELECT * FROM feedback_boxes ORDER BY id'),
		box: db.prepare('SELECT * FROM feedback_boxes WHERE id = ?'),
		insertBox: db.prepare('INSERT INTO feedback_boxes (guild_id, name, kind, config, created_at) VALUES (?, ?, ?, ?, ?)'),
		updateBox: db.prepare('UPDATE feedback_boxes SET name = ?, config = ?, panel_channel_id = ? WHERE id = ?'),
		setPanel: db.prepare('UPDATE feedback_boxes SET panel_channel_id = ?, panel_message_id = ? WHERE id = ?'),
		deleteBox: db.prepare('DELETE FROM feedback_boxes WHERE id = ?'),
		nextNumber: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM feedback_items WHERE box_id = ?'),
		insertItem: db.prepare(`
			INSERT INTO feedback_items (box_id, guild_id, number, author_id, author_name, anonymous, title, answers, status, status_history, urgency, approved, created_at, updated_at)
			VALUES (@boxId, @guildId, @number, @authorId, @authorName, @anonymous, @title, @answers, @status, @history, @urgency, @approved, @at, @at)
		`),
		item: db.prepare('SELECT * FROM feedback_items WHERE id = ?'),
		lastOf: db.prepare('SELECT MAX(created_at) AS at FROM feedback_items WHERE box_id = ? AND author_id = ?'),
		setMessage: db.prepare('UPDATE feedback_items SET channel_id = ?, message_id = ?, thread_id = COALESCE(?, thread_id) WHERE id = ?'),
		setStatus: db.prepare('UPDATE feedback_items SET status = ?, status_reason = ?, status_history = ?, duplicate_of = ?, updated_at = ? WHERE id = ?'),
		setAssignee: db.prepare('UPDATE feedback_items SET assignee_id = ?, updated_at = ? WHERE id = ?'),
		approve: db.prepare('UPDATE feedback_items SET approved = 1, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND approved = 0'),
		removePending: db.prepare('DELETE FROM feedback_items WHERE id = ? AND approved = 0'),
		remove: db.prepare('DELETE FROM feedback_items WHERE id = ?'),
		reminded: db.prepare('UPDATE feedback_items SET reminded_at = ? WHERE id = ?'),
		vote: db.prepare('INSERT INTO feedback_votes (item_id, user_id, value, at) VALUES (?, ?, ?, ?) ON CONFLICT(item_id, user_id) DO UPDATE SET value = excluded.value, at = excluded.at'),
		myVote: db.prepare('SELECT value FROM feedback_votes WHERE item_id = ? AND user_id = ?'),
		unvote: db.prepare('DELETE FROM feedback_votes WHERE item_id = ? AND user_id = ?'),
		voters: db.prepare('SELECT user_id, value, at FROM feedback_votes WHERE item_id = ? ORDER BY at'),
		score: db.prepare('SELECT SUM(value = 1) AS up, SUM(value = -1) AS down FROM feedback_votes WHERE item_id = ?'),
		pendingStaff: db.prepare(`
			SELECT i.*, b.config FROM feedback_items i JOIN feedback_boxes b ON b.id = i.box_id
			WHERE b.kind = 'staff' AND i.assignee_id IS NULL AND i.reminded_at IS NULL AND i.approved = 1
		`),
	};
	// `${boxId}:${userId}` -> answers of a multi-step form in progress
	const forms = new Map();

	function toBox(row) {
		if (!row) return null;
		const raw = JSON.parse(row.config);
		const type = typeOf(row, raw);
		return { id: row.id, guildId: row.guild_id, name: row.name, kind: row.kind, config: normalizeBoxConfig({ ...raw, type }, presetOf(row.kind, type)), panelChannelId: row.panel_channel_id, panelMessageId: row.panel_message_id };
	}
	function toItem(row) {
		if (!row) return null;
		const score = q.score.get(row.id);
		return {
			id: row.id, boxId: row.box_id, guildId: row.guild_id, number: row.number, authorId: row.author_id, authorName: row.author_name, anonymous: Boolean(row.anonymous),
			title: row.title, answers: JSON.parse(row.answers), status: row.status, statusReason: row.status_reason, statusHistory: JSON.parse(row.status_history),
			urgency: row.urgency, assigneeId: row.assignee_id, duplicateOf: row.duplicate_of, approved: Boolean(row.approved), approvedBy: row.approved_by ?? null, approvedAt: row.approved_at ?? null,
			channelId: row.channel_id, messageId: row.message_id, threadId: row.thread_id, createdAt: row.created_at, updatedAt: row.updated_at,
			up: score.up ?? 0, down: score.down ?? 0,
		};
	}

	function getBox(id) {
		const box = toBox(q.box.get(id));
		if (!box) throw new NotFoundError('Boîte introuvable.');
		return box;
	}
	function getItem(id) {
		const item = toItem(q.item.get(id));
		if (!item) throw new NotFoundError('Élément introuvable.');
		return item;
	}

	function canSee(actor, box) {
		return box.kind === 'staff' ? actor.can('feedback.staff') : actor.can('feedback.view');
	}

	async function isHandler(userId, box) {
		const principal = await ranks.resolve(userId);
		return principal.can('feedback.manage') || (box.kind === 'staff' && principal.can('feedback.staff'));
	}

	function statusOf(box, key) {
		return box.config.statuses.find(s => s.key === key) ?? box.config.statuses[0];
	}

	// " sur **Server**" for the DMs: the author may be on several servers of the network
	function onServer(guildId) {
		const name = network.find(guildId)?.name;
		return name ? ` sur **${name}**` : '';
	}

	function view(box, item) {
		return { box, item, status: statusOf(box, item.status), urgency: box.config.urgencies.find(u => u.key === item.urgency) ?? null };
	}

	async function refresh(box, item) {
		if (!item.channelId || !item.messageId) return;
		await executor.upsertFeedbackMessage(item.channelId, item.messageId, view(box, item)).catch(error => logger.warn(`Feedback #${item.id} not refreshed:`, error.message));
	}

	// Posts in the public (or staff) channel, with a discussion thread
	async function publish(box, item) {
		const channelId = box.config.channelId;
		if (!channelId) return item;
		const urgency = box.config.urgencies.find(u => u.key === item.urgency);
		const { messageId, threadId } = await executor.upsertFeedbackMessage(channelId, null, view(box, item), {
			thread: box.config.thread,
			pingRoleIds: box.kind === 'staff' ? urgency?.pingRoleIds ?? [] : [],
		});
		q.setMessage.run(channelId, messageId, threadId ?? null, item.id);
		return getItem(item.id);
	}

	const service = {
		presets: PRESETS,
		boxes: guildId => (guildId ? q.boxes.all(guildId) : q.allBoxes.all()).map(toBox),

		// Boxes of one type (suggestion / bug) a member may post in, for /proposer and /bug
		async boxesFor(guildId, type, userId) {
			const staff = (await ranks.resolve(userId)).can('feedback.staff');
			return service.boxes(guildId).filter(b => b.config.type === type && (b.kind !== 'staff' || staff));
		},
		getBox,

		createBox(actor, guildId, { preset = 'suggestions', name = null, config = {} } = {}) {
			if (!actor.can('feedback.manage')) throw new ForbiddenError('Permission manquante : feedback.manage');
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const base = PRESETS[preset] ?? PRESETS.suggestions;
			const id = Number(q.insertBox.run(guildId, String(name ?? base.name).slice(0, 60), base.kind, JSON.stringify(normalizeBoxConfig(config, base)), now()).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'feedback.box_create', guildId, target: String(id), details: { name: name ?? base.name } });
			return getBox(id);
		},

		updateBox(actor, id, { name, config, panelChannelId = null }) {
			if (!actor.can('feedback.manage')) throw new ForbiddenError('Permission manquante : feedback.manage');
			const box = getBox(id);
			q.updateBox.run(String(name ?? box.name).slice(0, 60) || box.name, JSON.stringify(normalizeBoxConfig(config ?? box.config, presetOf(box.kind, (config ?? box.config).type ?? box.config.type))), snowflakeOrNull(panelChannelId), id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'feedback.box_update', guildId: box.guildId, target: String(id), details: { name: name ?? box.name } });
			return getBox(id);
		},

		deleteBox(actor, id) {
			if (!actor.can('feedback.manage')) throw new ForbiddenError('Permission manquante : feedback.manage');
			const box = getBox(id);
			q.deleteBox.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'feedback.box_delete', guildId: box.guildId, target: String(id), details: { name: box.name } });
		},

		async publishPanel(actor, id) {
			if (!actor.can('feedback.manage')) throw new ForbiddenError('Permission manquante : feedback.manage');
			const box = getBox(id);
			if (!box.panelChannelId) throw new ValidationError('Choisis d’abord le salon du panneau.');
			const messageId = await executor.publishFeedbackPanel(box.panelChannelId, box.panelMessageId, box);
			q.setPanel.run(box.panelChannelId, messageId, id);
			return getBox(id);
		},

		// Before the form: allowed roles and delay between two posts
		async startSubmit(boxId, userId, guildId, { anonymous = false } = {}) {
			const box = getBox(boxId);
			if (box.guildId !== guildId) throw new NotFoundError('Boîte introuvable.');
			if (box.kind === 'staff' && !(await ranks.resolve(userId)).can('feedback.staff')) throw new ForbiddenError('Réservé au staff.');
			if (box.config.allowedRoleIds.length) {
				const roles = await executor.getMemberRoleIds(guildId, userId) ?? [];
				if (!box.config.allowedRoleIds.some(r => roles.includes(r))) throw new ForbiddenError('Il te manque un rôle pour utiliser cette boîte.');
			}
			if (box.config.cooldownMinutes) {
				const last = q.lastOf.get(boxId, userId).at;
				const wait = last ? last + box.config.cooldownMinutes * 60_000 - now() : 0;
				if (wait > 0) throw new ValidationError(`Attends encore ${Math.ceil(wait / 60_000)} minute(s) avant de poster à nouveau.`);
			}
			const step = nextStep(box.config.form, 0, []);
			forms.set(`${boxId}:${userId}`, { answers: [], step, at: now(), anonymous: anonymous && box.config.anonymousAllowed });
			return { box, step };
		},

		submitStep(boxId, userId, step, values) {
			const box = getBox(boxId);
			const key = `${boxId}:${userId}`;
			const state = forms.get(key);
			if (!state || state.step !== step || now() - state.at > FORM_TTL_MS) throw new ValidationError('Ce formulaire a expiré : recommence.');
			state.answers.push(...readStep(box.config.form.steps[step], values));
			state.at = now();
			const next = nextStep(box.config.form, step + 1, state.answers);
			if (next >= 0) {
				state.step = next;
				return { done: false, next, total: box.config.form.steps.length };
			}
			forms.delete(key);
			return { done: true, answers: state.answers, anonymous: state.anonymous };
		},

		async create({ boxId, guildId, userId, userName, answers, anonymous = false }) {
			const box = getBox(boxId);
			const title = (answers.find(a => a.id === 'title')?.value ?? answers.find(a => a.type === 'short' || a.type === 'paragraph')?.value ?? answers[0]?.value ?? '').slice(0, 150);
			if (!title) throw new ValidationError('Le titre est vide.');
			const urgency = box.kind === 'staff' ? (answers.find(a => a.id === 'urgency')?.raw?.[0] ?? 'medium') : null;
			const status = box.config.statuses[0].key;
			const id = Number(q.insertItem.run({
				boxId, guildId, number: q.nextNumber.get(boxId).n, authorId: userId, authorName: userName, anonymous: anonymous && box.config.anonymousAllowed ? 1 : 0,
				title, answers: JSON.stringify(answers.filter(a => a.id !== 'title').map(({ id: aid, label, value }) => ({ id: aid, label, value }))),
				status, history: JSON.stringify([{ key: status, by: userId, at: now() }]), urgency, approved: box.config.reviewChannelId ? 0 : 1, at: now(),
			}).lastInsertRowid);
			let item = getItem(id);
			if (box.config.reviewChannelId) {
				const messageId = await executor.sendFeedbackReview(box.config.reviewChannelId, view(box, item)).catch(() => null);
				if (messageId) q.setMessage.run(box.config.reviewChannelId, messageId, null, id);
			}
			else {
				item = await publish(box, item);
			}
			audit.record({ actorId: userId, source: 'bot', action: 'feedback.create', guildId, target: String(id), details: { box: box.name, number: item.number, title } });
			return getItem(id);
		},

		// Staff validation before the item goes public
		async review(userId, itemId, approved, source = 'bot') {
			const item = getItem(itemId);
			const box = getBox(item.boxId);
			if (!await isHandler(userId, box)) throw new ForbiddenError('Réservé au staff.');
			if (item.approved) throw new ValidationError('Déjà validé.');
			// Decided before any await: a double click (or two staff members) acts only once
			if (!(approved ? q.approve.run(userId, now(), now(), itemId) : q.removePending.run(itemId)).changes) throw new ValidationError('Déjà traité.');
			if (item.messageId) await executor.deleteMessage(item.channelId, item.messageId).catch(() => null);
			if (!approved) {
				if (box.config.dmAuthor) await executor.sendDM(item.authorId, `Ta proposition « ${item.title} » (${box.name})${onServer(item.guildId)} n’a pas été retenue par le staff.`).catch(() => null);
				audit.record({ actorId: userId, source, action: 'feedback.reject_review', guildId: item.guildId, target: String(itemId), details: { title: item.title } });
				return null;
			}
			const published = await publish(box, getItem(itemId));
			if (box.config.dmAuthor && item.authorId !== userId) {
				await executor.sendDM(item.authorId, `✅ Ta proposition « ${item.title} » (${box.name} #${item.number})${onServer(item.guildId)} a été validée par le staff et publiée.`).catch(() => null);
			}
			audit.record({ actorId: userId, source, action: 'feedback.approve', guildId: item.guildId, target: String(itemId), details: { title: item.title } });
			return published;
		},

		async vote(itemId, userId, value) {
			const item = getItem(itemId);
			const box = getBox(item.boxId);
			if (!box.config.votes) throw new ValidationError('Les votes sont désactivés ici.');
			if (statusOf(box, item.status).final) throw new ValidationError('Cette proposition est close.');
			if (item.authorId === userId) throw new ValidationError('Tu ne peux pas voter pour ta propre proposition.');
			const current = q.myVote.get(itemId, userId)?.value;
			if (current === value) q.unvote.run(itemId, userId);
			else q.vote.run(itemId, userId, value, now());
			const updated = getItem(itemId);
			await refresh(box, updated);
			return { item: updated, removed: current === value };
		},

		async setStatus(userId, itemId, key, { reason = '', duplicateOf = null, source = 'bot' } = {}) {
			const item = getItem(itemId);
			const box = getBox(item.boxId);
			if (!await isHandler(userId, box)) throw new ForbiddenError('Réservé au staff.');
			const status = box.config.statuses.find(s => s.key === key);
			if (!status) throw new ValidationError('Statut inconnu.');
			if (duplicateOf !== null && !q.item.get(duplicateOf)) throw new ValidationError('L’élément original n’existe pas.');
			const history = JSON.stringify([...item.statusHistory, { key, by: userId, at: now(), reason: reason || null }].slice(-50));
			q.setStatus.run(key, reason.slice(0, 500) || null, history, duplicateOf, now(), itemId);
			let updated = getItem(itemId);
			// Accepted / rejected channels: the item moves there
			const target = status.final && ['accepted', 'done', 'fixed', 'resolved'].includes(key) ? box.config.acceptedChannelId : status.final ? box.config.rejectedChannelId : null;
			if (target && updated.channelId !== target && updated.messageId) {
				await executor.deleteMessage(updated.channelId, updated.messageId).catch(() => null);
				const { messageId } = await executor.upsertFeedbackMessage(target, null, view(box, updated), { thread: false }).catch(() => ({ messageId: null }));
				if (messageId) q.setMessage.run(target, messageId, null, itemId);
				updated = getItem(itemId);
			}
			else {
				await refresh(box, updated);
			}
			if (status.final && updated.threadId) await executor.lockThread(updated.threadId).catch(() => null);
			if (box.config.dmAuthor && updated.authorId !== userId) {
				await executor.sendDM(updated.authorId, `${status.emoji} Ta proposition « ${updated.title} » (${box.name} #${updated.number})${onServer(updated.guildId)} est maintenant **${status.label}**.${reason ? `\nRaison : ${reason}` : ''}`).catch(() => null);
			}
			audit.record({ actorId: userId, source, action: 'feedback.status', guildId: item.guildId, target: String(itemId), details: { box: box.name, number: item.number, status: status.label, reason: reason || null } });
			return updated;
		},

		async assign(userId, itemId, assigneeId = userId, source = 'bot') {
			const item = getItem(itemId);
			const box = getBox(item.boxId);
			if (!await isHandler(userId, box)) throw new ForbiddenError('Réservé au staff.');
			q.setAssignee.run(assigneeId, now(), itemId);
			const assigned = box.config.statuses.find(s => s.key === 'assigned');
			if (assigned && item.status === box.config.statuses[0].key) return service.setStatus(userId, itemId, 'assigned', { source });
			const updated = getItem(itemId);
			await refresh(box, updated);
			return updated;
		},

		async remove(actor, itemId) {
			const item = getItem(itemId);
			if (!actor.can('feedback.manage')) throw new ForbiddenError('Permission manquante : feedback.manage');
			if (item.messageId) await executor.deleteMessage(item.channelId, item.messageId).catch(() => null);
			q.remove.run(itemId);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'feedback.delete', guildId: item.guildId, target: String(itemId), details: { title: item.title } });
		},

		// Who did what on an item: status changes for everyone who sees the box, voters for its handlers only
		details(actor, itemId) {
			const item = getItem(itemId);
			const box = getBox(item.boxId);
			if (!canSee(actor, box)) throw new ForbiddenError('Tu ne peux pas voir cette boîte.');
			const handler = actor.can('feedback.manage') || (box.kind === 'staff' && actor.can('feedback.staff'));
			const history = item.statusHistory.map(h => ({ ...h, status: statusOf(box, h.key) }));
			const voters = handler ? q.voters.all(itemId).map(v => ({ userId: v.user_id, value: v.value, at: v.at })) : null;
			return { history, voters };
		},

		list(actor, { boxId, status, sort = 'recent', limit = 100 } = {}) {
			const box = getBox(boxId);
			if (!canSee(actor, box)) throw new ForbiddenError('Tu ne peux pas voir cette boîte.');
			const params = { boxId, status, limit: Math.min(Math.max(Number(limit) || 100, 1), 500) };
			const order = sort === 'score'
				? '(SELECT COALESCE(SUM(value), 0) FROM feedback_votes v WHERE v.item_id = i.id) DESC, i.id DESC'
				: sort === 'urgency' ? 'CASE i.urgency WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, i.id' : 'i.id DESC';
			return db.prepare(`SELECT * FROM feedback_items i WHERE box_id = @boxId ${status ? 'AND status = @status' : ''} ORDER BY ${order} LIMIT @limit`).all(params).map(toItem);
		},

		get(actor, itemId) {
			const item = getItem(itemId);
			if (!canSee(actor, getBox(item.boxId))) throw new ForbiddenError('Tu ne peux pas voir cette boîte.');
			return item;
		},

		// Every minute: staff bugs still unassigned after their urgency delay
		async tick() {
			for (const row of q.pendingStaff.all()) {
				const config = normalizeBoxConfig(JSON.parse(row.config), PRESETS.staff);
				const urgency = config.urgencies.find(u => u.key === row.urgency);
				if (!urgency?.slaMinutes || row.created_at + urgency.slaMinutes * 60_000 > now()) continue;
				q.reminded.run(now(), row.id);
				if (row.channel_id) {
					await executor.sendMessage(row.thread_id ?? row.channel_id, {
						payload: { content: `${urgency.pingRoleIds.map(id => `<@&${id}>`).join(' ')} ⏰ Bug **${urgency.label}** #${row.number} « ${row.title} » toujours sans personne depuis ${urgency.slaMinutes} min.`.trim(), embed: { enabled: false } },
						files: [],
						mentionRoleIds: urgency.pingRoleIds,
					}).catch(error => logger.warn(`Reminder of bug #${row.id} failed:`, error.message));
				}
			}
		},
	};
	return service;
}
