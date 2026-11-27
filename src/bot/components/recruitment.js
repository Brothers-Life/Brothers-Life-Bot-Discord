import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { showFormModal, readModal, fromEphemeralMessage } from '../forms.js';
import { nextStepPayload } from '../ticketsUi.js';
import { actorOf } from '../moderation.js';
import { decisionModal } from '../recruitmentUi.js';

// customId: rc:<action>:<id>[:<extra>]
export const prefix = 'rc';

function title(position, step) {
	const { steps } = position.config.form;
	return steps[step].title || `${position.name} · ${step + 1}/${steps.length}`;
}

async function openForm(interaction, positionId) {
	const { recruitment } = interaction.client.core;
	const { position, step } = await recruitment.startApplication(positionId, interaction.user.id, interaction.guildId);
	return showFormModal(interaction, `rc:form:${positionId}:${step}`, title(position, step), position.config.form.steps[step]);
}

// Questions asked one by one in a private channel or in private messages, or the Discord windows
// (choice of the position, and what is offered when the member does not accept private messages)
export async function startApplication(interaction, positionId) {
	const { recruitment } = interaction.client.core;
	if ((await recruitment.getPosition(positionId)).config.mode === 'modal') return openForm(interaction, positionId);
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	const { position, sent, channelId } = await recruitment.startChat(positionId, interaction.user.id, interaction.guildId, interaction.user.username);
	if (channelId) return interaction.editReply(`📋 Ta candidature pour **${position.name}** se passe ici : <#${channelId}>`);
	if (sent) return interaction.editReply(`📬 Je t’ai envoyé les questions pour **${position.name}** en message privé : réponds-y là-bas.`);
	return interaction.editReply({
		content: 'Je n’arrive pas à t’écrire en message privé (ils sont fermés pour ce serveur). Ouvre-les puis reclique sur **Postuler**, ou remplis le formulaire ici.',
		components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rc:modal:${positionId}`).setLabel('Remplir le formulaire ici').setStyle(ButtonStyle.Secondary))],
	});
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
		case 'modal':
			return await openForm(interaction, id);
		case 'next': {
			const position = await recruitment.getPosition(id);
			const step = Number(extra);
			return await showFormModal(interaction, `rc:form:${id}:${step}`, title(position, step), position.config.form.steps[step]);
		}
		case 'form': {
			const position = await recruitment.getPosition(id);
			const step = Number(extra);
			const result = await recruitment.submitStep(id, me, step, readModal(interaction, position.config.form.steps[step]));
			if (!result.done) {
				const payload = nextStepPayload('rc', id, result.next, result.total);
				if (fromEphemeralMessage(interaction)) return await interaction.update(payload);
				return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
			}
			if (fromEphemeralMessage(interaction)) await interaction.update({ content: 'Envoi…', components: [] });
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
			const status = interaction.values[0];
			// Accept / refuse: first a modal for an optional reason sent to the candidate
			if (['accepted', 'rejected'].includes(status)) return await interaction.showModal(decisionModal(id, status));
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await recruitment.setStatus(await actorOf(interaction), id, status);
			return await interaction.editReply('Décision enregistrée : le candidat est prévenu.');
		}
		// Channel of the application: closed, reopened, deleted by the recruiters
		case 'chclose': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await recruitment.closeChannel(await actorOf(interaction), id);
			return await interaction.editReply('🔒 Salon fermé : le candidat ne le voit plus.');
		}
		case 'chopen': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await recruitment.reopenChannel(await actorOf(interaction), id);
			return await interaction.editReply('🔓 Salon rouvert.');
		}
		case 'chdel': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await recruitment.deleteChannel(await actorOf(interaction), id);
			// The channel of this reply is gone
			return await interaction.editReply('Salon supprimé.').catch(() => null);
		}
		case 'decide': {
			if (!['accepted', 'rejected'].includes(extra)) return;
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const reason = (interaction.fields.getTextInputValue('reason') ?? '').trim();
			await recruitment.setStatus(await actorOf(interaction), id, extra, { reason });
			return await interaction.editReply(extra === 'accepted' ? '✅ Candidature acceptée : le candidat est prévenu.' : '❌ Candidature refusée : le candidat est prévenu.');
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await reply(`Impossible : ${error.message}`);
	}
}
