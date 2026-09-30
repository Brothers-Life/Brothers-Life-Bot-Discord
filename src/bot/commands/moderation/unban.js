import { moderationCommand, runModeration, scopeOf, sanctionEmbed, resultsLine } from '../../moderation.js';

export const data = moderationCommand('unban', 'Débannir un utilisateur du réseau')
	.addStringOption(o => o.setName('id').setDescription('ID Discord de l’utilisateur').setRequired(true))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500))
	.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const result = await interaction.client.core.sanctions.unbanUser(actor, interaction.options.getString('id').trim(), interaction.options.getString('raison') ?? '', {
			scope: scopeOf(interaction),
			originGuildId: interaction.guildId,
		});
		if (result.id) return { embeds: [sanctionEmbed(result, { revoked: true })] };
		return { content: `Débanni. ${resultsLine(result.results) ?? ''}` };
	});
}
