import fs from 'node:fs';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { AppError, ForbiddenError } from '../../core/errors.js';
import { showFormModal, readModal, fromEphemeralMessage } from '../forms.js';
import { addMemberMenu, closeModal, deleteConfirmPayload, nextStepPayload, ratingCommentModal } from '../ticketsUi.js';
import { errorContent } from '../userError.js';

// Discord refuses big files for bots (10 Mo without boosts): past that, the plain text is sent
const HTML_TRANSCRIPT_MAX = 9 * 1024 * 1024;

// customId: ticket:<action>:<id>[:<extra>]
export const prefix = 'ticket';

function stepTitle(category, step) {
	const { steps } = category.config.form;
	return steps[step].title || (steps.length > 1 ? `${category.name} · ${step + 1}/${steps.length}` : `Ticket · ${category.name}`);
}

async function openTicket(interaction, categoryId, answers = []) {
	const ticket = await interaction.client.core.tickets.open({
		guildId: interaction.guildId,
		userId: interaction.user.id,
		userName: interaction.user.username,
		categoryId,
		answers,
	});
	return `Ton ticket est ouvert : <#${ticket.channelId}>`;
}

// Button or menu entry of a panel: checks first, then the first modal (or opens right away)
async function start(interaction, categoryId) {
	const { tickets } = interaction.client.core;
	const { category, step } = await tickets.startOpening({ guildId: interaction.guildId, userId: interaction.user.id, categoryId });
	if (step >= 0) return showFormModal(interaction, `ticket:form:${categoryId}:${step}`, stepTitle(category, step), category.config.form.steps[step]);
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	return interaction.editReply(await openTicket(interaction, categoryId));
}

