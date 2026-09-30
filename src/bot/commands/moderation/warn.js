import { moderationCommand, runModeration, sanctionEmbed } from '../../moderation.js';

export const data = moderationCommand('warn', 'Avertir un membre (visible sur tout le réseau)')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true).setMaxLength(500));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const sanction = await interaction.client.core.sanctions.create(actor, {
			type: 'warn',
			userId: interaction.options.getUser('membre').id,
			reason: interaction.options.getString('raison'),
			originGuildId: interaction.guildId,
		});
		return { embeds: [sanctionEmbed(sanction)] };
	});
}
