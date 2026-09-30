import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';

// customId: abs:<approve|reject>:<absenceId>
export const prefix = 'abs';

export async function execute(interaction) {
	const [, action, id] = interaction.customId.split(':');
	const roleIds = interaction.member?.roles?.cache ? [...interaction.member.roles.cache.keys()] : interaction.member?.roles ?? [];
	try {
		const absence = await interaction.client.core.absences.reviewByButton(interaction.user.id, roleIds, Number(id), action === 'approve');
		await interaction.reply({ content: absence.status === 'rejected' ? 'Absence refusée.' : 'Absence validée.', flags: MessageFlags.Ephemeral });
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
	}
}
