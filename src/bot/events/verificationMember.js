import { Events } from 'discord.js';

export const name = Events.GuildMemberAdd;
// Newcomers wait for their verification (role "not verified", deadline)
export async function execute(member) {
	await member.client.core.verification.memberJoined(member.guild.id, member.id, { bot: member.user.bot });
}
