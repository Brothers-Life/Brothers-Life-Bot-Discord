import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { absenceModal } from '../meetingsUi.js';

// customId: mtg:<yes|maybe|no|noform>:<meetingId> (convocation in the staff channel and in DM)
export const prefix = 'mtg';

const ANSWERS = { yes: '✅ Noté : tu seras présent.', maybe: '🤔 Noté : peut-être.', no: '❌ Noté : absent, le staff a ta raison.' };

export async function execute(interaction) {
	const [, action, rawId] = interaction.customId.split(':');
	const id = Number(rawId);
	const { meetings } = interaction.client.core;
	const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
	try {
		if (action === 'no') return await interaction.showModal(absenceModal(id));
		const answer = action === 'noform' ? 'no' : action;
		await meetings.rsvp(interaction.user.id, id, answer, action === 'noform' ? interaction.fields.getTextInputValue('reason') : '');
		await reply(ANSWERS[answer]);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await reply(error.message);
	}
}
