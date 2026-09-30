import { moderationCommand, runModeration, durationOption, scopeOf, sanctionEmbed } from '../../moderation.js';

export const data = moderationCommand('ban', 'Bannir un membre du réseau (ou de ce serveur)')
	.addUserOption(o => o.setName('membre').setDescription('Membre à bannir').setRequired(true))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500))
	.addStringOption(o => o.setName('duree').setDescription('Durée (ex : 7j, 12h). Vide = définitif'))
	.addIntegerOption(o => o.setName('supprimer_messages').setDescription('Supprimer ses messages récents').addChoices(
		{ name: 'Rien', value: 0 },
		{ name: 'Dernière heure', value: 3600 },
		{ name: '24 dernières heures', value: 86400 },
		{ name: '7 derniers jours', value: 604800 },
	))
	.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const sanction = await interaction.client.core.sanctions.create(actor, {
			type: 'ban',
			userId: interaction.options.getUser('membre').id,
			reason: interaction.options.getString('raison') ?? '',
			durationMs: durationOption(interaction, 'duree'),
			scope: scopeOf(interaction),
			originGuildId: interaction.guildId,
			deleteMessageSeconds: interaction.options.getInteger('supprimer_messages') ?? 0,
		});
		return { embeds: [sanctionEmbed(sanction)] };
	});
}
