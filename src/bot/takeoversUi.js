import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const actionOf = takeover => (takeover.mode === 'form' ? 'Postuler' : 'S’inscrire');

export function takeoverPanelPayload({ title, takeovers }) {
	const shown = takeovers.slice(0, 25);
	const lines = shown.map((t) => {
		const date = t.interviewAt && !t.convokedAt ? `\nEntretiens : <t:${Math.floor(t.interviewAt / 1000)}:f>` : '';
		return `**${t.name}** ${t.open ? '🟢 inscriptions ouvertes' : '🔴 inscriptions fermées'}${t.description ? `\n${t.description}` : ''}${date}`;
	});
	const embed = new EmbedBuilder()
		.setColor(0xff9628)
		.setTitle(title)
		.setDescription((lines.join('\n\n') || 'Aucune reprise disponible pour le moment.').slice(0, 4000));
	const buttons = shown.map(t => new ButtonBuilder()
		.setCustomId(`to:join:${t.id}`)
		.setLabel(`${actionOf(t)} : ${t.name}`.slice(0, 80))
		.setStyle(ButtonStyle.Primary)
		.setDisabled(!t.open));
	const components = [];
	for (let i = 0; i < buttons.length; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
	return { embeds: [embed], components };
}

export function leaveRow(id) {
	return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`to:leave:${id}`).setLabel('Retirer mon inscription').setStyle(ButtonStyle.Secondary));
}
