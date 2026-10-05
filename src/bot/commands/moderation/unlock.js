import { ChannelType } from 'discord.js';
import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('unlock', 'Déverrouiller un salon verrouillé')
	.addChannelOption(o => o.setName('salon').setDescription('Salon (par défaut : celui-ci)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const channelId = interaction.options.getChannel('salon')?.id ?? interaction.channelId;
		await interaction.client.core.moderation.lock(actor, { guildId: interaction.guildId, channelId, locked: false });
		return { content: `🔓 <#${channelId}> est déverrouillé.` };
	});
}
