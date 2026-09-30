import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
	.setName('evenements')
	.setDescription('Les prochains événements RP')
	.setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
	const events = interaction.client.core.rpEvents.upcoming().filter(e => e.targets.some(t => t.guildId === interaction.guildId)).slice(0, 10);
	const embed = new EmbedBuilder().setColor(0xff9628).setTitle('📅 Prochains événements');
	embed.setDescription(events.length
		? events.map(e => `**${e.title}** — <t:${Math.floor(e.startsAt / 1000)}:F> (<t:${Math.floor(e.startsAt / 1000)}:R>)${e.location ? ` · 📍 ${e.location}` : ''} · ${e.counts.going}${e.capacity ? `/${e.capacity}` : ''} inscrits`).join('\n')
		: 'Aucun événement prévu pour l’instant.');
	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
