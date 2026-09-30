import { ChannelType } from 'discord.js';
import { moderationCommand, runModeration } from '../../moderation.js';
import { formatDuration, parseDuration } from '../../../core/duration.js';
import { ValidationError } from '../../../core/errors.js';

export const data = moderationCommand('slowmode', 'Régler le mode lent d’un salon')
	.addStringOption(o => o.setName('duree').setDescription('Délai entre deux messages (ex : 10s, 1m, 2h). 0 pour désactiver').setRequired(true))
	.addChannelOption(o => o.setName('salon').setDescription('Salon (par défaut : celui-ci)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildForum));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const raw = interaction.options.getString('duree');
		const ms = raw.trim() === '0' ? 0 : parseDuration(raw);
		if (ms === null) throw new ValidationError(`Durée invalide : « ${raw} ». Exemples : 10s, 1m, 2h, 0.`);
		const channelId = interaction.options.getChannel('salon')?.id ?? interaction.channelId;
		await interaction.client.core.moderation.slowmode(actor, { guildId: interaction.guildId, channelId, seconds: Math.round(ms / 1000) });
		return { content: ms ? `🐢 Mode lent de <#${channelId}> : ${formatDuration(ms)}.` : `Mode lent désactivé dans <#${channelId}>.` };
	});
}
