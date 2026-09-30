import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { emojiOf } from './messages.js';

// A suggestion / bug as posted in its channel
export function feedbackPayload({ box, item, status, urgency }) {
	const color = urgency && !status.final ? urgency.color : status.color;
	const embed = new EmbedBuilder()
		.setColor(Number.parseInt(color.slice(1), 16))
		.setAuthor({ name: item.anonymous ? `${box.name} · anonyme` : `${box.name} · ${item.authorName ?? 'membre'}` })
		.setTitle(`#${item.number} · ${item.title}`.slice(0, 256))
		.setDescription(item.answers.map(a => `**${a.label}**\n${a.value}`).join('\n\n').slice(0, 4000) || null)
		.addFields({ name: 'Statut', value: `${status.emoji} ${status.label}`, inline: true })
		.setFooter({ text: `${box.name} #${item.number}` })
		.setTimestamp(new Date(item.createdAt));
	if (box.config.votes) embed.addFields({ name: 'Votes', value: `👍 ${item.up} · 👎 ${item.down}`, inline: true });
	if (urgency) embed.addFields({ name: 'Urgence', value: urgency.label, inline: true });
	if (item.assigneeId) embed.addFields({ name: 'Pris par', value: `<@${item.assigneeId}>`, inline: true });
	if (item.statusReason) embed.addFields({ name: 'Réponse du staff', value: item.statusReason.slice(0, 1024) });
	if (item.duplicateOf) embed.addFields({ name: 'Doublon de', value: `#${item.duplicateOf}`, inline: true });

	const rows = [];
	if (!status.final) {
		const buttons = [];
		if (box.config.votes) {
			buttons.push(
				new ButtonBuilder().setCustomId(`fb:up:${item.id}`).setEmoji('👍').setLabel(String(item.up)).setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`fb:down:${item.id}`).setEmoji('👎').setLabel(String(item.down)).setStyle(ButtonStyle.Danger),
			);
		}
		if (box.kind === 'staff' && !item.assigneeId) buttons.push(new ButtonBuilder().setCustomId(`fb:assign:${item.id}`).setLabel('Je m’en occupe').setEmoji('🙋').setStyle(ButtonStyle.Primary));
		if (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons));
	}
	rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
		.setCustomId(`fb:status:${item.id}`)
		.setPlaceholder('Changer le statut (staff)')
		.addOptions(box.config.statuses.map((s) => {
			const option = { label: s.label, value: s.key, default: s.key === item.status };
			const emoji = emojiOf(s.emoji);
			if (emoji) option.emoji = emoji;
			return option;
		}))));
	return { embeds: [embed], components: rows };
}

export function reviewPayload(view) {
	const { embeds } = feedbackPayload(view);
	return {
		content: '📝 À valider avant publication',
		embeds,
		components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`fb:approve:${view.item.id}`).setLabel('Publier').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`fb:deny:${view.item.id}`).setLabel('Refuser').setStyle(ButtonStyle.Danger),
		)],
	};
}

export function boxPanelPayload(box) {
	const buttons = [new ButtonBuilder().setCustomId(`fb:open:${box.id}`).setLabel(box.kind === 'staff' ? 'Signaler un bug' : 'Proposer').setEmoji(box.kind === 'staff' ? '🐞' : '💡').setStyle(ButtonStyle.Primary)];
	if (box.config.anonymousAllowed) buttons.push(new ButtonBuilder().setCustomId(`fb:openanon:${box.id}`).setLabel('Anonymement').setEmoji('🕶️').setStyle(ButtonStyle.Secondary));
	return {
		embeds: [new EmbedBuilder().setColor(0xd6a249).setTitle(box.name).setDescription(box.kind === 'staff'
			? 'Un problème dans le fonctionnement du staff ou du serveur ? Signale-le ici, avec son niveau d’urgence.'
			: 'Une idée, un souci ? Clique sur le bouton, remplis le formulaire : ta proposition sera publiée et la communauté pourra voter.')],
		components: [new ActionRowBuilder().addComponents(buttons)],
	};
}
