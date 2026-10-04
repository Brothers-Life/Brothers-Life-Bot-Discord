import fs from 'node:fs';
import path from 'node:path';
import { definePermission } from './permissions.js';
import { inlineImages, renderTicketTranscript, transcriptText } from './transcript.js';
import { assertFivemAllowed, createVariables, fivemKeysIn } from './variables.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';
import { nextStep, readStep } from './forms.js';
import {
	BUILTIN_KEYS, BUILTIN_STATUSES, PRIORITIES, PRIORITY_LABELS,
	TICKET_VARIABLES, accountCreatedAt, fill, isWithinHours, normalizeCategoryConfig, normalizeGuildConfig, normalizeStatuses, slugName,
} from './ticketConfig.js';
import { ticketStats } from './ticketStats.js';

definePermission('tickets.view', { label: 'Voir les tickets et leurs transcripts', category: 'Tickets' });
definePermission('tickets.handle', { label: 'Traiter les tickets (prendre en charge, statut, fermer)', category: 'Tickets' });
definePermission('tickets.manage', { label: 'Configurer les tickets', category: 'Tickets' });
definePermission('tickets.replies', { label: 'Gérer les réponses enregistrées des tickets', category: 'Tickets' });

// Variables of the saved replies on top of the ticket ones: who sends the answer
export const STAFF_VARIABLES = [
	{ key: 'staff', label: 'Mention du membre du staff qui répond' },
	{ key: 'staff.name', label: 'Nom du membre du staff qui répond' },
];
const STATS_MAX_MS = 366 * 86_400_000;

const FORM_TTL_MS = 15 * 60_000;
// Discord refuses bot files above 10 Mo: the inlined images of a transcript stay well below
const TRANSCRIPT_IMAGES_MAX = 6 * 1024 * 1024;
const SNOWFLAKE = /^\d{17,20}$/;

const DEFAULT_PANEL_PAYLOAD = {
	content: '',
	embed: { enabled: true, title: 'Besoin d’aide ?', description: 'Choisis le type de demande : un salon privé s’ouvre avec l’équipe.', color: '#d6a249' },
};

