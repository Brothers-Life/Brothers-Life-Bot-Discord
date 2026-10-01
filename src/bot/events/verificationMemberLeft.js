import { Events } from 'discord.js';

export const name = Events.GuildMemberRemove;
export function execute(member) {
	member.client.core.verification.memberLeft(member.guild.id, member.id);
}
