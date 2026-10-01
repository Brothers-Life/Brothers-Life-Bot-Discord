import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { actorOf } from '../moderation.js';
import { appealModal, decisionModal } from '../appealsUi.js';

// customId: appeal:<open|submit>:<sanctionId> (DM of the sanction) · appeal:<accept|reject|acceptform|rejectform>:<appealId> (staff)
export const prefix = 'appeal';

export async function execute(interaction) {
	const [, action, rawId] = interaction.customId.split(':');
	const id = Number(rawId);
	const { appeals } = interaction.client.core;
	const reply = async (content) => {
		if (interaction.deferred || interaction.replied) return interaction.editReply({ content });
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	};
	try {
		switch (action) {
		case 'open': {
			const { questions } = appeals.start(interaction.user.id, id);
			return await interaction.showModal(appealModal(id, questions));
		}
		case 'submit': {
			await interaction.deferReply({ flags: interaction.inGuild() ? MessageFlags.Ephemeral : undefined });
			const answers = [0, 1, 2, 3, 4].map(i => interaction.fields.fields.has(`a${i}`) ? interaction.fields.getTextInputValue(`a${i}`) : '');
			await appeals.submit(interaction.user.id, id, answers);
			return await reply('📨 Ton appel est envoyé au staff. Tu recevras la réponse ici, en message privé.');
		}
		case 'accept':
		case 'reject':
			return await interaction.showModal(decisionModal(id, action === 'accept'));
		case 'acceptform':
		case 'rejectform': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const actor = await actorOf(interaction);
			const done = await appeals.decide(actor, id, action === 'acceptform', interaction.fields.getTextInputValue('reason'));
			return await reply(done.status === 'accepted' ? '✅ Appel accepté : la sanction est levée et la personne est prévenue.' : '❌ Appel refusé, la personne est prévenue.');
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await reply(error.message);
	}
}
