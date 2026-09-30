import { Events } from 'discord.js';

export const name = Events.GuildMemberAdd;
export function execute(member) {
	if (!member.user.bot) member.client.core.stats.memberJoined(member.guild.id);
}
