import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { showFormModal, readModal } from '../forms.js';
import { nextStepPayload } from '../ticketsUi.js';
import { actorOf } from '../moderation.js';

// customId: rc:<action>:<id>[:<extra>]
export const prefix = 'rc';

function title(position, step) {
	const { steps } = position.config.form;
	return steps[step].title || `${position.name} · ${step + 1}/${steps.length}`;
}

export async function startApplication(interaction, positionId) {
	const { recruitment } = interaction.client.core;
	const { position, step } = await recruitment.startApplication(positionId, interaction.user.id, interaction.guildId);
	return showFormModal(interaction, `rc:form:${positionId}:${step}`, title(position, step), position.config.form.steps[step]);
}

export async function execute(interaction) {
	const [, action, rawId, extra] = interaction.customId.split(':');
	const id = Number(rawId);
	const { recruitment } = interaction.client.core;
	const me = interaction.user.id;
	const reply = async (content) => {
		if (interaction.deferred || interaction.replied) return interaction.editReply({ content, components: [] });
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	};
	try {
		switch (action) {
		case 'apply':
			return await startApplication(interaction, id);
		case 'next': {
			const position = recruitment.getPosition(id);
			const step = Number(extra);
			return await showFormModal(interaction, `rc:form:${id}:${step}`, title(position, step), position.config.form.steps[step]);
		}
		case 'form': {
			const position = recruitment.getPosition(id);
			const step = Number(extra);
			const result = recruitment.submitStep(id, me, step, readModal(interaction, position.config.form.steps[step]));
			if (!result.done) {
				const payload = nextStepPayload('rc', id, result.next, result.total);
				if (interaction.isFromMessage?.()) return await interaction.update(payload);
				return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
			}
			if (interaction.isFromMessage?.()) await interaction.update({ content: 'Envoi…', components: [] });
			else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await recruitment.submit({ positionId: id, guildId: interaction.guildId, userId: me, userName: interaction.user.username, answers: result.answers });
			return await interaction.editReply({ content: 'Candidature envoyée ! Tu recevras la réponse en message privé.', components: [] });
		}
		case 'vote': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await recruitment.vote(me, id, Number(extra));
			return await interaction.editReply('Vote enregistré.');
		}
		case 'status': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await recruitment.setStatus(await actorOf(interaction), id, interaction.values[0]);
			return await interaction.editReply('Décision enregistrée : le candidat est prévenu.');
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await reply(`Impossible : ${error.message}`);
	}
}
