import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';

// customId: giveaway:<join|claim>:<giveawayId>
export const prefix = 'giveaway';

export async function execute(interaction) {
	const [, action, rawId] = interaction.customId.split(':');
	const { giveaways } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const result = action === 'claim'
			? giveaways.claim(Number(rawId), interaction.user.id)
			: await giveaways.toggleEntry(Number(rawId), interaction.user.id, interaction.guildId);
		await interaction.editReply(result.message);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(error.message);
	}
}
