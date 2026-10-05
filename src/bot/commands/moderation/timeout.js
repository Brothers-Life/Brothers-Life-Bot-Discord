import { moderationCommand, runModeration, durationOption, scopeOf, sanctionEmbed } from '../../moderation.js';

export const data = moderationCommand('timeout', 'Exclure temporairement un membre du réseau (timeout, 28 jours max)')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
	.addStringOption(o => o.setName('duree').setDescription('Durée (ex : 10m, 2h, 3j)').setRequired(true))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500))
	.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const sanction = await interaction.client.core.sanctions.create(actor, {
			type: 'timeout',
			userId: interaction.options.getUser('membre').id,
			reason: interaction.options.getString('raison') ?? '',
			durationMs: durationOption(interaction, 'duree'),
			scope: scopeOf(interaction),
			originGuildId: interaction.guildId,
		});
		return { embeds: [sanctionEmbed(sanction)] };
	});
}
