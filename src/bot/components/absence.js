import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';

// customId: abs:<approve|reject>:<absenceId>
export const prefix = 'abs';

export async function execute(interaction) {
	const [, action, id] = interaction.customId.split(':');
	const roleIds = interaction.member?.roles?.cache ? [...interaction.member.roles.cache.keys()] : interaction.member?.roles ?? [];
	// Approving gives the absence role and nickname on every server, DMs and edits messages: well over 3 s
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const absence = await interaction.client.core.absences.reviewByButton(interaction.user.id, roleIds, Number(id), action === 'approve');
		await interaction.editReply(absence.status === 'rejected' ? 'Absence refusée.' : 'Absence validée.');
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(error.message);
	}
}
