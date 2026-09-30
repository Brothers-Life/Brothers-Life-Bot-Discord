import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildEmbeds } from '../../messages.js';
import { changelogPayload } from '../../../core/changelog.js';

export const data = new SlashCommandBuilder()
	.setName('changelog')
	.setDescription('Voir les dernières nouveautés')
	.setContexts(InteractionContextType.Guild)
	.addStringOption(o => o.setName('version').setDescription('Une version précise').setMaxLength(30));

export async function execute(interaction) {
	const entry = interaction.client.core.changelog.latest(interaction.options.getString('version'));
	if (!entry) return interaction.reply({ content: 'Aucune entrée publiée pour l’instant.', flags: MessageFlags.Ephemeral });
	return interaction.reply({ embeds: buildEmbeds(changelogPayload(entry)), flags: MessageFlags.Ephemeral });
}
