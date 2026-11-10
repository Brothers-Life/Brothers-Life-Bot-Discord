import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { showFormModal, readModal, fromEphemeralMessage } from '../forms.js';
import { nextStepPayload } from '../ticketsUi.js';
import { leaveRow, takeoverPickerPayload } from '../takeoversUi.js';

// customId: to:<action>:<id>[:<step>], to:list:<category id, 0 = none>:<type>:<server of the takeovers>, to:pick:<n>
export const prefix = 'to';

const REGISTERED = 'Inscription enregistrée. Tu recevras un MP quand les entretiens commenceront.';
const stepTitle = (takeover, form, step) => form.steps[step].title || `${takeover.name} · ${step + 1}/${form.steps.length}`.slice(0, 45);

// `answer` replaces the list when the choice comes from it, or replies when it comes from an older panel
async function join(interaction, id, answer) {
	const { takeovers } = interaction.client.core;
	const me = interaction.user;
	const { takeover, already, form, step } = await takeovers.start(id, me.id, interaction.guildId);
	if (already) return await answer({ content: `Tu es déjà inscrit à la reprise de **${takeover.name}**.`, components: [leaveRow(id)] });
	if (step === null) {
		await takeovers.register({ id, guildId: interaction.guildId, userId: me.id, userName: me.username });
		return await answer({ content: REGISTERED, components: [leaveRow(id)] });
	}
	return await showFormModal(interaction, `to:form:${id}:${step}`, stepTitle(takeover, form, step), form.steps[step]);
}

export async function execute(interaction) {
	const [, action, rawId, extra, home] = interaction.customId.split(':');
	const id = Number(rawId);
	const { takeovers } = interaction.client.core;
	const me = interaction.user;
	try {
		switch (action) {
		case 'list': {
			const { name, takeovers: open } = await takeovers.openIn(home, interaction.guildId, extra, id);
			return await interaction.reply({ ...takeoverPickerPayload({ name, takeovers: open }), flags: MessageFlags.Ephemeral });
		}
		case 'pick':
			return await join(interaction, Number(interaction.values[0]), payload => interaction.update(payload));
		case 'join':
			return await join(interaction, id, payload => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }));
		case 'next': {
			const takeover = await takeovers.getTakeover(id);
			const form = await takeovers.formOf(takeover);
			const step = Number(extra);
			return await showFormModal(interaction, `to:form:${id}:${step}`, stepTitle(takeover, form, step), form.steps[step]);
		}
		case 'form': {
			const form = await takeovers.formOf(await takeovers.getTakeover(id));
			const step = Number(extra);
			const result = await takeovers.submitStep(id, me.id, step, readModal(interaction, form.steps[step]));
			if (!result.done) {
				const payload = nextStepPayload('to', id, result.next, result.total);
				if (fromEphemeralMessage(interaction)) return await interaction.update(payload);
				return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
			}
			if (fromEphemeralMessage(interaction)) await interaction.update({ content: 'Envoi…', components: [] });
			else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await takeovers.register({ id, guildId: interaction.guildId, userId: me.id, userName: me.username, answers: result.answers });
			return await interaction.editReply({ content: REGISTERED, components: [leaveRow(id)] });
		}
		case 'leave':
			await takeovers.leave(id, me.id);
			return await interaction.update({ content: 'Inscription retirée.', components: [] });
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		const content = `Impossible : ${error.message}`;
		if (interaction.deferred || interaction.replied) return interaction.editReply({ content, components: [] });
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}
}
