import { AttachmentBuilder, ChannelType } from 'discord.js';
import fs from 'node:fs';
import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('archive', 'Archiver un salon en page HTML (téléchargeable aussi depuis le panel)')
	.addChannelOption(o => o.setName('salon').setDescription('Salon (celui-ci par défaut)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.PublicThread, ChannelType.PrivateThread))
	.addIntegerOption(o => o.setName('messages').setDescription('Nombre de derniers messages (1000 par défaut)').setMinValue(1).setMaxValue(10_000));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { archives } = interaction.client.core;
		const channel = interaction.options.getChannel('salon') ?? interaction.channel;
		const archive = await archives.create({ ...actor, name: interaction.user.username }, {
			guildId: interaction.guildId,
			channelId: channel.id,
			limit: interaction.options.getInteger('messages') ?? 1000,
		});
		const path = archives.pathOf(archive);
		// Discord refuses attachments over 10 MB without boosts: the panel keeps the file anyway
		const small = archive.size < 9.5 * 1024 * 1024;
		return {
			content: `🗄️ #${archive.channelName} archivé : ${archive.messageCount} message${archive.messageCount > 1 ? 's' : ''}.${small ? '' : ' Fichier trop lourd pour Discord : télécharge-le depuis le panel (page Archives).'}`,
			files: small ? [new AttachmentBuilder(fs.readFileSync(path), { name: `archive-${archive.channelName}.html` })] : [],
		};
	});
}
