import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError } from '../../../core/errors.js';
import { startApplication } from '../../components/recruitment.js';

export const data = new SlashCommandBuilder()
	.setName('candidature')
	.setDescription('Postuler dans le staff')
	.setContexts(InteractionContextType.Guild)
	.addStringOption(o => o.setName('poste').setDescription('Le poste').setRequired(true).setAutocomplete(true));

export async function autocomplete(interaction) {
	const typed = interaction.options.getFocused().toLowerCase();
	const positions = interaction.client.core.recruitment.positions(interaction.guildId).filter(p => p.config.open);
	await interaction.respond(positions.filter(p => p.name.toLowerCase().includes(typed)).slice(0, 25).map(p => ({ name: p.name, value: String(p.id) })));
}

export async function execute(interaction) {
	try {
		await startApplication(interaction, Number(interaction.options.getString('poste')));
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.reply({ content: `Impossible : ${error.message}`, flags: MessageFlags.Ephemeral });
	}
}
