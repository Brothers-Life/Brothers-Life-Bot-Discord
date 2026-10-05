import { MessageFlags, SlashCommandBuilder } from 'discord.js';

// Cheap to spam: the only command with a cooldown by default
export const cooldown = 3;

export const data = new SlashCommandBuilder()
	.setName('ping')
	.setDescription('Latence du bot');

export async function execute(interaction) {
	const ping = interaction.client.ws.ping;
	await interaction.reply({ content: `Latence : ${ping >= 0 ? `${ping} ms` : 'en cours de mesure, réessaie dans un instant'}`, flags: MessageFlags.Ephemeral });
}
