import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { formModal, readModal } from '../forms.js';
import { nextStepPayload } from '../ticketsUi.js';

// customId: fb:<action>:<id>[:<step>]
export const prefix = 'fb';

function title(box, step) {
	const { steps } = box.config.form;
	return steps[step].title || (steps.length > 1 ? `${box.name} · ${step + 1}/${steps.length}` : box.name);
}

export async function startForm(interaction, boxId, anonymous = false) {
	const { feedback } = interaction.client.core;
	const { box, step } = await feedback.startSubmit(boxId, interaction.user.id, interaction.guildId, { anonymous });
	return interaction.showModal(formModal(`fb:form:${boxId}:${step}`, title(box, step), box.config.form.steps[step]));
}

export async function execute(interaction) {
	const [, action, rawId, extra] = interaction.customId.split(':');
	const id = Number(rawId);
	const { feedback } = interaction.client.core;
	const me = interaction.user.id;
	const reply = async (content) => {
		if (interaction.deferred || interaction.replied) return interaction.editReply({ content, components: [] });
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	};

	try {
		switch (action) {
		case 'open':
		case 'openanon':
			return await startForm(interaction, id, action === 'openanon');
		case 'next': {
			const box = feedback.getBox(id);
			const step = Number(extra);
			return await interaction.showModal(formModal(`fb:form:${id}:${step}`, title(box, step), box.config.form.steps[step]));
		}
		case 'form': {
			const box = feedback.getBox(id);
			const step = Number(extra);
			const result = feedback.submitStep(id, me, step, readModal(interaction, box.config.form.steps[step]));
			if (!result.done) {
				const payload = nextStepPayload('fb', id, result.next, result.total);
				if (interaction.isFromMessage?.()) return await interaction.update(payload);
				return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
			}
			if (interaction.isFromMessage?.()) await interaction.update({ content: 'Envoi…', components: [] });
			else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const item = await feedback.create({ boxId: id, guildId: interaction.guildId, userId: me, userName: interaction.user.username, answers: result.answers, anonymous: result.anonymous });
			return await interaction.editReply({ content: item.approved ? `Merci ! C’est publié (#${item.number}).` : 'Merci ! Le staff va le relire avant publication.', components: [] });
		}
		case 'up':
		case 'down': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const { removed } = await feedback.vote(id, me, action === 'up' ? 1 : -1);
			return await interaction.editReply(removed ? 'Vote retiré.' : 'Vote enregistré.');
		}
		case 'status': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await feedback.setStatus(me, id, interaction.values[0]);
			return await interaction.editReply('Statut changé. Ajoute une réponse depuis le panel si besoin.');
		}
		case 'assign': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await feedback.assign(me, id);
			return await interaction.editReply('C’est noté, tu t’en occupes.');
		}
		case 'approve':
		case 'deny': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await feedback.review(me, id, action === 'approve');
			return await interaction.editReply(action === 'approve' ? 'Publié.' : 'Refusé : l’auteur est prévenu.');
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await reply(`Impossible : ${error.message}`);
	}
}
