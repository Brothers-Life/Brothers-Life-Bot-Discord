import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('tickets.view', { label: 'Voir les tickets et leurs transcripts', category: 'Tickets' });
definePermission('tickets.handle', { label: 'Traiter les tickets (prendre en charge, fermer)', category: 'Tickets' });
definePermission('tickets.manage', { label: 'Configurer les tickets', category: 'Tickets' });

const CLOSE_DELAY_MS = 10_000;

export function createTickets({ db, network, ranks, audit, executor, logs, logger = console, now = Date.now, closeDelayMs = CLOSE_DELAY_MS }) {
	logs.registerCategory('tickets', 'Tickets (ouverture, fermeture, transcripts)');

	const q = {
		settings: db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?'),
		upsertSettings: db.prepare(`
			INSERT INTO ticket_settings (guild_id, panel_channel_id, panel_message_id, panel_title, panel_text, max_open)
			VALUES (@guildId, @panelChannelId, @panelMessageId, @panelTitle, @panelText, @maxOpen)
			ON CONFLICT(guild_id) DO UPDATE SET panel_channel_id = excluded.panel_channel_id, panel_message_id = excluded.panel_message_id,
				panel_title = excluded.panel_title, panel_text = excluded.panel_text, max_open = excluded.max_open
		`),
		categories: db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY position, id'),
		category: db.prepare('SELECT * FROM ticket_categories WHERE id = ?'),
		insertCategory: db.prepare(`
			INSERT INTO ticket_categories (guild_id, name, emoji, description, parent_channel_id, transcript_channel_id, rank_ids, role_ids, position, created_at)
			VALUES (@guildId, @name, @emoji, @description, @parentChannelId, @transcriptChannelId, @rankIds, @roleIds, @position, @createdAt)
		`),
		updateCategory: db.prepare(`
			UPDATE ticket_categories SET name = @name, emoji = @emoji, description = @description, parent_channel_id = @parentChannelId, transcript_channel_id = @transcriptChannelId,
				rank_ids = @rankIds, role_ids = @roleIds, position = @position WHERE id = @id
		`),
		deleteCategory: db.prepare('DELETE FROM ticket_categories WHERE id = ?'),
		nextNumber: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM tickets WHERE guild_id = ?'),
		insertTicket: db.prepare(`
			INSERT INTO tickets (guild_id, number, category_id, opener_id, opener_name, subject, created_at)
			VALUES (@guildId, @number, @categoryId, @openerId, @openerName, @subject, @createdAt)
		`),
		setChannel: db.prepare('UPDATE tickets SET channel_id = ? WHERE id = ?'),
		deleteTicket: db.prepare('DELETE FROM tickets WHERE id = ?'),
		ticket: db.prepare('SELECT * FROM tickets WHERE id = ?'),
		byChannel: db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND status = \'open\''),
		openOf: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = \'open\''),
		claim: db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?'),
		close: db.prepare('UPDATE tickets SET status = \'closed\', closed_at = ?, closed_by = ?, close_reason = ?, transcript = ? WHERE id = ? AND status = \'open\''),
		staffRoles: db.prepare('SELECT DISTINCT role_id FROM rank_roles WHERE guild_id = ? AND rank_id = ?'),
	};

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
			status: row.status,
			claimedBy: row.claimed_by,
			createdAt: row.created_at,
			closedAt: row.closed_at,
			closedBy: row.closed_by,
			closeReason: row.close_reason,
			...(withTranscript ? { transcript: row.transcript } : { hasTranscript: Boolean(row.transcript) }),
		};
	}

	function settingsOf(guildId) {
		const row = q.settings.get(guildId);
		return {
			guildId,
			panelChannelId: row?.panel_channel_id ?? null,
			panelMessageId: row?.panel_message_id ?? null,
			panelTitle: row?.panel_title ?? 'Besoin d’aide ?',
			panelText: row?.panel_text ?? 'Choisis le type de demande : un salon privé s’ouvre avec l’équipe.',
			maxOpen: row?.max_open ?? 1,
		};
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

	// Staff of a category = roles linked to its ranks on that server + extra roles
	function staffRoleIds(category) {
		const fromRanks = category.rankIds.flatMap(rankId => q.staffRoles.all(category.guildId, rankId).map(r => r.role_id));
		return [...new Set([...fromRanks, ...category.roleIds])];
	}

	async function canHandle(userId, ticket) {
		const principal = await ranks.resolve(userId);
		if (principal.can('tickets.handle')) return principal;
		// Discord staff roles of the category also allow handling from Discord
		const category = ticket.categoryId ? q.category.get(ticket.categoryId) : null;
		if (category) {
			const roles = await executor.getMemberRoleIds(ticket.guildId, userId);
			if (roles?.some(r => staffRoleIds(toCategory(category)).includes(r))) return principal;
		}
		return null;
	}

	function record(actorId, source, action, ticket, details = {}) {
		audit.record({ actorId, source, action, guildId: ticket.guildId, target: String(ticket.id), details: { number: ticket.number, opener: ticket.openerName, ...details } });
	}

	function validateCategory(input) {
		if (!input.name?.trim() || input.name.length > 50) throw new ValidationError('Le nom fait 1 à 50 caractères.');
		if (input.description && input.description.length > 100) throw new ValidationError('La description fait 100 caractères maximum.');
		if (input.emoji && input.emoji.length > 64) throw new ValidationError('Émoji invalide.');
	}

	const service = {
		settings: settingsOf,

		describe(guildId) {
			return { settings: settingsOf(guildId), categories: q.categories.all(guildId).map(toCategory) };
		},

		saveSettings(actor, guildId, { panelChannelId = null, panelTitle, panelText, maxOpen }) {
			requireManage(actor, guildId);
			const current = settingsOf(guildId);
			if (maxOpen !== undefined && (!Number.isInteger(maxOpen) || maxOpen < 1 || maxOpen > 10)) throw new ValidationError('Entre 1 et 10 tickets ouverts par personne.');
			q.upsertSettings.run({
				guildId,
				panelChannelId: panelChannelId ?? current.panelChannelId,
				panelMessageId: panelChannelId && panelChannelId !== current.panelChannelId ? null : current.panelMessageId,
				panelTitle: (panelTitle ?? current.panelTitle).slice(0, 100),
				panelText: (panelText ?? current.panelText).slice(0, 1000),
				maxOpen: maxOpen ?? current.maxOpen,
			});
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.settings', guildId, target: guildId });
			return settingsOf(guildId);
		},

		async saveCategory(actor, guildId, input) {
			requireManage(actor, guildId);
			validateCategory(input);
			if (input.transcriptChannelId && !await executor.getTextChannel(guildId, input.transcriptChannelId)) {
				throw new ValidationError('Le salon des transcripts n’existe pas sur ce serveur, ou le bot ne peut pas y écrire.');
			}
			const values = {
				guildId,
				name: input.name.trim(),
				emoji: input.emoji?.trim() || null,
				description: input.description?.trim() || null,
				parentChannelId: input.parentChannelId || null,
				transcriptChannelId: input.transcriptChannelId || null,
				rankIds: JSON.stringify((input.rankIds ?? []).map(Number).filter(Number.isInteger)),
				roleIds: JSON.stringify((input.roleIds ?? []).filter(r => /^\d{17,20}$/.test(r))),
				position: Number.isInteger(input.position) ? input.position : 0,
			};
			let id = input.id;
			if (id) {
				const existing = q.category.get(id);
				if (!existing || existing.guild_id !== guildId) throw new NotFoundError('Catégorie introuvable.');
				q.updateCategory.run({ ...values, id });
			}
			else {
				id = Number(q.insertCategory.run({ ...values, createdAt: now() }).lastInsertRowid);
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.category', guildId, target: String(id), details: { name: values.name } });
			return toCategory(q.category.get(id));
		},

		deleteCategory(actor, guildId, id) {
			requireManage(actor, guildId);
			const existing = q.category.get(id);
			if (!existing || existing.guild_id !== guildId) throw new NotFoundError('Catégorie introuvable.');
			q.deleteCategory.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.category_delete', guildId, target: String(id), details: { name: existing.name } });
		},

		// Posts (or updates) the message with one button per category
		async publishPanel(actor, guildId) {
			requireManage(actor, guildId);
			const settings = settingsOf(guildId);
			const categories = q.categories.all(guildId).map(toCategory);
			if (!settings.panelChannelId) throw new ValidationError('Choisis d’abord le salon du panneau.');
			if (!categories.length) throw new ValidationError('Crée d’abord au moins une catégorie de tickets.');
			const messageId = await executor.publishTicketPanel(settings.panelChannelId, settings.panelMessageId, { title: settings.panelTitle, text: settings.panelText, categories });
			q.upsertSettings.run({ ...settings, panelMessageId: messageId });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tickets.panel', guildId, target: settings.panelChannelId });
			return settingsOf(guildId);
		},

		async open({ guildId, userId, userName, categoryId, subject }) {
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Les tickets ne sont pas disponibles sur ce serveur.');
			const categoryRow = q.category.get(categoryId);
			if (!categoryRow || categoryRow.guild_id !== guildId) throw new NotFoundError('Cette catégorie de tickets n’existe plus.');
			const category = toCategory(categoryRow);
			const { maxOpen } = settingsOf(guildId);
			if (q.openOf.get(guildId, userId).n >= maxOpen) {
				throw new ValidationError(maxOpen === 1 ? 'Tu as déjà un ticket ouvert.' : `Tu as déjà ${maxOpen} tickets ouverts.`);
			}

			const number = q.nextNumber.get(guildId).n;
			const id = Number(q.insertTicket.run({ guildId, number, categoryId, openerId: userId, openerName: userName, subject: subject?.slice(0, 200) || null, createdAt: now() }).lastInsertRowid);
			let channelId;
			try {
				channelId = await executor.createTicketChannel({
					guildId,
					parentId: category.parentChannelId,
					name: `ticket-${String(number).padStart(4, '0')}-${userName}`,
					openerId: userId,
					staffRoleIds: staffRoleIds(category),
				});
			}
			catch (error) {
				q.deleteTicket.run(id);
				logger.warn(`Unable to create ticket channel on ${guildId}:`, error.message);
				throw new ValidationError('Impossible de créer le salon du ticket : vérifie les permissions du bot (Gérer les salons).');
			}
			q.setChannel.run(channelId, id);
			const ticket = getTicket(id);
			await executor.sendTicketWelcome(channelId, { ticket, category, staffRoleIds: staffRoleIds(category) }).catch(error => logger.warn('Ticket welcome failed:', error.message));
			record(userId, 'bot', 'tickets.open', ticket, { category: category.name, subject: ticket.subject, channel: `<#${channelId}>` });
			return ticket;
		},

		async claim(userId, ticketId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			if (!await canHandle(userId, ticket)) throw new ForbiddenError('Seul le staff peut prendre un ticket en charge.');
			q.claim.run(userId, ticketId);
			record(userId, source, 'tickets.claim', ticket);
			return getTicket(ticketId);
		},

		async addMember(userId, ticketId, memberId, source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est fermé.');
			if (!await canHandle(userId, ticket)) throw new ForbiddenError('Seul le staff peut ajouter quelqu’un au ticket.');
			await executor.addChannelMember(ticket.channelId, memberId);
			record(userId, source, 'tickets.add_member', ticket, { member: `<@${memberId}>` });
		},

		// The opener or the staff may close. The transcript is saved, logged and sent to the opener.
		async close(userId, ticketId, reason = '', source = 'bot') {
			const ticket = getTicket(ticketId);
			if (ticket.status !== 'open') throw new ValidationError('Ce ticket est déjà fermé.');
			if (userId !== ticket.openerId && !await canHandle(userId, ticket)) throw new ForbiddenError('Seuls la personne qui a ouvert le ticket et le staff peuvent le fermer.');

			const transcript = await executor.fetchTranscript(ticket.channelId).catch(() => null);
			const header = [
				`Ticket #${ticket.number} — ${ticket.subject ?? 'sans sujet'}`,
				`Ouvert par ${ticket.openerName} (${ticket.openerId}) le ${new Date(ticket.createdAt).toLocaleString('fr-FR')}`,
				`Fermé par ${userId} le ${new Date(now()).toLocaleString('fr-FR')}${reason ? ` : ${reason}` : ''}`,
				'',
			].join('\n');
			const text = `${header}${transcript ?? '(transcript indisponible)'}`;
			if (!q.close.run(now(), userId, reason || null, text, ticketId).changes) throw new ValidationError('Ce ticket est déjà fermé.');

			const file = { name: `ticket-${ticket.number}.txt`, content: text };
			const categoryRow = ticket.categoryId ? q.category.get(ticket.categoryId) : null;
			const summary = {
				title: `Ticket #${ticket.number} fermé`,
				description: `Ouvert par <@${ticket.openerId}> · fermé par <@${userId}>`,
				fields: [
					...(categoryRow ? [{ name: 'Catégorie', value: categoryRow.name, inline: true }] : []),
					...(ticket.subject ? [{ name: 'Sujet', value: ticket.subject }] : []),
					...(reason ? [{ name: 'Raison', value: reason }] : []),
				],
				files: [file],
			};
			// The category's own transcript channel, unless it is already the "tickets" log channel
			const transcriptChannelId = categoryRow?.transcript_channel_id;
			const logChannelId = logs.routes(ticket.guildId).find(r => r.category === 'tickets' && r.enabled)?.channelId;
			if (transcriptChannelId && transcriptChannelId !== logChannelId) {
				executor.sendLog(transcriptChannelId, summary).catch(error => logger.warn(`Transcript of ticket #${ticket.number} not sent:`, error.message));
			}
			logs.log(ticket.guildId, 'tickets', summary);
			executor.sendDM(ticket.openerId, `Ton ticket #${ticket.number} a été fermé${reason ? ` : ${reason}` : ''}. Voici la conversation.`, [file]).catch(() => null);
			record(userId, source, 'tickets.close', ticket, { reason: reason || null });

			if (ticket.channelId) {
				const timer = setTimeout(() => executor.deleteChannel(ticket.channelId, `Ticket #${ticket.number} fermé`).catch(() => null), closeDelayMs);
				timer.unref?.();
			}
			return getTicket(ticketId);
		},

		// The ticket channel was deleted by hand
		markChannelDeleted(channelId) {
			const row = q.byChannel.get(channelId);
			if (!row) return null;
			q.close.run(now(), 'unknown', 'Salon supprimé', null, row.id);
			return getTicket(row.id);
		},

		findByChannel(channelId) {
			return toTicket(q.byChannel.get(channelId));
		},

		get(id, { withTranscript = false } = {}) {
			const ticket = toTicket(q.ticket.get(id), { withTranscript });
			if (!ticket) throw new NotFoundError('Ticket introuvable.');
			return ticket;
		},

		list({ guildId, status, openerId, before, limit = 50 } = {}) {
			const params = { guildId, status, openerId, before, limit: Math.min(Math.max(Number(limit) || 50, 1), 200) };
			const where = [
				guildId && 'guild_id = @guildId',
				status && 'status = @status',
				openerId && 'opener_id = @openerId',
				before && 'id < @before',
			].filter(Boolean);
			return db.prepare(`SELECT * FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT @limit`).all(params).map(r => toTicket(r));
		},
	};
	return service;
}
