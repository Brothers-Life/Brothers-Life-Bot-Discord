import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('clear', 'Supprimer des messages récents de ce salon')
	.addIntegerOption(o => o.setName('nombre').setDescription('Nombre de messages (1 à 500)').setRequired(true).setMinValue(1).setMaxValue(500))
	.addUserOption(o => o.setName('membre').setDescription('Seulement les messages de ce membre'))
	.addStringOption(o => o.setName('contient').setDescription('Seulement les messages contenant ce texte').setMaxLength(100))
	.addBooleanOption(o => o.setName('bots').setDescription('Seulement les messages des bots'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const deleted = await interaction.client.core.moderation.clear(actor, {
			guildId: interaction.guildId,
			channelId: interaction.channelId,
			count: interaction.options.getInteger('nombre'),
			userId: interaction.options.getUser('membre')?.id ?? null,
			contains: interaction.options.getString('contient'),
			botsOnly: interaction.options.getBoolean('bots') ?? false,
		});
		return { content: `${deleted} message${deleted > 1 ? 's' : ''} supprimé${deleted > 1 ? 's' : ''}. Les messages de plus de 14 jours et les messages épinglés sont gardés.` };
	});
}
