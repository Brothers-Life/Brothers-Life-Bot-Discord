import { Events } from 'discord.js';
import logger from '../../utils/logger.js';

export const name = Events.GuildMemberRemove;
export function execute(member) {
	if (!member.user?.bot) member.client.core.stats.memberLeft(member.guild.id).catch(error => logger.error('Leave statistics failed:', error));
}
