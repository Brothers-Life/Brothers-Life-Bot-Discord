import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';

// customId: rpev:<going|maybe|leave>:<eventId>
export const prefix = 'rpev';

const ANSWERS = {
	going: '✅ Tu es inscrit. Un rappel t’arrivera en MP avant le début.',
	waitlist: '⏳ C’est complet : tu es sur la liste d’attente, tu seras prévenu si une place se libère.',
	maybe: '🤔 Noté en « peut-être ».',
	null: 'Tu n’es plus inscrit.',
};

export async function execute(interaction) {
	const [, choice, id] = interaction.customId.split(':');
	try {
		const { status } = await interaction.client.core.rpEvents.rsvp(interaction.user.id, Number(id), choice);
		await interaction.reply({ content: ANSWERS[status], flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
	}
}
