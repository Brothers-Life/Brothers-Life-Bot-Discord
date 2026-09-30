import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from 'discord.js';

const COLOR = 0xd6a249;

function emojiOf(value) {
	if (!value) return undefined;
	const custom = /^<a?:\w+:(\d+)>$/.exec(value);
	return custom ? { id: custom[1] } : value;
}

export function panelPayload({ title, text, categories }) {
	const embed = new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(
		[text, '', ...categories.map(c => `${c.emoji ? `${c.emoji} ` : ''}**${c.name}**${c.description ? ` — ${c.description}` : ''}`)].join('\n'),
	);
	const rows = [];
	for (let i = 0; i < Math.min(categories.length, 25); i += 5) {
		rows.push(new ActionRowBuilder().addComponents(categories.slice(i, i + 5).map((c) => {
			const button = new ButtonBuilder().setCustomId(`ticket:open:${c.id}`).setLabel(c.name.slice(0, 80)).setStyle(ButtonStyle.Secondary);
			const emoji = emojiOf(c.emoji);
			if (emoji) button.setEmoji(emoji);
			return button;
		})));
	}
	return { embeds: [embed], components: rows };
}

export function welcomePayload({ ticket, category, staffRoleIds }) {
	const embed = new EmbedBuilder()
		.setColor(COLOR)
		.setTitle(`Ticket #${ticket.number} · ${category.name}`)
		.setDescription(`Bonjour <@${ticket.openerId}>, l’équipe va te répondre ici. Explique ta demande en détail.`)
		.addFields(ticket.subject ? [{ name: 'Sujet', value: ticket.subject }] : []);
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`ticket:add:${ticket.id}`).setLabel('Ajouter un membre').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Fermer').setStyle(ButtonStyle.Danger),
	);
	return {
		content: [`<@${ticket.openerId}>`, ...staffRoleIds.map(id => `<@&${id}>`)].join(' '),
		embeds: [embed],
		components: [row],
		allowedMentions: { users: [ticket.openerId], roles: staffRoleIds },
	};
}

export function openModal(categoryId, categoryName) {
	return new ModalBuilder()
		.setCustomId(`ticket:openform:${categoryId}`)
		.setTitle(`Ticket · ${categoryName}`.slice(0, 45))
		.addComponents(new ActionRowBuilder().addComponents(
			new TextInputBuilder().setCustomId('subject').setLabel('Sujet de ta demande').setStyle(TextInputStyle.Paragraph).setMaxLength(200).setRequired(true),
		));
}

export function closeModal(ticketId) {
	return new ModalBuilder()
		.setCustomId(`ticket:closeform:${ticketId}`)
		.setTitle('Fermer le ticket')
		.addComponents(new ActionRowBuilder().addComponents(
			new TextInputBuilder().setCustomId('reason').setLabel('Raison (facultatif)').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false),
		));
}

export function addMemberMenu(ticketId) {
	return new ActionRowBuilder().addComponents(
		new UserSelectMenuBuilder().setCustomId(`ticket:addselect:${ticketId}`).setPlaceholder('Membres à ajouter').setMinValues(1).setMaxValues(5),
	);
}
