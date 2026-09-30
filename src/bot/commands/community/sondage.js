import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError, ForbiddenError } from '../../../core/errors.js';
import { parseDuration } from '../../../core/duration.js';
import { actorOf } from '../../moderation.js';

export const data = new SlashCommandBuilder()
	.setName('sondage')
	.setDescription('Sondages')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('creer').setDescription('Créer un sondage rapide dans ce salon')
		.addStringOption(o => o.setName('question').setDescription('La question').setRequired(true).setMaxLength(250))
		.addStringOption(o => o.setName('choix').setDescription('Les choix, séparés par des ; (ex : Oui;Non;Peut-être)').setRequired(true).setMaxLength(1500))
		.addStringOption(o => o.setName('duree').setDescription('Durée (ex : 1h, 2j). Vide = jusqu’à fermeture'))
		.addBooleanOption(o => o.setName('multiple').setDescription('Plusieurs choix possibles'))
		.addBooleanOption(o => o.setName('public').setDescription('Montrer qui a voté')))
	.addSubcommand(s => s.setName('fermer').setDescription('Fermer un sondage')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro du sondage (dans le panel)').setRequired(true)));

export async function execute(interaction) {
	const { polls } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		if (!actor.can('polls.manage')) throw new ForbiddenError('il te faut la permission de gérer les sondages.');
		if (interaction.options.getSubcommand() === 'fermer') {
			await polls.close(actor, interaction.options.getInteger('id'));
			return await interaction.editReply('Sondage fermé.');
		}
		const raw = interaction.options.getString('duree');
		const durationMs = raw ? parseDuration(raw) : null;
		if (raw && !durationMs) throw new AppError('VALIDATION', `Durée invalide : « ${raw} ».`);
		const poll = polls.create(actor, {
			question: interaction.options.getString('question'),
			options: interaction.options.getString('choix').split(';').map(label => ({ label: label.trim() })),
			settings: { multiple: interaction.options.getBoolean('multiple') ?? false, anonymous: !(interaction.options.getBoolean('public') ?? false) },
			targets: [{ guildId: interaction.guildId, channelId: interaction.channelId, ping: 'none' }],
			endsAt: durationMs ? Date.now() + durationMs : null,
		});
		await polls.publish(actor, poll.id);
		return await interaction.editReply(`Sondage #${poll.id} publié.`);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}
