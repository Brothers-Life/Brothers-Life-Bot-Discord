import {
	ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder,
} from 'discord.js';
import { buildEmbeds, emojiOf } from './messages.js';
import { formModal } from './forms.js';

const COLOR = 0xd6a249;
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const PRIORITY_EMOJI = { low: '⚪', normal: '🔵', high: '🟠', urgent: '🔴' };

// Panel: the embed chosen in the panel, then buttons (one per type) or a menu
export function panelPayload({ id, payload, style, placeholder, categories }) {
	const components = [];
	if (style === 'select') {
		const menu = new StringSelectMenuBuilder()
			.setCustomId(`ticket:pick:${id}`)
			.setPlaceholder((placeholder || 'Choisis le type de demande').slice(0, 150))
			.addOptions(categories.slice(0, 25).map((c) => {
				const option = { label: c.name.slice(0, 100), value: String(c.id) };
				if (c.description) option.description = c.description.slice(0, 100);
				const emoji = emojiOf(c.emoji);
				if (emoji) option.emoji = emoji;
				return option;
			}));
		components.push(new ActionRowBuilder().addComponents(menu));
	}
	else {
		for (let i = 0; i < Math.min(categories.length, 25); i += 5) {
			components.push(new ActionRowBuilder().addComponents(categories.slice(i, i + 5).map((c) => {
				const button = new ButtonBuilder().setCustomId(`ticket:open:${c.id}`).setLabel(c.name.slice(0, 80)).setStyle(STYLES[c.config?.buttonStyle] ?? ButtonStyle.Secondary);
				const emoji = emojiOf(c.emoji);
				if (emoji) button.setEmoji(emoji);
				return button;
			})));
		}
	}
	return { content: payload.content || undefined, embeds: buildEmbeds(payload), components, allowedMentions: { parse: [] } };
}

// Discord does not chain modals: an ephemeral "continue" button opens the next one
export function nextStepPayload(prefix, id, next, total) {
	return {
		content: `Réponses enregistrées. Encore un peu : étape ${next + 1}/${total}.`,
		components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`${prefix}:next:${id}:${next}`).setLabel(`Continuer (${next + 1}/${total})`).setStyle(ButtonStyle.Primary),
		)],
	};
}

export function welcomePayload({ ticket, title, message, color, answers, pingRoleIds, statuses, priorities }) {
	const embed = new EmbedBuilder()
		.setColor(Number.parseInt(color.slice(1), 16) || COLOR)
		.setTitle(title)
		.setDescription(message)
		.addFields(answers.slice(0, 25).map(a => ({ name: a.label.slice(0, 256), value: a.value.slice(0, 1024) || '—' })));
	const buttons = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`ticket:add:${ticket.id}`).setLabel('Ajouter un membre').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fermer').setStyle(ButtonStyle.Danger),
	);
	const status = new StringSelectMenuBuilder()
		.setCustomId(`ticket:status:${ticket.id}`)
		.setPlaceholder('Changer le statut (staff)')
		.addOptions(statuses.slice(0, 25).map((s) => {
			const option = { label: s.label.slice(0, 100), value: s.key };
			const emoji = emojiOf(s.emoji);
			if (emoji) option.emoji = emoji;
			return option;
		}));
	const priority = new StringSelectMenuBuilder()
		.setCustomId(`ticket:priority:${ticket.id}`)
		.setPlaceholder('Priorité (staff)')
		.addOptions(priorities.map(p => ({ label: p.label, value: p.key, emoji: PRIORITY_EMOJI[p.key] })));
	return {
		content: [`<@${ticket.openerId}>`, ...pingRoleIds.map(id => `<@&${id}>`)].join(' '),
		embeds: [embed],
		components: [buttons, new ActionRowBuilder().addComponents(status), new ActionRowBuilder().addComponents(priority)],
		allowedMentions: { users: [ticket.openerId], roles: pingRoleIds },
	};
}

export function noticePayload({ kind, ticket, reason, by, closeInHours }) {
	if (kind === 'archived') {
		return {
			embeds: [new EmbedBuilder().setColor(0x8b8b8b).setTitle(`Ticket #${ticket.number} archivé`).setDescription(reason ? `Raison : ${reason}` : 'Le ticket est fermé. Le staff peut le rouvrir ou le supprimer.')],
			components: [new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`ticket:reopen:${ticket.id}`).setLabel('Rouvrir').setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`ticket:transcript:${ticket.id}`).setLabel('Transcript').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId(`ticket:delete:${ticket.id}`).setLabel('Supprimer').setStyle(ButtonStyle.Danger),
			)],
		};
	}
	if (kind === 'close_request') {
		const embed = new EmbedBuilder()
			.setColor(COLOR)
			.setTitle('Ton ticket peut-il être fermé ?')
			.setDescription([
				`<@${by}> pense que ta demande est réglée.`,
				reason ? `> ${reason}` : null,
				closeInHours ? `Sans réponse de ta part, le ticket sera fermé automatiquement dans ${closeInHours} h.` : null,
			].filter(Boolean).join('\n'));
		return {
			content: `<@${ticket.openerId}>`,
			embeds: [embed],
			components: [new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`ticket:creq:${ticket.id}:yes`).setLabel('Fermer le ticket').setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`ticket:creq:${ticket.id}:no`).setLabel('J’ai encore besoin d’aide').setStyle(ButtonStyle.Secondary),
			)],
			allowedMentions: { users: [ticket.openerId] },
		};
	}
	if (kind === 'close_refused') {
		return {
			content: `<@${by}> : <@${ticket.openerId}> a encore besoin d’aide, la demande de fermeture est annulée.`,
			allowedMentions: { users: [by] },
		};
	}
	if (kind === 'reopened') {
		return { content: `Ticket rouvert par <@${by}>. <@${ticket.openerId}>`, allowedMentions: { users: [ticket.openerId] } };
	}
	return {
		content: `<@${ticket.openerId}> ce ticket est sans nouvelles depuis un moment.${closeInHours ? ` Sans réponse, il sera fermé automatiquement dans environ ${closeInHours} h.` : ''}`,
		allowedMentions: { users: [ticket.openerId] },
	};
}

export function ratingPayload(ticket) {
	return {
		content: `Comment s’est passé ton ticket #${ticket.number} ? Donne une note de 1 à 5.`,
		components: [new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map(n =>
			new ButtonBuilder().setCustomId(`ticket:rate:${ticket.id}:${n}`).setLabel('★'.repeat(n)).setStyle(n >= 4 ? ButtonStyle.Success : n <= 2 ? ButtonStyle.Danger : ButtonStyle.Secondary),
		))],
	};
}

export function ratingCommentModal(ticketId) {
	return formModal(`ticket:ratecomment:${ticketId}`, 'Un commentaire ?', {
		questions: [{ id: 'comment', type: 'paragraph', label: 'Ton avis (facultatif)', required: false, maxLength: 1000 }],
	});
}

export function closeModal(ticketId, { requireReason }) {
	return formModal(`ticket:closeform:${ticketId}`, 'Fermer le ticket', {
		questions: [{ id: 'reason', type: 'short', label: requireReason ? 'Raison' : 'Raison (facultatif)', required: requireReason, maxLength: 200 }],
	});
}

export function addMemberMenu(ticketId) {
	return new ActionRowBuilder().addComponents(
		new UserSelectMenuBuilder().setCustomId(`ticket:addselect:${ticketId}`).setPlaceholder('Membres à ajouter').setMinValues(1).setMaxValues(5),
	);
}
