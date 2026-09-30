import { moderationCommand, runModeration, scopeOf, sanctionEmbed } from '../../moderation.js';

export const data = moderationCommand('kick', 'Expulser un membre du réseau (ou de ce serveur)')
	.addUserOption(o => o.setName('membre').setDescription('Membre à expulser').setRequired(true))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500))
	.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const sanction = await interaction.client.core.sanctions.create(actor, {
			type: 'kick',
			userId: interaction.options.getUser('membre').id,
			reason: interaction.options.getString('raison') ?? '',
			scope: scopeOf(interaction),
			originGuildId: interaction.guildId,
		});
		return { embeds: [sanctionEmbed(sanction)] };
	});
}
