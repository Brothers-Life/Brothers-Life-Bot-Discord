import { ChannelType, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError, ForbiddenError, ValidationError } from '../../../core/errors.js';
import { parseDuration } from '../../../core/duration.js';
import { actorOf } from '../../moderation.js';

export const data = new SlashCommandBuilder()
	.setName('giveaway')
	.setDescription('Giveaways')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('creer').setDescription('Lancer un giveaway rapide (le panel offre toutes les options)')
		.addStringOption(o => o.setName('lot').setDescription('Ce qu’on gagne').setRequired(true).setMaxLength(200))
		.addStringOption(o => o.setName('duree').setDescription('Durée (ex : 1h, 3j)').setRequired(true))
		.addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setMinValue(1).setMaxValue(50))
		.addChannelOption(o => o.setName('salon').setDescription('Salon (par défaut : celui-ci)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
	.addSubcommand(s => s.setName('finir').setDescription('Tirer au sort maintenant')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro du giveaway').setRequired(true)))
	.addSubcommand(s => s.setName('relancer').setDescription('Retirer au sort un ou plusieurs gagnants')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro du giveaway').setRequired(true))
		.addUserOption(o => o.setName('gagnant').setDescription('Gagnant à remplacer (sinon : un gagnant en plus)')))
	.addSubcommand(s => s.setName('liste').setDescription('Giveaways en cours'));

export async function execute(interaction) {
	const { giveaways } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		switch (interaction.options.getSubcommand()) {
		case 'liste': {
			const open = giveaways.list().filter(g => g.status === 'open');
			const embed = new EmbedBuilder().setColor(0xe5484d).setTitle('Giveaways en cours')
				.setDescription(open.map(g => `**#${g.id}** ${g.prize} · ${g.participants} participant(s) · fin <t:${Math.round(g.endsAt / 1000)}:R>`).join('\n') || 'Aucun giveaway en cours.');
			return await interaction.editReply({ embeds: [embed] });
		}
		case 'creer': {
			if (!actor.can('giveaways.manage')) throw new ForbiddenError('il te faut la permission de gérer les giveaways.');
			const durationMs = parseDuration(interaction.options.getString('duree'));
			if (!durationMs) throw new ValidationError('Durée invalide. Exemples : 30m, 2h, 3j.');
			const g = giveaways.create(actor, {
				prize: interaction.options.getString('lot'),
				winnersCount: interaction.options.getInteger('gagnants') ?? 1,
				endsAt: Date.now() + durationMs,
				targets: [{ guildId: interaction.guildId, channelId: interaction.options.getChannel('salon')?.id ?? interaction.channelId, ping: 'none' }],
			});
			await giveaways.publish(actor, g.id);
			return await interaction.editReply(`Giveaway #${g.id} lancé.`);
		}
		case 'finir':
			await giveaways.end(actor, interaction.options.getInteger('id'));
			return await interaction.editReply('Tirage effectué.');
		case 'relancer': {
			const winners = await giveaways.reroll(actor, interaction.options.getInteger('id'), { userId: interaction.options.getUser('gagnant')?.id ?? null });
			return await interaction.editReply(winners.length ? `Nouveau tirage : ${winners.map(id => `<@${id}>`).join(', ')}` : 'Personne d’autre ne remplit les conditions.');
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}
