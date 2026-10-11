import { Events } from 'discord.js';
import logger from '../../utils/logger.js';

export const name = Events.GuildMemberAdd;
export function execute(member) {
	if (!member.user.bot) member.client.core.stats.memberJoined(member.guild.id).catch(error => logger.error('Join statistics failed:', error));
}