// variables: shared template variables (member, server, FiveM account), see variables.js
// dataDir: where the HTML transcripts are kept for the panel (none in some tests)
export function createTickets({ db, network, ranks, audit, executor, logs, logger = console, now = Date.now, dataDir = null, fetchImpl = fetch, variables = createVariables({ executor, logger, now }) }) {
	logs.registerCategory('tickets', 'Tickets (ouverture, fermeture, transcripts)');

	const q = {
		settings: db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?'),
		upsertSettings: db.prepare(`
			INSERT INTO ticket_settings (guild_id, max_open, config) VALUES (@guildId, @maxOpen, @config)
			ON CONFLICT(guild_id) DO UPDATE SET max_open = excluded.max_open, config = excluded.config
		`),
		categories: db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY position, id'),
		category: db.prepare('SELECT * FROM ticket_categories WHERE id = ?'),
		insertCategory: db.prepare(`
			INSERT INTO ticket_categories (guild_id, name, emoji, description, parent_channel_id, transcript_channel_id, rank_ids, role_ids, position, config, created_at)
			VALUES (@guildId, @name, @emoji, @description, @parentChannelId, @transcriptChannelId, @rankIds, @roleIds, @position, @config, @createdAt)
		`),
		updateCategory: db.prepare(`
			UPDATE ticket_categories SET name = @name, emoji = @emoji, description = @description, parent_channel_id = @parentChannelId, transcript_channel_id = @transcriptChannelId,
				rank_ids = @rankIds, role_ids = @roleIds, position = @position, config = @config WHERE id = @id
		`),
		deleteCategory: db.prepare('DELETE FROM ticket_categories WHERE id = ?'),
		panels: db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id'),
		panel: db.prepare('SELECT * FROM ticket_panels WHERE id = ?'),
		insertPanel: db.prepare(`
			INSERT INTO ticket_panels (guild_id, name, channel_id, payload, style, placeholder, category_ids, created_at)
			VALUES (@guildId, @name, @channelId, @payload, @style, @placeholder, @categoryIds, @createdAt)
		`),
		updatePanel: db.prepare(`
			UPDATE ticket_panels SET name = @name, channel_id = @channelId, message_id = @messageId, payload = @payload, style = @style,
				placeholder = @placeholder, category_ids = @categoryIds WHERE id = @id
		`),
		setPanelMessage: db.prepare('UPDATE ticket_panels SET message_id = ? WHERE id = ?'),
		deletePanel: db.prepare('DELETE FROM ticket_panels WHERE id = ?'),
		statuses: db.prepare('SELECT * FROM ticket_statuses WHERE guild_id = ? ORDER BY position'),
		clearStatuses: db.prepare('DELETE FROM ticket_statuses WHERE guild_id = ?'),
		insertStatus: db.prepare(`
			INSERT INTO ticket_statuses (guild_id, key, label, emoji, color, parent_channel_id, position)
			VALUES (@guildId, @key, @label, @emoji, @color, @parentChannelId, @position)
		`),
		nextNumber: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM tickets WHERE guild_id = ?'),
		insertTicket: db.prepare(`
			INSERT INTO tickets (guild_id, number, category_id, opener_id, opener_name, subject, answers, vars, status_history, created_at, last_activity_at)
			VALUES (@guildId, @number, @categoryId, @openerId, @openerName, @subject, @answers, @vars, @history, @createdAt, @createdAt)
		`),
		setChannel: db.prepare('UPDATE tickets SET channel_id = ? WHERE id = ?'),
		deleteTicket: db.prepare('DELETE FROM tickets WHERE id = ?'),
		ticket: db.prepare('SELECT * FROM tickets WHERE id = ?'),
		openedBy: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND opener_id = ?'),
		byChannel: db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND status = \'open\''),
		byChannelAny: db.prepare('SELECT * FROM tickets WHERE channel_id = ? ORDER BY id DESC LIMIT 1'),
		openChannels: db.prepare('SELECT channel_id FROM tickets WHERE status = \'open\' AND channel_id IS NOT NULL'),
		openOf: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = \'open\''),
		openOfCategory: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE category_id = ? AND opener_id = ? AND status = \'open\''),
		lastOfCategory: db.prepare('SELECT MAX(created_at) AS at FROM tickets WHERE category_id = ? AND opener_id = ?'),
		claim: db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?'),
		setStatus: db.prepare('UPDATE tickets SET status_key = ?, status_history = ? WHERE id = ?'),
		setPriority: db.prepare('UPDATE tickets SET priority = ? WHERE id = ?'),
		touch: db.prepare('UPDATE tickets SET last_activity_at = ?, reminded_at = NULL WHERE channel_id = ? AND status = \'open\''),
		reminded: db.prepare('UPDATE tickets SET reminded_at = ? WHERE id = ?'),
		close: db.prepare(`
			UPDATE tickets SET status = 'closed', status_key = 'closed', status_history = @history, closed_at = @at, closed_by = @by, close_reason = @reason,
				transcript = @transcript, archived = @archived,
				close_request_at = NULL, close_request_by = NULL, close_request_reason = NULL WHERE id = @id AND status = 'open'
		`),
		reopen: db.prepare(`
			UPDATE tickets SET status = 'open', status_key = @key, status_history = @history, closed_at = NULL, closed_by = NULL, close_reason = NULL,
				archived = 0, last_activity_at = @at, reminded_at = NULL WHERE id = @id AND status = 'closed' AND archived = 1
		`),
		unarchive: db.prepare('UPDATE tickets SET archived = 0 WHERE id = ? AND archived = 1'),
		rate: db.prepare('UPDATE tickets SET rating = ? WHERE id = ? AND rating IS NULL'),
		rateComment: db.prepare('UPDATE tickets SET rating_comment = ? WHERE id = ? AND rating IS NOT NULL'),
		inactive: db.prepare('SELECT * FROM tickets WHERE status = \'open\' AND last_activity_at < ?'),
		liveChannels: db.prepare('SELECT id, channel_id FROM tickets WHERE channel_id IS NOT NULL AND (status = \'open\' OR archived = 1)'),
		messages: db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid'),
		message: db.prepare('SELECT * FROM ticket_messages WHERE id = ?'),
		insertMessage: db.prepare(`
			INSERT INTO ticket_messages (id, ticket_id, author_id, author_name, author_avatar, is_bot, panel_user, content, attachments, embeds, internal, created_at)
			VALUES (@id, @ticketId, @authorId, @authorName, @authorAvatar, @isBot, @panelUser, @content, @attachments, @embeds, @internal, @createdAt)
			ON CONFLICT(id) DO UPDATE SET panel_user = COALESCE(excluded.panel_user, ticket_messages.panel_user)
		`),
		editMessage: db.prepare('UPDATE ticket_messages SET content = @content, embeds = @embeds, edited_at = @at WHERE id = @id'),
		removeMessage: db.prepare('UPDATE ticket_messages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'),
		staffRoles: db.prepare('SELECT DISTINCT role_id FROM rank_roles WHERE guild_id = ? AND rank_id = ?'),
		// Tickets v3: first response, SLA, close requests, saved replies
		firstResponse: db.prepare(`
			UPDATE tickets SET first_response_at = @at, first_responder_id = @userId
			WHERE id = @id AND status = 'open' AND first_response_at IS NULL AND opener_id != @userId
		`),
		markSla: db.prepare('UPDATE tickets SET sla_breached_at = ? WHERE id = ? AND sla_breached_at IS NULL'),
		slaPending: db.prepare('SELECT * FROM tickets WHERE status = \'open\' AND first_response_at IS NULL AND sla_breached_at IS NULL'),
		setCloseRequest: db.prepare('UPDATE tickets SET close_request_at = ?, close_request_by = ?, close_request_reason = ? WHERE id = ?'),
		clearCloseRequest: db.prepare('UPDATE tickets SET close_request_at = NULL, close_request_by = NULL, close_request_reason = NULL WHERE id = ?'),
		closeRequests: db.prepare('SELECT * FROM tickets WHERE status = \'open\' AND close_request_at IS NOT NULL'),
		replies: db.prepare('SELECT * FROM ticket_replies WHERE guild_id = ? ORDER BY name COLLATE NOCASE'),
		reply: db.prepare('SELECT * FROM ticket_replies WHERE id = ?'),
		insertReply: db.prepare(`
			INSERT INTO ticket_replies (guild_id, category_id, name, content, created_by, created_at, updated_at)
			VALUES (@guildId, @categoryId, @name, @content, @by, @at, @at)
		`),
		updateReply: db.prepare('UPDATE ticket_replies SET category_id = @categoryId, name = @name, content = @content, updated_at = @at WHERE id = @id'),
		deleteReply: db.prepare('DELETE FROM ticket_replies WHERE id = ?'),
		usedReply: db.prepare('UPDATE ticket_replies SET uses = uses + 1 WHERE id = ?'),
	};

	// Channels of open tickets: lets the message handler skip the database for every other channel
	const openChannels = new Set(q.openChannels.all().map(r => r.channel_id));
	// channelId -> ticketId of every ticket whose conversation is recorded (open or archived)
	const liveChannels = new Map(q.liveChannels.all().map(r => [r.channel_id, r.id]));
	// Panel listeners (WebSocket): { type: 'ticket' | 'message' | 'message_update' | 'message_delete', ... }
	const listeners = new Set();
	function emit(event) {
		for (const listener of listeners) {
			try {
				listener(event);
			}
			catch (error) {
				logger.warn('Ticket listener failed:', error.message);
			}
		}
	}
	// `${guildId}:${userId}:${categoryId}` -> { answers, step, at }: answers of a multi-step form in progress
	const forms = new Map();

	function toCategory(row) {
		return {
			id: row.id,
			guildId: row.guild_id,
			name: row.name,
			emoji: row.emoji,
			description: row.description,
			parentChannelId: row.parent_channel_id,
			transcriptChannelId: row.transcript_channel_id,
			rankIds: JSON.parse(row.rank_ids),
			roleIds: JSON.parse(row.role_ids),
			position: row.position,
			config: normalizeCategoryConfig(JSON.parse(row.config || '{}')),
		};
	}

	function toPanel(row) {
		return {
			id: row.id,
			guildId: row.guild_id,
			name: row.name,
			channelId: row.channel_id,
			messageId: row.message_id,
			payload: normalizePayload(JSON.parse(row.payload)),
			style: row.style,
			placeholder: row.placeholder,
			categoryIds: JSON.parse(row.category_ids),
		};
	}

	function toTicket(row, { withTranscript = false } = {}) {
		if (!row) return null;
		return {
			id: row.id,
			guildId: row.guild_id,
			number: row.number,
			categoryId: row.category_id,
			channelId: row.channel_id,
			openerId: row.opener_id,
			openerName: row.opener_name,
			subject: row.subject,
			answers: row.answers ? JSON.parse(row.answers) : [],
			vars: row.vars ? JSON.parse(row.vars) : {},
			status: row.status,
			statusKey: row.status_key,
			statusHistory: JSON.parse(row.status_history || '[]'),
			priority: row.priority,
			archived: Boolean(row.archived),
			claimedBy: row.claimed_by,
			createdAt: row.created_at,
			lastActivityAt: row.last_activity_at,
			closedAt: row.closed_at,
			closedBy: row.closed_by,
			closeReason: row.close_reason,
			rating: row.rating,
			ratingComment: row.rating_comment,
			firstResponseAt: row.first_response_at ?? null,
			firstResponderId: row.first_responder_id ?? null,
			slaBreachedAt: row.sla_breached_at ?? null,
			closeRequest: row.close_request_at ? { at: row.close_request_at, by: row.close_request_by, reason: row.close_request_reason } : null,
			...(withTranscript ? { transcript: row.transcript } : { hasTranscript: Boolean(row.transcript) }),
		};
	}

	function settingsOf(guildId) {
		const row = q.settings.get(guildId);
		return { guildId, ...normalizeGuildConfig(row ? { maxOpen: row.max_open, ...JSON.parse(row.config || '{}') } : {}) };
	}

	function statusesOf(guildId) {
		const rows = q.statuses.all(guildId);
		if (!rows.length) return BUILTIN_STATUSES.map((s, position) => ({ ...s, parentChannelId: null, position, builtin: true }));
		return rows.map(r => ({ key: r.key, label: r.label, emoji: r.emoji, color: r.color, parentChannelId: r.parent_channel_id, position: r.position, builtin: BUILTIN_KEYS.has(r.key) }));
	}

	function requireManage(actor, guildId) {
		if (!actor.can('tickets.manage')) throw new ForbiddenError('Permission manquante : tickets.manage');
		if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
	}

	function getTicket(id) {
		const ticket = toTicket(q.ticket.get(id));
		if (!ticket) throw new NotFoundError('Ticket introuvable.');
		return ticket;
	}

	// What the staff actions return (also sent as is by the panel API): never the opening variables,
	// which may hold FiveM data
	function publicTicket(id) {
		return { ...getTicket(id), vars: undefined };
	}

	function categoryOf(ticket) {
		const row = ticket.categoryId ? q.category.get(ticket.categoryId) : null;
		return row ? toCategory(row) : null;
	}

	// Staff of a category = roles linked to its ranks on that server + extra roles
	function staffRoleIds(category) {
		if (!category) return [];
		const fromRanks = category.rankIds.flatMap(rankId => q.staffRoles.all(category.guildId, rankId).map(r => r.role_id));
		return [...new Set([...fromRanks, ...category.roleIds])];
	}

	async function canHandle(userId, ticket) {
		const principal = await ranks.resolve(userId);
		if (principal.can('tickets.handle')) return principal;
		// Discord staff roles of the category also allow handling from Discord
		const category = categoryOf(ticket);
		if (category) {
			const roles = await executor.getMemberRoleIds(ticket.guildId, userId);
			if (roles?.some(r => staffRoleIds(category).includes(r))) return principal;
		}
		return null;
	}

	async function requireHandle(userId, ticket, message = 'Seul le staff peut faire ça.') {
		if (!await canHandle(userId, ticket)) throw new ForbiddenError(message);
	}

	function record(actorId, source, action, ticket, details = {}) {
		audit.record({ actorId, source, action, guildId: ticket.guildId, target: String(ticket.id), details: { number: ticket.number, opener: ticket.openerName, ...details } });
		emit({ type: 'ticket', ticket: getTicket(ticket.id), action });
	}

	function toMessage(row) {
		return {
			id: row.id,
			ticketId: row.ticket_id,
			authorId: row.author_id,
			authorName: row.author_name,
			authorAvatar: row.author_avatar,
			bot: Boolean(row.is_bot),
			panelUser: row.panel_user,
			content: row.content,
			attachments: JSON.parse(row.attachments),
			embeds: JSON.parse(row.embeds),
			internal: Boolean(row.internal),
			createdAt: row.created_at,
			editedAt: row.edited_at,
			deletedAt: row.deleted_at,
		};
	}

	function insertMessage(ticketId, message) {
		q.insertMessage.run({
			id: message.id,
			ticketId,
			authorId: message.authorId ?? null,
			authorName: message.authorName ?? null,
			authorAvatar: message.authorAvatar ?? null,
			isBot: message.bot ? 1 : 0,
			panelUser: message.panelUser ?? null,
			content: message.content?.slice(0, 4000) ?? '',
			attachments: JSON.stringify((message.attachments ?? []).slice(0, 10)),
			embeds: JSON.stringify((message.embeds ?? []).slice(0, 10)),
			internal: message.internal ? 1 : 0,
			createdAt: message.createdAt ?? now(),
		});
		const saved = toMessage(q.message.get(message.id));
		emit({ type: 'message', guildId: getTicket(ticketId).guildId, message: saved });
		return saved;
	}

	// Variables known when a ticket opens: member, server, form answers, linked FiveM account.
	// Nothing here may block the opening: the shared variables have fallbacks and FiveM a time limit.
	// Only the FiveM data the texts of the type use is read and kept (no phone or license stored for nothing).
	async function ticketVars({ guildId, userId, userName, answers, category }) {
		const used = new Set(fivemKeysIn(category?.config.nameTemplate, category?.config.welcome));
		const shared = await variables.member(guildId, userId, { fivem: used.size > 0 }).catch((error) => {
			logger.warn('Ticket variables:', error.message);
			return {};
		});
		return {
			...Object.fromEntries(Object.entries(shared).filter(([key]) => !key.startsWith('fivem.') || used.has(key))),
			// The name Discord gave with the interaction is the freshest
			'user.name': userName || shared['user.name'] || userId,
			'tickets.count': q.openedBy.get(guildId, userId).n,
			...Object.fromEntries(answers.map(a => [`answer.${a.id}`, a.value])),
		};
	}

	function transcriptPath(ticketId) {
		return dataDir ? path.join(dataDir, 'transcripts', `ticket-${Number(ticketId)}.html`) : null;
	}

	// Staff page (with the internal notes of the panel, kept on disk for the panel) and member page
	async function transcriptPages(ticket, category, history, { closerId, reason, closedAt }) {
		await inlineImages(history.messages, { fetchImpl, maxTotal: TRANSCRIPT_IMAGES_MAX });
		const nameOf = async id => (id ? (await executor.getUser(id).catch(() => null)) : null);
		const [guild, claimer, closer] = await Promise.all([executor.getGuildInfo(ticket.guildId).catch(() => null), nameOf(ticket.claimedBy), nameOf(closerId)]);
		const display = user => user?.globalName ?? user?.username ?? null;
		const notes = service.messages(ticket.id).filter(m => m.internal);
		const base = {
			guild: { name: guild?.name ?? '', icon: guild?.iconUrl ?? null },
			ticket, category, status: 'Fermé', opener: ticket.openerName,
			claimer: display(claimer) ?? (ticket.claimedBy ? ticket.claimedBy : null),
			closer: closerId ? display(closer) ?? closerId : 'le bot',
			closedAt, reason, messages: history.messages, mentions: history.mentions ?? {}, notes,
		};
		const pages = { staff: renderTicketTranscript({ ...base, audience: 'staff' }), member: renderTicketTranscript({ ...base, audience: 'member' }) };
		const file = transcriptPath(ticket.id);
		if (file) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, pages.staff);
		}
		return pages;
	}

	function statusOf(guildId, key) {
		return statusesOf(guildId).find(s => s.key === key) ?? BUILTIN_STATUSES.find(s => s.key === key) ?? { key, label: key, emoji: null };
	}

	function parentFor(category, guildId, key) {
		return category?.config.statusParents[key]
			?? statusesOf(guildId).find(s => s.key === key)?.parentChannelId
			?? (key === 'closed' ? null : category?.parentChannelId ?? null);
	}

	function channelName(category, ticket, statusKey = ticket.statusKey) {
		const status = statusOf(ticket.guildId, statusKey);
		const base = slugName(fill(category?.config.nameTemplate ?? 'ticket-{number}-{user}', {
			...ticket.vars,
			number: String(ticket.number).padStart(4, '0'),
			user: ticket.openerName ?? ticket.openerId,
			type: category?.name ?? 'ticket',
			status: status.label,
			claimer: ticket.claimedBy ?? '',
		}));
		// Server emojis (<:name:id>) cannot go in a channel name
		return settingsOf(ticket.guildId).statusPrefix && status.emoji && !status.emoji.startsWith('<') ? `${status.emoji}┃${base}`.slice(0, 100) : base;
	}

	// Moves / renames the channel after a status change; Discord rate limits renames, never wait for it
	function applyChannelState(category, ticket, statusKey) {
		if (!ticket.channelId) return;
		const parentId = parentFor(category, ticket.guildId, statusKey);
		executor.updateTicketChannel(ticket.channelId, { name: channelName(category, ticket, statusKey), parentId: parentId ?? undefined })
			.catch(error => logger.warn(`Ticket #${ticket.number}: channel not updated:`, error.message));
	}

	function pushHistory(ticket, key, by) {
		return JSON.stringify([...ticket.statusHistory, { key, by, at: now() }].slice(-50));
	}

	function validateCategory(input) {
		if (!input.name?.trim() || input.name.length > 50) throw new ValidationError('Le nom fait 1 à 50 caractères.');
		if (input.description && input.description.length > 100) throw new ValidationError('La description fait 100 caractères maximum.');
		if (input.emoji && input.emoji.length > 64) throw new ValidationError('Émoji invalide.');
	}

	function categoriesOfPanel(panel) {
		const all = q.categories.all(panel.guildId).map(toCategory);
		if (!panel.categoryIds.length) return all;
		return panel.categoryIds.map(id => all.find(c => c.id === id)).filter(Boolean);
	}

	// Everything that can stop someone from opening a ticket of this type, before showing the form
	async function checkAccess(guildId, userId, category) {
		const { access } = category.config;
		if (!isWithinHours(access.hours, now())) throw new ValidationError(access.hours.closedMessage);
		if (access.minAccountAgeDays && now() - accountCreatedAt(userId) < access.minAccountAgeDays * 86_400_000) {
			throw new ValidationError(`Ton compte Discord doit avoir au moins ${access.minAccountAgeDays} jour(s) pour ouvrir ce type de ticket.`);
		}
		if (access.requiredRoleIds.length || access.blockedRoleIds.length) {
			const roles = await executor.getMemberRoleIds(guildId, userId) ?? [];
			if (access.blockedRoleIds.some(r => roles.includes(r))) throw new ValidationError('Tu ne peux pas ouvrir ce type de ticket.');
			const has = access.requiredMode === 'all'
				? access.requiredRoleIds.every(r => roles.includes(r))
				: access.requiredRoleIds.some(r => roles.includes(r));
			if (access.requiredRoleIds.length && !has) throw new ValidationError('Il te manque un rôle pour ouvrir ce type de ticket.');
		}
		checkLimits(guildId, userId, category);
	}

	// Open tickets and delay: synchronous, so it can run again right before the insert (double click on the panel)
	function checkLimits(guildId, userId, category) {
		const { access } = category.config;
		const { maxOpen } = settingsOf(guildId);
		if (q.openOf.get(guildId, userId).n >= maxOpen) {
			throw new ValidationError(maxOpen === 1 ? 'Tu as déjà un ticket ouvert.' : `Tu as déjà ${maxOpen} tickets ouverts.`);
		}
		if (access.maxOpen && q.openOfCategory.get(category.id, userId).n >= access.maxOpen) {
			throw new ValidationError(`Tu as déjà ${access.maxOpen} ticket(s) ouvert(s) de ce type.`);
		}
		if (access.cooldownMinutes) {
			const last = q.lastOfCategory.get(category.id, userId).at;
			const wait = last ? last + access.cooldownMinutes * 60_000 - now() : 0;
			if (wait > 0) throw new ValidationError(`Attends encore ${Math.ceil(wait / 60_000)} minute(s) avant d’ouvrir un nouveau ticket de ce type.`);
		}
	}

	function findCategory(guildId, categoryId) {
		const row = q.category.get(categoryId);
		if (!row || row.guild_id !== guildId) throw new NotFoundError('Ce type de ticket n’existe plus.');
		return toCategory(row);
	}

	function formKey(guildId, userId, categoryId) {
		return `${guildId}:${userId}:${categoryId}`;
	}

	function pruneForms() {
		for (const [key, value] of forms) if (now() - value.at > FORM_TTL_MS) forms.delete(key);
	}

	// First answer of someone else than the opener (Discord message or panel reply): response time and SLA
	function markFirstResponse(ticketId, userId, at = now()) {
		if (!userId || !q.firstResponse.run({ id: ticketId, userId, at }).changes) return;
		const ticket = getTicket(ticketId);
		const minutes = categoryOf(ticket)?.config.sla.firstResponseMinutes ?? 0;
		// Answered late: counted as a breach, no alert any more (someone is on it)
		if (minutes && at - ticket.createdAt > minutes * 60_000) q.markSla.run(at, ticketId);
		emit({ type: 'ticket', ticket: getTicket(ticketId), action: 'tickets.first_response' });
	}

	function closeRequestHours(ticket) {
		return (categoryOf(ticket)?.config ?? normalizeCategoryConfig()).closeRequest.autoCloseHours;
	}

	function toReply(row) {
		return {
			id: row.id,
			guildId: row.guild_id,
			categoryId: row.category_id,
			name: row.name,
			content: row.content,
			uses: row.uses,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// Saved replies usable in a ticket: those of every type and those of its own type
	function repliesFor(ticket) {
		return q.replies.all(ticket.guildId).map(toReply).filter(r => r.categoryId === null || r.categoryId === ticket.categoryId);
	}

	function findReplyFor(ticket, replyId) {
		const reply = repliesFor(ticket).find(r => r.id === Number(replyId));
		if (!reply) throw new NotFoundError('Réponse enregistrée introuvable pour ce ticket.');
		return reply;
	}

	function requireReplies(actor, guildId) {
		if (!actor.can('tickets.replies')) throw new ForbiddenError('Permission manquante : tickets.replies');
		if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
	}

	// Fills a saved reply: shared variables (member, server), ticket ones, staff ones.
	// {fivem.*}: only the keys in `fivemKeys` (those of the saved reply, checked when it was saved)
	async function renderReply(ticket, text, staffId, fivemKeys) {
		const allowed = new Set(fivemKeys);
		const keep = vars => Object.fromEntries(Object.entries(vars).filter(([key]) => !key.startsWith('fivem.') || allowed.has(key)));
		const [shared, staff] = await Promise.all([
			variables.member(ticket.guildId, ticket.openerId, { fivem: allowed.size > 0 }).catch((error) => {
				logger.warn('Saved reply variables:', error.message);
				return {};
			}),
			executor.getUser(staffId).catch(() => null),
		]);
		const category = categoryOf(ticket);
		return fill(text, {
			...keep(ticket.vars),
			...keep(shared),
			number: ticket.number,
			type: category?.name ?? 'Ticket',
			subject: ticket.subject ?? 'aucun',
			status: statusOf(ticket.guildId, ticket.statusKey).label,
			claimer: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'personne',
			'staff': `<@${staffId}>`,
			'staff.name': staff?.globalName ?? staff?.username ?? staffId,
		}).trim().slice(0, 2000);
	}

	const service = {
		settings: settingsOf,
		statuses: statusesOf,
		priorities: () => PRIORITIES.map(key => ({ key, label: PRIORITY_LABELS[key] })),

		describe(guildId, actor = null) {
			return {
				settings: settingsOf(guildId),
				categories: q.categories.all(guildId).map(toCategory),
				panels: q.panels.all(guildId).map(toPanel),
				statuses: statusesOf(guildId),
				variables: [{ title: 'Ticket', items: TICKET_VARIABLES }, ...variables.catalog('member', actor)],
				replies: q.replies.all(guildId).map(toReply),
				replyVariables: [{ title: 'Ticket', items: TICKET_VARIABLES }, { title: 'Staff', items: STAFF_VARIABLES }, ...variables.catalog('member', actor)],
			};
		},

		getCategory(guildId, categoryId) {
			return findCategory(guildId, categoryId);
		},

		saveSettings(actor, guildId, input = {}) {
			requireManage(actor, guildId);
			const current = settingsOf(guildId);
			if (input.maxOpen !== undefined && (!Number.isInteger(input.maxOpen) || input.maxOpen < 1 || input.maxOpen > 20)) {
				throw new ValidationError('Entre 1 et 20 tickets ouverts par personne.');
			}
			const next = normalizeGuildConfig({ ...current, ...input });
			q.upsertSettings.run({ guildId, maxOpen: next.maxOpen, config: JSON.stringify(next) });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.settings', guildId, target: guildId });
			return settingsOf(guildId);
		},

		saveStatuses(actor, guildId, input) {
			requireManage(actor, guildId);
			const statuses = normalizeStatuses(input);
			db.transaction(() => {
				q.clearStatuses.run(guildId);
				for (const s of statuses) q.insertStatus.run({ guildId, ...s });
			})();
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.statuses', guildId, target: guildId, details: { count: statuses.length } });
			return statusesOf(guildId);
		},

		async saveCategory(actor, guildId, input) {
			requireManage(actor, guildId);
			validateCategory(input);
			const before = input.id ? q.category.get(input.id) : null;
			assertFivemAllowed(actor, input.config, before?.config ?? null);
			if (input.transcriptChannelId && !await executor.getTextChannel(guildId, input.transcriptChannelId)) {
				throw new ValidationError('Le salon des transcripts n’existe pas sur ce serveur, ou le bot ne peut pas y écrire.');
			}
			let id = input.id;
			const existing = id ? q.category.get(id) : null;
			if (id && (!existing || existing.guild_id !== guildId)) throw new NotFoundError('Type de ticket introuvable.');
			const config = normalizeCategoryConfig(input.config ?? (existing ? JSON.parse(existing.config || '{}') : {}));
			const values = {
				guildId,
				name: input.name.trim(),
				emoji: input.emoji?.trim() || null,
				description: input.description?.trim() || null,
				parentChannelId: input.parentChannelId || null,
				transcriptChannelId: input.transcriptChannelId || null,
				rankIds: JSON.stringify((input.rankIds ?? []).map(Number).filter(Number.isInteger)),
				roleIds: JSON.stringify((input.roleIds ?? []).filter(r => SNOWFLAKE.test(r))),
				position: Number.isInteger(input.position) ? input.position : 0,
				config: JSON.stringify(config),
			};
			if (id) q.updateCategory.run({ ...values, id });
			else id = Number(q.insertCategory.run({ ...values, createdAt: now() }).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.category', guildId, target: String(id), details: { name: values.name } });
			return toCategory(q.category.get(id));
		},

		// The whole ticket system of a server copied to another: settings, statuses, types, panels.
		// Channels and Discord roles belong to one server: they are left empty, to choose again.
		async copySystem(actor, fromGuildId, toGuildId) {
			requireManage(actor, fromGuildId);
			requireManage(actor, toGuildId);
			if (fromGuildId === toGuildId) throw new ValidationError('Choisis un autre serveur que celui-ci.');
			const copy = { ...actor, source: actor.source ?? 'panel' };
			service.saveSettings(copy, toGuildId, settingsOf(fromGuildId));
			const statuses = service.saveStatuses(copy, toGuildId, statusesOf(fromGuildId).map(s => ({ ...s, parentChannelId: null })));
			const ids = new Map();
			for (const row of q.categories.all(fromGuildId)) {
				const c = toCategory(row);
				const created = await service.saveCategory(copy, toGuildId, {
					name: c.name, emoji: c.emoji, description: c.description, rankIds: c.rankIds, roleIds: [], position: c.position,
					config: {
						...c.config,
						statusParents: {},
						pingRoleIds: [],
						ping: c.config.ping === 'roles' ? 'staff' : c.config.ping,
						access: { ...c.config.access, requiredRoleIds: [], blockedRoleIds: [] },
					},
				});
				ids.set(c.id, created.id);
			}
			// Saved replies too, for whoever may manage them (a name already taken there is kept as it is)
			if (actor.can('tickets.replies')) {
				for (const r of service.replies(fromGuildId)) {
					try {
						service.saveReply(copy, toGuildId, { name: r.name, content: r.content, categoryId: r.categoryId === null ? null : ids.get(r.categoryId) ?? null });
					}
					catch (error) {
						if (!(error instanceof ValidationError || error instanceof ForbiddenError)) throw error;
					}
				}
			}
			let panels = 0;
			for (const row of q.panels.all(fromGuildId)) {
				const p = toPanel(row);
				await service.savePanel(copy, toGuildId, { name: p.name, payload: p.payload, style: p.style, placeholder: p.placeholder, categoryIds: p.categoryIds.map(id => ids.get(id)).filter(Boolean), channelId: null });
				panels++;
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.copy', guildId: toGuildId, target: toGuildId, details: { depuis: network.find(fromGuildId)?.name ?? fromGuildId, types: ids.size, panneaux: panels } });
			return { categories: ids.size, panels, statuses: statuses.length };
		},

		deleteCategory(actor, guildId, id) {
			requireManage(actor, guildId);
			const existing = q.category.get(id);
			if (!existing || existing.guild_id !== guildId) throw new NotFoundError('Type de ticket introuvable.');
			q.deleteCategory.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.category_delete', guildId, target: String(id), details: { name: existing.name } });
		},

		async savePanel(actor, guildId, input) {
			requireManage(actor, guildId);
			const name = input.name?.trim();
			if (!name || name.length > 50) throw new ValidationError('Le nom du panneau fait 1 à 50 caractères.');
			if (input.channelId && !await executor.getTextChannel(guildId, input.channelId)) {
				throw new ValidationError('Ce salon n’existe pas sur ce serveur, ou le bot ne peut pas y écrire.');
			}
			const known = new Set(q.categories.all(guildId).map(c => c.id));
			const categoryIds = (input.categoryIds ?? []).filter(id => known.has(id));
			const existing = input.id ? q.panel.get(input.id) : null;
			if (input.id && (!existing || existing.guild_id !== guildId)) throw new NotFoundError('Panneau introuvable.');
			const values = {
				guildId,
				name,
				channelId: input.channelId || null,
				payload: JSON.stringify(normalizePayload(input.payload ?? DEFAULT_PANEL_PAYLOAD)),
				style: input.style === 'select' ? 'select' : 'buttons',
				placeholder: input.placeholder?.slice(0, 150) || null,
				categoryIds: JSON.stringify(categoryIds),
			};
			let id = input.id;
			if (existing) {
				// Another channel: the old message stays where it is, a new one will be posted
				const messageId = existing.channel_id === values.channelId ? existing.message_id : null;
				q.updatePanel.run({ ...values, id, messageId });
			}
			else {
				id = Number(q.insertPanel.run({ ...values, createdAt: now() }).lastInsertRowid);
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.panel_save', guildId, target: String(id), details: { name } });
			return toPanel(q.panel.get(id));
		},

		async deletePanel(actor, guildId, id) {
			requireManage(actor, guildId);
			const row = q.panel.get(id);
			if (!row || row.guild_id !== guildId) throw new NotFoundError('Panneau introuvable.');
			if (row.channel_id && row.message_id) await executor.deleteMessage(row.channel_id, row.message_id).catch(() => null);
			q.deletePanel.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.panel_delete', guildId, target: String(id), details: { name: row.name } });
		},

		// Posts (or updates) the message with one button (or one menu entry) per ticket type
		async publishPanel(actor, guildId, panelId) {
			requireManage(actor, guildId);
			const row = q.panel.get(panelId);
			if (!row || row.guild_id !== guildId) throw new NotFoundError('Panneau introuvable.');
			const panel = toPanel(row);
			const categories = categoriesOfPanel(panel);
			if (!panel.channelId) throw new ValidationError('Choisis d’abord le salon du panneau.');
			if (!categories.length) throw new ValidationError('Crée d’abord au moins un type de ticket.');
			const messageId = await executor.publishTicketPanel(panel.channelId, panel.messageId, { ...panel, categories });
			q.setPanelMessage.run(messageId, panel.id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.panel', guildId, target: panel.channelId, details: { name: panel.name } });
			return toPanel(q.panel.get(panel.id));
		},

		// Step 1 of opening: checks, then tells the bot which modal to show first (step -1: no form)
		async startOpening({ guildId, userId, categoryId }) {
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Les tickets ne sont pas disponibles sur ce serveur.');
			const category = findCategory(guildId, categoryId);
			await checkAccess(guildId, userId, category);
			pruneForms();
			const step = nextStep(category.config.form, 0, []);
			if (step >= 0) forms.set(formKey(guildId, userId, categoryId), { answers: [], step, at: now() });
			return { category, step, total: category.config.form.steps.length };
		},

		// One modal submitted: { done: false, next, total } or { done: true, answers }
		submitFormStep({ guildId, userId, categoryId, step, values }) {
			const category = findCategory(guildId, categoryId);
			const { form } = category.config;
			const key = formKey(guildId, userId, categoryId);
			const state = forms.get(key);
			if (!state || state.step !== step || now() - state.at > FORM_TTL_MS) throw new ValidationError('Ce formulaire a expiré : recommence depuis le panneau.');
			state.answers.push(...readStep(form.steps[step], values));
			state.at = now();
			const next = nextStep(form, step + 1, state.answers);
			if (next >= 0) {
				state.step = next;
				return { done: false, next, total: form.steps.length };
			}
			forms.delete(key);
			return { done: true, answers: state.answers.map(({ id, label, type, value }) => ({ id, label, type, value })) };
		},

		async open({ guildId, userId, userName, categoryId, subject, answers = [] }) {
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Les tickets ne sont pas disponibles sur ce serveur.');
			const category = findCategory(guildId, categoryId);
			await checkAccess(guildId, userId, category);

			const cleanAnswers = answers.filter(a => a.value).slice(0, 25).map(a => ({ id: a.id, label: a.label.slice(0, 45), type: a.type ?? 'paragraph', value: a.value.slice(0, 4000) }));
			const vars = await ticketVars({ guildId, userId, userName, answers: cleanAnswers, category });
			// Another opening of the same member may have finished meanwhile: no await between this check and the insert
			checkLimits(guildId, userId, category);
			const number = q.nextNumber.get(guildId).n;
			const id = Number(q.insertTicket.run({
				guildId,
				number,
				categoryId,
				openerId: userId,
				openerName: userName,
				// First written answer, else the first one (a choice)
				subject: (subject ?? (cleanAnswers.find(a => a.type === 'short' || a.type === 'paragraph') ?? cleanAnswers[0])?.value)?.slice(0, 200) || null,
				answers: cleanAnswers.length ? JSON.stringify(cleanAnswers) : null,
				vars: JSON.stringify(vars),
				history: JSON.stringify([{ key: 'open', by: userId, at: now() }]),
				createdAt: now(),
			}).lastInsertRowid);
			const draft = getTicket(id);
			const staff = staffRoleIds(category);
			let channelId;
			try {
				channelId = await executor.createTicketChannel({
					guildId,
					parentId: parentFor(category, guildId, 'open'),
					name: channelName(category, draft, 'open'),
					openerId: userId,
					staffRoleIds: staff,
				});
			}
			catch (error) {
				q.deleteTicket.run(id);
				logger.warn(`Unable to create ticket channel on ${guildId}:`, error.message);
				throw new ValidationError('Impossible de créer le salon du ticket : vérifie les permissions du bot (Gérer les salons).');
			}
			q.setChannel.run(channelId, id);
			openChannels.add(channelId);
			liveChannels.set(channelId, id);
			const ticket = getTicket(id);
			await executor.sendTicketWelcome(channelId, service.welcomeData(ticket, category)).catch(error => logger.warn('Ticket welcome failed:', error.message));
			record(userId, 'bot', 'tickets.open', ticket, { category: category.name, subject: ticket.subject, channel: `<#${channelId}>` });
			return ticket;
		},

		// What the welcome message of a ticket shows (texts filled, pings, statuses for the menu)
		welcomeData(ticket, category = categoryOf(ticket)) {
			const config = category?.config ?? normalizeCategoryConfig();
			const vars = {
				...ticket.vars,
				user: `<@${ticket.openerId}>`,
				'user.name': ticket.vars['user.name'] ?? ticket.openerName,
				number: ticket.number,
				type: category?.name ?? 'Ticket',
				subject: ticket.subject ?? 'aucun',
				status: statusOf(ticket.guildId, ticket.statusKey).label,
				claimer: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'personne',
			};
			const staff = staffRoleIds(category);
			const pingRoleIds = config.ping === 'staff' ? staff : config.ping === 'roles' ? config.pingRoleIds : [];
			return {
				ticket,
				category,
				title: fill(config.welcome.title, vars).slice(0, 256),
				message: fill(config.welcome.message, vars).slice(0, 4000),
				color: config.welcome.color,
				answers: config.welcome.showAnswers ? ticket.answers : [],
				pingRoleIds,
				statuses: statusesOf(ticket.guildId).filter(s => s.key !== 'closed'),
				priorities: service.priorities(),
				closeNeedsModal: config.close.requireReason || config.close.confirm,
			};
		},

		async claim(userId, ticketId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			await requireHandle(userId, ticket, 'Seul le staff peut prendre un ticket en charge.');
			const category = categoryOf(ticket);
			q.claim.run(userId, ticketId);
			if (ticket.statusKey === 'open') {
				q.setStatus.run('claimed', pushHistory(ticket, 'claimed', userId), ticketId);
				applyChannelState(category, getTicket(ticketId), 'claimed');
			}
			if (category?.config.claim.exclusiveWrite && ticket.channelId) {
				await executor.setTicketWriters(ticket.channelId, { claimerId: userId, previousClaimerId: ticket.claimedBy, staffRoleIds: staffRoleIds(category) })
					.catch(error => logger.warn('Ticket writers not updated:', error.message));
			}
			record(userId, source, 'tickets.claim', ticket);
			return publicTicket(ticketId);
		},

		async transfer(userId, ticketId, toUserId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			await requireHandle(userId, ticket, 'Seul le staff peut transférer un ticket.');
			if (!await canHandle(toUserId, ticket)) throw new ValidationError('Cette personne ne fait pas partie du staff de ce ticket.');
			const category = categoryOf(ticket);
			q.claim.run(toUserId, ticketId);
			if (ticket.statusKey === 'open') q.setStatus.run('claimed', pushHistory(ticket, 'claimed', userId), ticketId);
			if (ticket.channelId) {
				if (category?.config.claim.exclusiveWrite) {
					await executor.setTicketWriters(ticket.channelId, { claimerId: toUserId, previousClaimerId: ticket.claimedBy, staffRoleIds: staffRoleIds(category) })
						.catch(error => logger.warn('Ticket writers not updated:', error.message));
				}
				else {
					await executor.addChannelMember(ticket.channelId, toUserId).catch(() => null);
				}
			}
			record(userId, source, 'tickets.transfer', ticket, { to: `<@${toUserId}>` });
			return publicTicket(ticketId);
		},

		async setStatus(userId, ticketId, key, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			await requireHandle(userId, ticket, 'Seul le staff peut changer le statut.');
			if (key === 'closed') throw new ValidationError('Pour fermer un ticket, utilise « Fermer ».');
			const status = statusesOf(ticket.guildId).find(s => s.key === key);
			if (!status) throw new ValidationError('Statut inconnu.');
			if (ticket.statusKey === key) return publicTicket(ticketId);
			q.setStatus.run(key, pushHistory(ticket, key, userId), ticketId);
			applyChannelState(categoryOf(ticket), ticket, key);
			record(userId, source, 'tickets.status', ticket, { status: status.label });
			return publicTicket(ticketId);
		},

		async setPriority(userId, ticketId, priority, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (!PRIORITIES.includes(priority)) throw new ValidationError('Priorité inconnue.');
			await requireHandle(userId, ticket, 'Seul le staff peut changer la priorité.');
			q.setPriority.run(priority, ticketId);
			record(userId, source, 'tickets.priority', ticket, { priority: PRIORITY_LABELS[priority] });
			return publicTicket(ticketId);
		},

		async rename(userId, ticketId, name, source = 'bot') {
			const ticket = getTicket(ticketId);
			await requireHandle(userId, ticket, 'Seul le staff peut renommer un ticket.');
			const clean = slugName(name);
			await executor.updateTicketChannel(ticket.channelId, { name: clean });
			record(userId, source, 'tickets.rename', ticket, { name: clean });
			return clean;
		},

		async addMember(userId, ticketId, memberId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			await requireHandle(userId, ticket, 'Seul le staff peut ajouter quelqu’un au ticket.');
			await executor.addChannelMember(ticket.channelId, memberId);
			record(userId, source, 'tickets.add_member', ticket, { member: `<@${memberId}>` });
		},

		async removeMember(userId, ticketId, memberId, source = 'bot') {
			const ticket = getTicket(ticketId);
			await requireHandle(userId, ticket, 'Seul le staff peut retirer quelqu’un du ticket.');
			if (memberId === ticket.openerId) throw new ValidationError('On ne retire pas la personne qui a ouvert le ticket : ferme-le plutôt.');
			await executor.removeChannelMember(ticket.channelId, memberId);
			record(userId, source, 'tickets.remove_member', ticket, { member: `<@${memberId}>` });
		},

		// Can this user close it, and must they give a reason? (the bot shows a modal or not)
		async closeRequirements(userId, ticketId) {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est déjà fermé.');
			const category = categoryOf(ticket);
			const config = category?.config ?? normalizeCategoryConfig();
			const staff = await canHandle(userId, ticket);
			if (!staff && !(userId === ticket.openerId && config.close.openerCanClose)) {
				throw new ForbiddenError(config.close.openerCanClose ? 'Seuls la personne qui a ouvert le ticket et le staff peuvent le fermer.' : 'Seul le staff peut fermer ce ticket.');
			}
			return { requireReason: config.close.requireReason, confirm: config.close.confirm };
		},

		// The transcript is saved, logged and sent to the opener; the channel is deleted or archived
		// accepted: the opener said yes to a close request of the staff (allowed even if members cannot close)
		async close(userId, ticketId, reason = '', source = 'bot', { accepted = false } = {}) {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est déjà fermé.');
			const category = categoryOf(ticket);
			const config = category?.config ?? normalizeCategoryConfig();
			const system = userId === 'system';
			if (!system && !accepted) {
				const staff = await canHandle(userId, ticket);
				if (!staff && !(userId === ticket.openerId && config.close.openerCanClose)) {
					throw new ForbiddenError(config.close.openerCanClose ? 'Seuls la personne qui a ouvert le ticket et le staff peuvent le fermer.' : 'Seul le staff peut fermer ce ticket.');
				}
				if (config.close.requireReason && !reason.trim()) throw new ValidationError('Une raison est obligatoire pour fermer ce ticket.');
			}

			const history = ticket.channelId ? await executor.fetchChannelHistory(ticket.channelId, { limit: 2000 }).catch((error) => {
				logger.warn(`Transcript of ticket #${ticket.number} not read:`, error.message);
				return null;
			}) : null;
			const transcript = history ? transcriptText(history.messages, history.mentions) : null;
			const header = [
				`Ticket #${ticket.number} — ${ticket.subject ?? 'sans sujet'}`,
				`Ouvert par ${ticket.openerName} (${ticket.openerId}) le ${new Date(ticket.createdAt).toLocaleString('fr-FR')}`,
				`Fermé par ${system ? 'le bot' : userId} le ${new Date(now()).toLocaleString('fr-FR')}${reason ? ` : ${reason}` : ''}`,
				...(ticket.answers.length ? ['', 'Formulaire :', ...ticket.answers.map(a => `- ${a.label} : ${a.value}`)] : []),
				'',
			].join('\n');
			const text = `${header}${transcript ?? '(transcript indisponible)'}`;
			const archive = config.close.mode === 'archive';
			const changed = q.close.run({ history: pushHistory(ticket, 'closed', userId), at: now(), by: userId, reason: reason || null, transcript: text, archived: archive ? 1 : 0, id: ticketId }).changes;
			if (!changed) throw new ValidationError('Ce ticket est déjà fermé.');
			openChannels.delete(ticket.channelId);

			const closedAt = now();
			const pages = history ? await transcriptPages(getTicket(ticketId), category, history, { closerId: system ? null : userId, reason, closedAt }).catch((error) => {
				logger.warn(`HTML transcript of ticket #${ticket.number} failed:`, error.message);
				return null;
			}) : null;
			const fileName = `ticket-${String(ticket.number).padStart(4, '0')}`;
			// Internal notes stay in the panel (staff page on disk): what goes to Discord never has them
			const file = pages ? { name: `${fileName}.html`, content: pages.member } : { name: `ticket-${ticket.number}.txt`, content: text };
			const memberFile = file;
			const summary = {
				title: `Ticket #${ticket.number} fermé`,
				description: `Ouvert par <@${ticket.openerId}> · fermé par ${system ? 'le bot' : `<@${userId}>`}`,
				fields: [
					...(category ? [{ name: 'Catégorie', value: category.name, inline: true }] : []),
					...(ticket.subject ? [{ name: 'Sujet', value: ticket.subject }] : []),
					...(reason ? [{ name: 'Raison', value: reason }] : []),
				],
				files: [file],
			};
			// The category's own transcript channel, unless it is already the "tickets" log channel
			const transcriptChannelId = category?.transcriptChannelId;
			const logChannelId = logs.routes(ticket.guildId).find(r => r.category === 'tickets' && r.enabled)?.channelId;
			if (transcriptChannelId && transcriptChannelId !== logChannelId) {
				executor.sendLog(transcriptChannelId, summary).catch(error => logger.warn(`Transcript of ticket #${ticket.number} not sent:`, error.message));
			}
			logs.log(ticket.guildId, 'tickets', summary);
			if (config.transcriptDm) {
				executor.sendDM(ticket.openerId, `Ton ticket #${ticket.number} a été fermé${reason ? ` : ${reason}` : ''}. Voici la conversation : ouvre le fichier dans ton navigateur.`, [memberFile]).catch(() => null);
			}
			if (config.rating.enabled) executor.sendTicketRating(ticket.openerId, getTicket(ticketId)).catch(() => null);
			record(userId, source, 'tickets.close', ticket, { reason: reason || null });

			if (ticket.channelId) {
				if (archive) {
					applyChannelState(category, ticket, 'closed');
					await executor.removeChannelMember(ticket.channelId, ticket.openerId).catch(() => null);
					await executor.sendTicketNotice(ticket.channelId, { kind: 'archived', ticket: getTicket(ticketId), reason }).catch(() => null);
				}
				else {
					liveChannels.delete(ticket.channelId);
					const timer = setTimeout(() => executor.deleteChannel(ticket.channelId, `Ticket #${ticket.number} fermé`).catch(() => null), config.close.deleteDelaySeconds * 1000);
					timer.unref?.();
				}
			}
			return publicTicket(ticketId);
		},

		async reopen(userId, ticketId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'closed' || !ticket.archived) throw new ValidationError('Seul un ticket archivé peut être rouvert.');
			await requireHandle(userId, ticket, 'Seul le staff peut rouvrir un ticket.');
			const key = ticket.claimedBy ? 'claimed' : 'open';
			// Two clicks on "Rouvrir": only the first one reopens
			if (!q.reopen.run({ key, history: pushHistory(ticket, key, userId), at: now(), id: ticketId }).changes) throw new ValidationError('Ce ticket est déjà rouvert.');
			openChannels.add(ticket.channelId);
			liveChannels.set(ticket.channelId, ticket.id);
			await executor.addChannelMember(ticket.channelId, ticket.openerId).catch(() => null);
			applyChannelState(categoryOf(ticket), ticket, key);
			await executor.sendTicketNotice(ticket.channelId, { kind: 'reopened', ticket: getTicket(ticketId), by: userId }).catch(() => null);
			record(userId, source, 'tickets.reopen', ticket);
			return publicTicket(ticketId);
		},

		// Deletes the channel of an archived ticket
		async deleteArchived(userId, ticketId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (!ticket.archived) throw new ValidationError('Ce ticket n’est pas archivé.');
			await requireHandle(userId, ticket, 'Seul le staff peut supprimer un ticket.');
			if (!q.unarchive.run(ticketId).changes) throw new ValidationError('Ce ticket n’est pas archivé.');
			liveChannels.delete(ticket.channelId);
			await executor.deleteChannel(ticket.channelId, `Ticket #${ticket.number} supprimé`).catch(() => null);
			record(userId, source, 'tickets.delete', ticket);
		},

		rate(userId, ticketId, rating) {
			const ticket = getTicket(ticketId);
			if (ticket.openerId !== userId) throw new ForbiddenError('Seule la personne qui a ouvert le ticket peut le noter.');
			if (ticket.status !== 'closed') throw new ValidationError('Ce ticket n’est pas fermé.');
			if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ValidationError('Note entre 1 et 5.');
			if (!q.rate.run(rating, ticketId).changes) throw new ValidationError('Tu as déjà noté ce ticket.');
			record(userId, 'bot', 'tickets.rating', ticket, { rating: '★'.repeat(rating) + '☆'.repeat(5 - rating) });
			return publicTicket(ticketId);
		},

		rateComment(userId, ticketId, comment) {
			const ticket = getTicket(ticketId);
			if (ticket.openerId !== userId) throw new ForbiddenError('Seule la personne qui a ouvert le ticket peut le commenter.');
			q.rateComment.run(comment.slice(0, 1000) || null, ticketId);
			return publicTicket(ticketId);
		},

		// A message in a ticket channel: recorded for the panel, resets the inactivity timer
		recordMessage(channelId, message) {
			const ticketId = liveChannels.get(channelId);
			if (!ticketId) return null;
			if (!message.bot && openChannels.has(channelId)) q.touch.run(now(), channelId);
			const saved = insertMessage(ticketId, message);
			if (!message.bot && !message.internal) markFirstResponse(ticketId, message.authorId, message.createdAt ?? now());
			return saved;
		},

		updateMessage(channelId, { id, content, embeds }) {
			if (!liveChannels.has(channelId) || !q.message.get(id)) return null;
			q.editMessage.run({ id, content: content?.slice(0, 4000) ?? '', embeds: JSON.stringify((embeds ?? []).slice(0, 10)), at: now() });
			const saved = toMessage(q.message.get(id));
			emit({ type: 'message_update', guildId: getTicket(saved.ticketId).guildId, message: saved });
			return saved;
		},

		removeMessage(channelId, id) {
			if (!liveChannels.has(channelId) || !q.removeMessage.run(now(), id).changes) return null;
			const saved = toMessage(q.message.get(id));
			emit({ type: 'message_delete', guildId: getTicket(saved.ticketId).guildId, message: saved });
			return saved;
		},

		// Path of the staff HTML transcript, when it exists
		transcriptFile(ticketId) {
			const ticket = getTicket(ticketId);
			const file = transcriptPath(ticket.id);
			return file && fs.existsSync(file) ? { ticket, file } : null;
		},

		messages(ticketId) {
			getTicket(ticketId);
			return q.messages.all(ticketId).map(toMessage);
		},

		// Answer from the panel: sent in the channel with the panel user's name, or kept as an internal note
		// replyId: the text comes from a saved reply (maybe edited): its variables are filled
		async reply(actor, ticketId, { content, internal = false, replyId = null }) {
			const ticket = getTicket(ticketId);
			await requireHandle(actor.id, ticket, 'Il te faut la permission de traiter ce ticket.');
			let text = String(content ?? '').trim();
			if (replyId) {
				const saved = findReplyFor(ticket, replyId);
				// FiveM data: the keys of the saved reply, any other one only with the right to see it
				const keys = actor.can('fivemdata.view') ? fivemKeysIn(text) : fivemKeysIn(saved.content);
				text = await renderReply(ticket, text, actor.id, keys);
				q.usedReply.run(saved.id);
			}
			if (!text || text.length > 2000) throw new ValidationError('Le message fait 1 à 2000 caractères.');
			const user = await executor.getUser(actor.id);
			const author = { authorId: actor.id, authorName: user?.globalName ?? user?.username ?? actor.id, authorAvatar: user?.avatar ?? null, panelUser: actor.id };
			if (internal) {
				const note = insertMessage(ticketId, { id: `note-${now()}-${Math.random().toString(36).slice(2, 8)}`, ...author, content: text, internal: true });
				audit.record({ actorId: actor.id, source: 'panel', action: 'tickets.note', guildId: ticket.guildId, target: String(ticket.id), details: { number: ticket.number } });
				return note;
			}
			if (!ticket.channelId || !liveChannels.has(ticket.channelId)) throw new ValidationError('Le salon de ce ticket n’existe plus.');
			const id = await executor.sendTicketReply(ticket.channelId, { content: text, username: `${author.authorName} · Panel`, avatarUrl: author.authorAvatar });
			if (openChannels.has(ticket.channelId)) q.touch.run(now(), ticket.channelId);
			const saved = insertMessage(ticketId, { id, ...author, content: text });
			markFirstResponse(ticketId, actor.id);
			audit.record({ actorId: actor.id, source: 'panel', action: 'tickets.reply', guildId: ticket.guildId, target: String(ticket.id), details: { number: ticket.number } });
			return saved;
		},

		// --- Close request: the staff asks the opener whether the ticket can be closed ---------
		async requestClose(userId, ticketId, reason = '', source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			await requireHandle(userId, ticket, 'Seul le staff peut demander la fermeture d’un ticket.');
			if (!ticket.channelId || !openChannels.has(ticket.channelId)) throw new ValidationError('Le salon de ce ticket n’existe plus.');
			const clean = String(reason ?? '').trim().slice(0, 200);
			const hours = closeRequestHours(ticket);
			q.setCloseRequest.run(now(), userId, clean || null, ticketId);
			try {
				await executor.sendTicketNotice(ticket.channelId, { kind: 'close_request', ticket: getTicket(ticketId), by: userId, reason: clean, closeInHours: hours || null });
			}
			catch (error) {
				q.clearCloseRequest.run(ticketId);
				logger.warn(`Close request of ticket #${ticket.number} not sent:`, error.message);
				throw new ValidationError('Impossible d’envoyer la demande dans le salon du ticket.');
			}
			record(userId, source, 'tickets.close_request', ticket, { reason: clean || null, 'Fermeture automatique': hours ? `après ${hours} h sans réponse` : 'jamais' });
			return getTicket(ticketId);
		},

		// The opener answers: yes closes the ticket, no cancels the request and tells the staff
		async answerCloseRequest(userId, ticketId, accept) {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est déjà fermé.');
			if (userId !== ticket.openerId) throw new ForbiddenError('Seule la personne qui a ouvert le ticket peut répondre à cette demande.');
			if (!ticket.closeRequest) throw new ValidationError('Il n’y a plus de demande de fermeture en cours.');
			q.clearCloseRequest.run(ticketId);
			if (accept) return service.close(userId, ticketId, ticket.closeRequest.reason || 'Fermeture acceptée par le membre', 'bot', { accepted: true });
			if (openChannels.has(ticket.channelId)) q.touch.run(now(), ticket.channelId);
			await executor.sendTicketNotice(ticket.channelId, { kind: 'close_refused', ticket, by: ticket.closeRequest.by })
				.catch(error => logger.warn(`Refusal of ticket #${ticket.number} not sent:`, error.message));
			record(userId, 'bot', 'tickets.close_refused', ticket, { 'Demandée par': `<@${ticket.closeRequest.by}>` });
			return getTicket(ticketId);
		},

		// --- Saved replies ---------------------------------------------------------------
		replies(guildId) {
			return q.replies.all(guildId).map(toReply);
		},

		ticketReplies(ticketId) {
			return repliesFor(getTicket(ticketId));
		},

		saveReply(actor, guildId, input = {}) {
			requireReplies(actor, guildId);
			const name = String(input.name ?? '').trim();
			const content = String(input.content ?? '').trim();
			if (!name || name.length > 50) throw new ValidationError('Le nom fait 1 à 50 caractères.');
			if (!content || content.length > 2000) throw new ValidationError('Le texte fait 1 à 2000 caractères.');
			const existing = input.id ? q.reply.get(input.id) : null;
			if (input.id && (!existing || existing.guild_id !== guildId)) throw new NotFoundError('Réponse enregistrée introuvable.');
			const categoryId = input.categoryId ?? null;
			if (categoryId !== null) {
				const category = q.category.get(categoryId);
				if (!category || category.guild_id !== guildId) throw new ValidationError('Ce type de ticket n’existe pas sur ce serveur.');
			}
			assertFivemAllowed(actor, content, existing?.content ?? null);
			const values = { guildId, categoryId, name, content, at: now() };
			let id = input.id;
			try {
				if (existing) q.updateReply.run({ ...values, id });
				else id = Number(q.insertReply.run({ ...values, by: actor.id }).lastInsertRowid);
			}
			catch (error) {
				if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ValidationError(`Une réponse s’appelle déjà « ${name} » sur ce serveur.`);
				throw error;
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.reply_save', guildId, target: String(id), details: { name } });
			return toReply(q.reply.get(id));
		},

		deleteReply(actor, guildId, id) {
			requireReplies(actor, guildId);
			const existing = q.reply.get(id);
			if (!existing || existing.guild_id !== guildId) throw new NotFoundError('Réponse enregistrée introuvable.');
			q.deleteReply.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.reply_delete', guildId, target: String(id), details: { name: existing.name } });
		},

		// From Discord (/ticket reponse): sent like a panel reply, with the staff member's name and avatar
		async sendSavedReply(userId, ticketId, replyId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			await requireHandle(userId, ticket, 'Seul le staff peut utiliser les réponses enregistrées.');
			if (!ticket.channelId || !liveChannels.has(ticket.channelId)) throw new ValidationError('Le salon de ce ticket n’existe plus.');
			const saved = findReplyFor(ticket, replyId);
			const text = await renderReply(ticket, saved.content, userId, fivemKeysIn(saved.content));
			if (!text) throw new ValidationError('Cette réponse est vide une fois remplie.');
			const user = await executor.getUser(userId).catch(() => null);
			const author = { authorId: userId, authorName: user?.globalName ?? user?.username ?? userId, authorAvatar: user?.avatar ?? null };
			const id = await executor.sendTicketReply(ticket.channelId, { content: text, username: author.authorName, avatarUrl: author.authorAvatar });
			if (openChannels.has(ticket.channelId)) q.touch.run(now(), ticket.channelId);
			insertMessage(ticketId, { id, ...author, content: text });
			markFirstResponse(ticketId, userId);
			q.usedReply.run(saved.id);
			audit.record({ actorId: userId, source, action: 'tickets.saved_reply', guildId: ticket.guildId, target: String(ticket.id), details: { number: ticket.number, name: saved.name } });
			return text;
		},

		// --- Statistics ------------------------------------------------------------------
		// guildId / categoryId optional; from / to in ms (default: the last 30 days, a year at most)
		stats({ guildId = null, categoryId = null, from = null, to = null } = {}) {
			const end = Number.isFinite(to) && to > 0 ? Math.min(to, now()) : now();
			const start = Math.max(Number.isFinite(from) && from > 0 ? from : end - 30 * 86_400_000, end - STATS_MAX_MS);
			if (start >= end) throw new ValidationError('La période choisie est vide.');
			const where = [
				'((created_at BETWEEN @start AND @end) OR (closed_at BETWEEN @start AND @end))',
				guildId && 'guild_id = @guildId',
				categoryId && 'category_id = @categoryId',
			].filter(Boolean);
			const rows = db.prepare(`
				SELECT id, guild_id, category_id, opener_id, created_at, closed_at, closed_by, claimed_by, first_response_at, first_responder_id, sla_breached_at, rating
				FROM tickets WHERE ${where.join(' AND ')}
			`).all({ start, end, guildId, categoryId }).map(r => ({
				id: r.id, guildId: r.guild_id, categoryId: r.category_id, openerId: r.opener_id, createdAt: r.created_at, closedAt: r.closed_at, closedBy: r.closed_by,
				claimedBy: r.claimed_by, firstResponseAt: r.first_response_at, firstResponderId: r.first_responder_id, slaBreachedAt: r.sla_breached_at, rating: r.rating,
			}));
			const sla = new Map();
			const slaMinutes = (id) => {
				if (!sla.has(id)) {
					const row = id ? q.category.get(id) : null;
					sla.set(id, row ? toCategory(row).config.sla.firstResponseMinutes : 0);
				}
				return sla.get(id);
			};
			return ticketStats(rows, { from: start, to: end, slaMinutes });
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		// Every few minutes: reminder, then automatic close of inactive tickets
		async sweep() {
			const oldest = now() - 3600_000;
			for (const row of q.inactive.all(oldest)) {
				const ticket = toTicket(row);
				const category = categoryOf(ticket);
				if (!category) continue;
				const { reminderHours, closeHours } = category.config.inactivity;
				const idle = now() - ticket.lastActivityAt;
				if (closeHours && idle >= closeHours * 3600_000) {
					await service.close('system', ticket.id, `Inactif depuis ${closeHours} h`, 'bot').catch(error => logger.warn(`Auto-close of ticket #${ticket.number} failed:`, error.message));
				}
				else if (reminderHours && idle >= reminderHours * 3600_000 && !row.reminded_at) {
					q.reminded.run(now(), ticket.id);
					await executor.sendTicketNotice(ticket.channelId, { kind: 'reminder', ticket, closeInHours: closeHours ? Math.max(1, Math.round(closeHours - idle / 3600_000)) : null })
						.catch(error => logger.warn(`Reminder of ticket #${ticket.number} failed:`, error.message));
				}
			}
			// Close requests left without an answer
			for (const row of q.closeRequests.all()) {
				const ticket = toTicket(row);
				const hours = closeRequestHours(ticket);
				if (!hours || now() - ticket.closeRequest.at < hours * 3600_000) continue;
				await service.close('system', ticket.id, 'Pas de réponse à la demande de fermeture', 'bot')
					.catch(error => logger.warn(`Close request of ticket #${ticket.number} not applied:`, error.message));
			}
			// First response delay (SLA) exceeded: one alert in the "tickets" logs
			for (const row of q.slaPending.all()) {
				const ticket = toTicket(row);
				const category = categoryOf(ticket);
				const minutes = category?.config.sla.firstResponseMinutes ?? 0;
				if (!minutes || now() - ticket.createdAt < minutes * 60_000) continue;
				if (!q.markSla.run(now(), ticket.id).changes) continue;
				audit.record({
					actorId: 'system', source: 'system', action: 'tickets.sla_breach', guildId: ticket.guildId, target: String(ticket.id),
					details: {
						number: ticket.number, opener: ticket.openerName, Type: category.name, 'Délai prévu': `${minutes} min`,
						...(ticket.channelId ? { Salon: `<#${ticket.channelId}>` } : {}),
					},
				});
				emit({ type: 'ticket', ticket: getTicket(ticket.id), action: 'tickets.sla_breach' });
			}
		},

		// The ticket channel was deleted by hand
		markChannelDeleted(channelId) {
			const row = q.byChannelAny.get(channelId);
			if (!row) return null;
			openChannels.delete(channelId);
			liveChannels.delete(channelId);
			if (row.status === 'open') {
				q.close.run({ history: row.status_history, at: now(), by: 'unknown', reason: 'Salon supprimé', transcript: null, archived: 0, id: row.id });
			}
			else if (row.archived) {
				q.unarchive.run(row.id);
			}
			return getTicket(row.id);
		},

		findByChannel(channelId, { includeClosed = false } = {}) {
			return toTicket(includeClosed ? q.byChannelAny.get(channelId) : q.byChannel.get(channelId));
		},

		get(id, { withTranscript = false } = {}) {
			const ticket = toTicket(q.ticket.get(id), { withTranscript });
			if (!ticket) throw new NotFoundError('Ticket introuvable.');
			return ticket;
		},

		list({ guildId, status, statusKey, categoryId, priority, claimedBy, openerId, before, limit = 50 } = {}) {
			const params = { guildId, status, statusKey, categoryId, priority, claimedBy, openerId, before, limit: Math.min(Math.max(Number(limit) || 50, 1), 200) };
			const where = [
				guildId && 'guild_id = @guildId',
				status && 'status = @status',
				statusKey && 'status_key = @statusKey',
				categoryId && 'category_id = @categoryId',
				priority && 'priority = @priority',
				claimedBy && 'claimed_by = @claimedBy',
				openerId && 'opener_id = @openerId',
				before && 'id < @before',
			].filter(Boolean);
			return db.prepare(`SELECT * FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT @limit`).all(params).map(r => toTicket(r));
		},
	};
	return service;
}
