import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError } from '../../../core/errors.js';
import { startForm } from '../../components/feedback.js';

export const data = new SlashCommandBuilder()
	.setName('proposer')
	.setDescription('Faire une suggestion, signaler un bug…')
	.setContexts(InteractionContextType.Guild)
	.addStringOption(o => o.setName('boite').setDescription('Où envoyer').setRequired(true).setAutocomplete(true))
	.addBooleanOption(o => o.setName('anonyme').setDescription('Sans montrer ton nom (si la boîte le permet)'));

export async function autocomplete(interaction) {
	const typed = interaction.options.getFocused().toLowerCase();
	const boxes = interaction.client.core.feedback.boxes(interaction.guildId);
	await interaction.respond(boxes.filter(b => b.name.toLowerCase().includes(typed)).slice(0, 25).map(b => ({ name: b.name, value: String(b.id) })));
}

export async function execute(interaction) {
	try {
		await startForm(interaction, Number(interaction.options.getString('boite')), interaction.options.getBoolean('anonyme') ?? false);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.reply({ content: `Impossible : ${error.message}`, flags: MessageFlags.Ephemeral });
	}
}
