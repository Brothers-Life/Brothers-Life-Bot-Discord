import { moderationCommand, runModeration, scopeOf, sanctionEmbed, resultsLine } from '../../moderation.js';

export const data = moderationCommand('untimeout', 'Lever le timeout d’un membre (réseau ou ce serveur)')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500))
	.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const result = await interaction.client.core.sanctions.untimeoutUser(actor, interaction.options.getUser('membre').id, interaction.options.getString('raison') ?? '', {
			scope: scopeOf(interaction),
			originGuildId: interaction.guildId,
		});
		if (result.id) return { embeds: [sanctionEmbed(result, { revoked: true })] };
		return { content: `Timeout levé. ${resultsLine(result.results) ?? ''}` };
	});
}
