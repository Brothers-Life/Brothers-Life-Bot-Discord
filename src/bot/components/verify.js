import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { captchaModal, captchaPayload } from '../channelsUi.js';
import { fromEphemeralMessage } from '../forms.js';

// customId: verify:<start|code|answer>
export const prefix = 'verify';

export async function execute(interaction) {
	const [, action] = interaction.customId.split(':');
	const { verification } = interaction.client.core;
	const guildId = interaction.guildId;
	const userId = interaction.user.id;
	const answer = async (payload) => {
		if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
		return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
	};
	try {
		switch (action) {
		case 'start': {
			// From the captcha message itself ("Autre image"): that message is replaced
			const fromCaptcha = interaction.message?.flags?.has(MessageFlags.Ephemeral);
			if (fromCaptcha) await interaction.deferUpdate();
			else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const result = await verification.start(guildId, userId, { accountCreatedAt: interaction.user.createdTimestamp });
			if (result.verified) return await interaction.editReply({ content: '✅ Vérifié, bienvenue ! Les salons du serveur s’ouvrent à toi.', files: [], components: [], attachments: [] });
			return await interaction.editReply({ ...captchaPayload(result.code), attachments: [] });
		}
		case 'code':
			return await interaction.showModal(captchaModal());
		case 'answer': {
			await verification.answer(guildId, userId, interaction.fields.getTextInputValue('code'));
			if (fromEphemeralMessage(interaction)) return await interaction.update({ content: '✅ Vérifié, bienvenue ! Les salons du serveur s’ouvrent à toi.', files: [], components: [], attachments: [] });
			return await answer({ content: '✅ Vérifié, bienvenue !' });
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await answer({ content: error.message, components: [], files: [] }).catch(() => undefined);
	}
}
