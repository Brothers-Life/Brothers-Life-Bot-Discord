import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { addMemberMenu, closeModal, openModal } from '../ticketsUi.js';

// customId: ticket:<action>:<id>
export const prefix = 'ticket';

export async function execute(interaction) {
	const [, action, rawId] = interaction.customId.split(':');
	const id = Number(rawId);
	const { tickets } = interaction.client.core;

	try {
		switch (action) {
		case 'open': {
			const category = tickets.describe(interaction.guildId).categories.find(c => c.id === id);
			if (!category) throw new AppError('NOT_FOUND', 'Cette catégorie de tickets n’existe plus.');
			return await interaction.showModal(openModal(id, category.name));
		}
		case 'openform': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const ticket = await tickets.open({
				guildId: interaction.guildId,
				userId: interaction.user.id,
				userName: interaction.user.username,
				categoryId: id,
				subject: interaction.fields.getTextInputValue('subject'),
			});
			return await interaction.editReply(`Ton ticket est ouvert : <#${ticket.channelId}>`);
		}
		case 'claim': {
			await tickets.claim(interaction.user.id, id);
			return await interaction.reply({ content: `Ticket pris en charge par <@${interaction.user.id}>.`, allowedMentions: { parse: [] } });
		}
		case 'add':
			return await interaction.reply({ content: 'Qui ajouter au ticket ?', components: [addMemberMenu(id)], flags: MessageFlags.Ephemeral });
		case 'addselect': {
			for (const userId of interaction.values) await tickets.addMember(interaction.user.id, id, userId);
			return await interaction.update({ content: `Ajouté : ${interaction.values.map(u => `<@${u}>`).join(', ')}`, components: [] });
		}
		case 'close':
			return await interaction.showModal(closeModal(id));
		case 'closeform': {
			await interaction.deferReply();
			await tickets.close(interaction.user.id, id, interaction.fields.getTextInputValue('reason') ?? '');
			return await interaction.editReply('Ticket fermé. Le salon sera supprimé dans 10 secondes.');
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		const payload = { content: `Impossible : ${error.message}`, flags: MessageFlags.Ephemeral };
		if (interaction.deferred || interaction.replied) await interaction.editReply({ content: payload.content });
		else await interaction.reply(payload);
	}
}