export async function execute(interaction) {
	const [, action, rawId, extra] = interaction.customId.split(':');
	const id = Number(rawId);
	const { tickets } = interaction.client.core;

	try {
		switch (action) {
		case 'open':
			return await start(interaction, id);
		case 'pick': {
			const categoryId = Number(interaction.values[0]);
			try {
				return await start(interaction, categoryId);
			}
			finally {
				// Resets the menu so the same entry can be picked again; after the answer, the modal must come within 3 s
				interaction.message.edit({ components: interaction.message.components }).catch(() => null);
			}
		}
		case 'next': {
			const step = Number(extra);
			const category = tickets.getCategory(interaction.guildId, id);
			return await showFormModal(interaction, `ticket:form:${id}:${step}`, stepTitle(category, step), category.config.form.steps[step]);
		}
		case 'form': {
			const step = Number(extra);
			const category = tickets.getCategory(interaction.guildId, id);
			const values = readModal(interaction, category.config.form.steps[step]);
			const result = tickets.submitFormStep({ guildId: interaction.guildId, userId: interaction.user.id, categoryId: id, step, values });
			if (!result.done) {
				const payload = nextStepPayload('ticket', id, result.next, result.total);
				// A modal opened from the previous "continue" message: replace it instead of stacking messages
				if (fromEphemeralMessage(interaction)) return await interaction.update(payload);
				return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
			}
			if (fromEphemeralMessage(interaction)) {
				await interaction.update({ content: 'Ouverture du ticket…', components: [] });
				return await interaction.editReply(await openTicket(interaction, id, result.answers));
			}
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			return await interaction.editReply(await openTicket(interaction, id, result.answers));
		}
		case 'claim': {
			// "Only the claimer writes" edits the channel permissions role by role: can be over 3 s
			await interaction.deferReply();
			await tickets.claim(interaction.user.id, id);
			return await interaction.editReply({ content: `Ticket pris en charge par <@${interaction.user.id}>.`, allowedMentions: { parse: [] } });
		}
		case 'add':
			return await interaction.reply({ content: 'Qui ajouter au ticket ?', components: [addMemberMenu(id)], flags: MessageFlags.Ephemeral });
		case 'addselect': {
			// Up to 5 permission edits: acknowledged first (the menu is an ephemeral message, replaced below)
			await interaction.deferUpdate();
			for (const userId of interaction.values) await tickets.addMember(interaction.user.id, id, userId);
			return await interaction.editReply({ content: `Ajouté : ${interaction.values.map(u => `<@${u}>`).join(', ')}`, components: [] });
		}
		case 'status': {
			const ticket = await tickets.setStatus(interaction.user.id, id, interaction.values[0]);
			const status = tickets.statuses(ticket.guildId).find(s => s.key === ticket.statusKey);
			await interaction.reply({ content: `Statut : ${status?.emoji ?? ''} **${status?.label ?? ticket.statusKey}** (par <@${interaction.user.id}>)`, allowedMentions: { parse: [] } });
			// Resets the menu once answered (the 3 s of the interaction are for the answer)
			return void interaction.message.edit({ components: interaction.message.components }).catch(() => null);
		}
		case 'priority': {
			const ticket = await tickets.setPriority(interaction.user.id, id, interaction.values[0]);
			const label = tickets.priorities().find(p => p.key === ticket.priority)?.label;
			await interaction.reply({ content: `Priorité : **${label}** (par <@${interaction.user.id}>)`, allowedMentions: { parse: [] } });
			return void interaction.message.edit({ components: interaction.message.components }).catch(() => null);
		}
		case 'close': {
			const { requireReason, confirm } = await tickets.closeRequirements(interaction.user.id, id);
			if (requireReason || confirm) return await interaction.showModal(closeModal(id, { requireReason }));
			await interaction.deferReply();
			await tickets.close(interaction.user.id, id, '');
			// The channel may already be deleted (no delay set)
			return await interaction.editReply('Ticket fermé.').catch(() => null);
		}
		case 'closeform': {
			await interaction.deferReply();
			await tickets.close(interaction.user.id, id, interaction.fields.getTextInputValue('reason') ?? '');
			return await interaction.editReply('Ticket fermé.').catch(() => null);
		}
		case 'creq': {
			// Answer of the opener to a close request; closing can take a while (transcript)
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const accept = extra === 'yes';
			await tickets.answerCloseRequest(interaction.user.id, id, accept);
			await interaction.message.edit({ components: [] }).catch(() => null);
			return await interaction.editReply(accept ? 'Ticket fermé. Merci !' : 'C’est noté : le staff est prévenu et revient vers toi.');
		}
		case 'reopen': {
			await interaction.deferReply();
			await tickets.reopen(interaction.user.id, id);
			return await interaction.editReply('Ticket rouvert.');
		}
		case 'delete':
			// Asked first, privately: deleting the channel cannot be undone
			return await interaction.reply({ ...deleteConfirmPayload(tickets.get(id)), flags: MessageFlags.Ephemeral });
		case 'delcancel':
			return await interaction.update({ content: 'Suppression annulée.', components: [] });
		case 'delconfirm': {
			await interaction.update({ content: 'Suppression du salon…', components: [] });
			await tickets.deleteArchived(interaction.user.id, id);
			return;
		}
		case 'transcript': {
			if (!await interaction.client.core.ranks.resolve(interaction.user.id).then(p => p.can('tickets.view'))) {
				throw new ForbiddenError('Permission manquante : tickets.view');
			}
			// The web page of the conversation (Discord look) when it was saved, else the plain text
			const html = tickets.transcriptFile(id);
			const size = html ? fs.statSync(html.file).size : 0;
			if (html && size <= HTML_TRANSCRIPT_MAX) {
				const name = `ticket-${String(html.ticket.number).padStart(4, '0')}.html`;
				return await interaction.reply({ content: 'Conversation du ticket : ouvre le fichier dans ton navigateur.', files: [new AttachmentBuilder(html.file, { name })], flags: MessageFlags.Ephemeral });
			}
			const ticket = tickets.get(id, { withTranscript: true });
			const file = new AttachmentBuilder(Buffer.from(ticket.transcript ?? '(vide)', 'utf8'), { name: `ticket-${ticket.number}.txt` });
			return await interaction.reply({ files: [file], flags: MessageFlags.Ephemeral });
		}
		case 'rate': {
			tickets.rate(interaction.user.id, id, Number(extra));
			return await interaction.update({
				content: `Merci ! Note : ${'★'.repeat(Number(extra))}${'☆'.repeat(5 - Number(extra))}`,
				components: [new ActionRowBuilder().addComponents(
					new ButtonBuilder().setCustomId(`ticket:comment:${id}`).setLabel('Ajouter un commentaire').setStyle(ButtonStyle.Secondary),
				)],
			});
		}
		case 'ratecomment': {
			tickets.rateComment(interaction.user.id, id, interaction.fields.getTextInputValue('comment') ?? '');
			return await interaction.reply({ content: 'Merci pour ton avis.', flags: MessageFlags.Ephemeral });
		}
		case 'comment':
			return await interaction.showModal(ratingCommentModal(id));
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		const content = errorContent(error);
		if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] });
		else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}
}
