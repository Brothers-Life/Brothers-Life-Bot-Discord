import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';

// customId: rules:accept
export const prefix = 'rules';

export async function execute(interaction) {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const result = await interaction.client.core.onboarding.acceptRules(interaction.guildId, interaction.user.id);
		await interaction.editReply(result.message);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(error.message);
	}
}
