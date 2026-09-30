import { Events } from 'discord.js';

export const name = Events.GuildMemberRemove;
export function execute(member) {
	if (!member.user?.bot) member.client.core.stats.memberLeft(member.guild.id);
}
