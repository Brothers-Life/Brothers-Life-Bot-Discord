import { ChannelType } from 'discord.js';
import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('lock', 'Verrouiller un salon : plus personne ne peut y écrire')
	.addChannelOption(o => o.setName('salon').setDescription('Salon (par défaut : celui-ci)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(300));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const channelId = interaction.options.getChannel('salon')?.id ?? interaction.channelId;
		await interaction.client.core.moderation.lock(actor, { guildId: interaction.guildId, channelId, locked: true, reason: interaction.options.getString('raison') ?? '' });
		return { content: `🔒 <#${channelId}> est verrouillé.` };
	});
}
