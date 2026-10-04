import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError, ForbiddenError, ValidationError } from '../../../core/errors.js';
import { actorOf } from '../../moderation.js';
import { hours, playerPayload } from '../../fivemDataUi.js';

export const data = new SlashCommandBuilder()
	.setName('joueur')
	.setDescription('Fiche FiveM d’un joueur : personnages, métier, temps de jeu, véhicules, sanctions')
	.setContexts(InteractionContextType.Guild)
	.addUserOption(o => o.setName('membre').setDescription('Membre Discord (compte FiveM lié)'))
	.addStringOption(o => o.setName('recherche').setDescription('Nom RP, pseudo, citizen ID, téléphone ou plaque').setAutocomplete(true).setMaxLength(100));

export async function autocomplete(interaction) {
	const actor = await actorOf(interaction);
	if (!actor.can('fivemdata.view')) return interaction.respond([]);
	const list = await interaction.client.core.fivemData.search(actor, interaction.options.getFocused(), 25).catch(() => []);
	await interaction.respond(list.map(p => ({
		name: `${p.online ? '🟢 ' : ''}${p.username} · ${p.characters.map(c => c.name).join(', ') || 'aucun perso'} · ${hours(p.playSeconds)}`.slice(0, 100),
		value: String(p.userId),
	})));
}

export async function execute(interaction) {
	const { fivemData } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		// Before any lookup: whether a member has a linked FiveM account is itself private
		if (!actor.can('fivemdata.view')) throw new ForbiddenError('Permission manquante : fivemdata.view');
		const member = interaction.options.getUser('membre');
		const search = interaction.options.getString('recherche');
		let userId = null;
		if (member) {
			userId = await fivemData.findByDiscord(member.id);
			if (!userId) throw new ValidationError(`${member.username} n’a pas de compte FiveM lié à son Discord.`);
		}
		else if (search) {
			userId = /^\d+$/.test(search) && search.length < 10 ? Number(search) : (await fivemData.search(actor, search, 1))[0]?.userId;
			if (!userId) throw new ValidationError('Aucun joueur trouvé.');
		}
		else {
			userId = await fivemData.findByDiscord(interaction.user.id);
			if (!userId) throw new ValidationError('Choisis un membre ou fais une recherche.');
		}
		await interaction.editReply({ ...playerPayload(await fivemData.player(actor, userId)), allowedMentions: { parse: [] } });
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}
