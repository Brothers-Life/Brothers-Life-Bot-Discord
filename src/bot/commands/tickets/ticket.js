import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError, ValidationError } from '../../../core/errors.js';

export const data = new SlashCommandBuilder()
	.setName('ticket')
	.setDescription('Gérer le ticket de ce salon')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('ajouter').setDescription('Ajouter un membre au ticket')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
	.addSubcommand(s => s.setName('retirer').setDescription('Retirer un membre du ticket')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
	.addSubcommand(s => s.setName('renommer').setDescription('Renommer le salon du ticket')
		.addStringOption(o => o.setName('nom').setDescription('Nouveau nom').setRequired(true).setMaxLength(90)))
	.addSubcommand(s => s.setName('transferer').setDescription('Confier le ticket à un autre membre du staff')
		.addUserOption(o => o.setName('membre').setDescription('Membre du staff').setRequired(true)))
	.addSubcommand(s => s.setName('statut').setDescription('Changer le statut du ticket')
		.addStringOption(o => o.setName('statut').setDescription('Statut').setRequired(true).setAutocomplete(true)))
	.addSubcommand(s => s.setName('priorite').setDescription('Changer la priorité du ticket')
		.addStringOption(o => o.setName('priorite').setDescription('Priorité').setRequired(true).addChoices(
			{ name: 'Basse', value: 'low' }, { name: 'Normale', value: 'normal' }, { name: 'Haute', value: 'high' }, { name: 'Urgente', value: 'urgent' },
		)))
	.addSubcommand(s => s.setName('prendre').setDescription('Prendre le ticket en charge'))
	.addSubcommand(s => s.setName('fermer').setDescription('Fermer le ticket')
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(200)))
	.addSubcommand(s => s.setName('rouvrir').setDescription('Rouvrir un ticket archivé'))
	.addSubcommand(s => s.setName('demande-fermeture').setDescription('Demander au membre si son ticket peut être fermé')
		.addStringOption(o => o.setName('raison').setDescription('Raison affichée au membre').setMaxLength(200)))
	.addSubcommand(s => s.setName('reponse').setDescription('Envoyer une réponse enregistrée dans le ticket')
		.addStringOption(o => o.setName('nom').setDescription('Réponse enregistrée').setRequired(true).setAutocomplete(true)));

export async function autocomplete(interaction) {
	const focused = interaction.options.getFocused(true);
	const typed = String(focused.value ?? '').toLowerCase();
	if (focused.name === 'nom') {
		const ticket = interaction.client.core.tickets.findByChannel(interaction.channelId);
		const replies = ticket ? interaction.client.core.tickets.ticketReplies(ticket.id) : [];
		return interaction.respond(replies.filter(r => r.name.toLowerCase().includes(typed)).slice(0, 25).map(r => ({ name: r.name.slice(0, 100), value: String(r.id) })));
	}
	const statuses = interaction.client.core.tickets.statuses(interaction.guildId).filter(s => s.key !== 'closed');
	await interaction.respond(statuses.filter(s => s.label.toLowerCase().includes(typed)).slice(0, 25).map(s => ({ name: `${s.emoji ?? ''} ${s.label}`.trim(), value: s.key })));
}

export async function execute(interaction) {
	const { tickets } = interaction.client.core;
	const sub = interaction.options.getSubcommand();
	const ticket = tickets.findByChannel(interaction.channelId, { includeClosed: sub === 'rouvrir' });
	if (!ticket) return interaction.reply({ content: 'Cette commande s’utilise dans le salon d’un ticket.', flags: MessageFlags.Ephemeral });
	const me = interaction.user.id;
	const member = interaction.options.getUser('membre');

	try {
		switch (sub) {
		case 'ajouter':
			await tickets.addMember(me, ticket.id, member.id);
			return await interaction.reply({ content: `<@${member.id}> a été ajouté au ticket.`, allowedMentions: { users: [member.id] } });
		case 'retirer':
			await tickets.removeMember(me, ticket.id, member.id);
			return await interaction.reply({ content: `<@${member.id}> a été retiré du ticket.`, allowedMentions: { parse: [] } });
		case 'renommer': {
			const name = await tickets.rename(me, ticket.id, interaction.options.getString('nom'));
			return await interaction.reply({ content: `Salon renommé : ${name}`, flags: MessageFlags.Ephemeral });
		}
		case 'transferer':
			await tickets.transfer(me, ticket.id, member.id);
			return await interaction.reply({ content: `Ticket confié à <@${member.id}>.`, allowedMentions: { users: [member.id] } });
		case 'statut': {
			const updated = await tickets.setStatus(me, ticket.id, interaction.options.getString('statut'));
			const status = tickets.statuses(updated.guildId).find(s => s.key === updated.statusKey);
			return await interaction.reply({ content: `Statut : ${status?.emoji ?? ''} **${status?.label}**`, allowedMentions: { parse: [] } });
		}
		case 'priorite': {
			const updated = await tickets.setPriority(me, ticket.id, interaction.options.getString('priorite'));
			return await interaction.reply({ content: `Priorité : **${tickets.priorities().find(p => p.key === updated.priority)?.label}**` });
		}
		case 'prendre':
			await tickets.claim(me, ticket.id);
			return await interaction.reply({ content: `Ticket pris en charge par <@${me}>.`, allowedMentions: { parse: [] } });
		case 'fermer': {
			await interaction.deferReply();
			await tickets.close(me, ticket.id, interaction.options.getString('raison') ?? '');
			return await interaction.editReply('Ticket fermé.');
		}
		case 'demande-fermeture': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			await tickets.requestClose(me, ticket.id, interaction.options.getString('raison') ?? '');
			return await interaction.editReply('Demande envoyée au membre.');
		}
		case 'reponse': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const replyId = Number(interaction.options.getString('nom'));
			if (!Number.isInteger(replyId)) throw new ValidationError('Choisis une réponse dans la liste.');
			await tickets.sendSavedReply(me, ticket.id, replyId);
			return await interaction.editReply('Réponse envoyée.');
		}
		case 'rouvrir': {
			if (ticket.status !== 'closed') throw new ValidationError('Ce ticket est déjà ouvert.');
			await interaction.deferReply();
			await tickets.reopen(me, ticket.id);
			return await interaction.editReply('Ticket rouvert.');
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		const content = `Impossible : ${error.message}`;
		if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
		else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}
}
