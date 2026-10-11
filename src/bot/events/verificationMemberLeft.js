import { Events } from 'discord.js';

export const name = Events.GuildMemberRemove;
export async function execute(member) {
	await member.client.core.verification.memberLeft(member.guild.id, member.id);
}
