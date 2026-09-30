import { Events } from 'discord.js';

export const name = Events.GuildMemberRemove;
export function execute(member) {
	const { network, ranks } = member.client.core;
	if (member.guild.id === network.getMainId()) ranks.invalidate(member.id);
}
