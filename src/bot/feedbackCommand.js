import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError } from '../core/errors.js';
import { startForm } from './components/feedback.js';

// /proposer (suggestion boxes) and /bug (bug boxes) share everything but the type of box they list
export function feedbackCommand({ name, description, type, nothing }) {
	const data = new SlashCommandBuilder()
		.setName(name)
		.setDescription(description)
		.setContexts(InteractionContextType.Guild)
		.addStringOption(o => o.setName('boite').setDescription('Où l’envoyer (inutile s’il n’y en a qu’une)').setAutocomplete(true))
		.addBooleanOption(o => o.setName('anonyme').setDescription('Sans montrer ton nom au public (si la boîte le permet)'));

	async function autocomplete(interaction) {
		const typed = interaction.options.getFocused().toLowerCase();
		const boxes = await interaction.client.core.feedback.boxesFor(interaction.guildId, type, interaction.user.id);
		await interaction.respond(boxes.filter(b => b.name.toLowerCase().includes(typed)).slice(0, 25).map(b => ({ name: b.name, value: String(b.id) })));
	}

	async function execute(interaction) {
		try {
			const boxes = await interaction.client.core.feedback.boxesFor(interaction.guildId, type, interaction.user.id);
			const chosen = interaction.options.getString('boite');
			let box = chosen ? boxes.find(b => String(b.id) === chosen) : null;
			if (chosen && !box) throw new AppError('VALIDATION', 'choisis une boîte dans la liste.');
			if (!box) {
				if (!boxes.length) throw new AppError('VALIDATION', nothing);
				// Several boxes: the member says which one (the staff may see their internal bug box as well)
				if (boxes.length > 1) throw new AppError('VALIDATION', `il y en a plusieurs ici, précise l’option « boite » : ${boxes.map(b => `**${b.name}**`).join(', ')}.`);
				box = boxes[0];
			}
			await startForm(interaction, box.id, interaction.options.getBoolean('anonyme') ?? false);
		}
		catch (error) {
			if (!(error instanceof AppError)) throw error;
			await interaction.reply({ content: `Impossible : ${error.message}`, flags: MessageFlags.Ephemeral });
		}
	}

	return { data, autocomplete, execute };
}
