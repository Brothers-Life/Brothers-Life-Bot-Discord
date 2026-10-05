import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { rejectModal } from '../absencesUi.js';

// customId: abs:<approve|reject>:<absenceId> (buttons) · abs:rejectform:<absenceId> (modal of the refusal)
export const prefix = 'abs';

export async function execute(interaction) {
	const [, action, id] = interaction.customId.split(':');
	const roleIds = interaction.member?.roles?.cache ? [...interaction.member.roles.cache.keys()] : interaction.member?.roles ?? [];
	const { absences } = interaction.client.core;
	try {
		// Refusing: the modal opens only for those allowed to decide
		if (action === 'reject') {
			await absences.assertCanReviewByButton(interaction.user.id, roleIds, Number(id));
			return await interaction.showModal(rejectModal(Number(id)));
		}
		// Approving gives the absence role and nickname on every server, DMs and edits messages: well over 3 s
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const reason = action === 'rejectform' ? (interaction.fields.getTextInputValue('reason') ?? '').trim() : '';
		const absence = await absences.reviewByButton(interaction.user.id, roleIds, Number(id), action === 'approve', reason);
		let text = 'Absence validée.';
		if (absence.status === 'rejected') text = 'Absence refusée, la personne est prévenue.';
		else if (absence.status === 'ended') text = 'Absence validée, mais elle est déjà terminée : rien n’a été appliqué ni annoncé.';
		await interaction.editReply(text);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		if (interaction.deferred || interaction.replied) await interaction.editReply(error.message);
		else await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
	}
}
