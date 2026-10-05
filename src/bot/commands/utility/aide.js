import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { commandsFor } from '../../../core/commandCatalog.js';

export const cooldown = 3;

export const data = new SlashCommandBuilder()
	.setName('aide')
	.setDescription('Les commandes que tu peux utiliser')
	.setContexts(InteractionContextType.Guild);

// Embed of the commands someone may use, grouped by category (fields of 1024 characters max)
export function helpEmbed(can) {
	const groups = new Map();
	for (const command of commandsFor(can)) {
		if (!groups.has(command.category)) groups.set(command.category, []);
		groups.get(command.category).push(`**/${command.name}** · ${command.description}`);
	}
	const embed = new EmbedBuilder()
		.setColor(0xff9628)
		.setTitle('Tes commandes')
		.setDescription('Tape `/` puis le nom d’une commande : Discord te propose ses options.');
	for (const [category, lines] of [...groups].slice(0, 25)) {
		let value = '';
		for (const line of lines) {
			const next = value ? `${value}\n${line}` : line;
			if (next.length > 1024) break;
			value = next;
		}
		embed.addFields({ name: category, value });
	}
	return embed;
}

export async function execute(interaction) {
	const principal = await interaction.client.core.ranks.resolve(interaction.user.id);
	await interaction.reply({ embeds: [helpEmbed(p => principal.can(p))], flags: MessageFlags.Ephemeral });
}
