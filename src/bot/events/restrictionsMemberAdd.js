import { Events } from 'discord.js';

export const name = Events.GuildMemberAdd;
// Leaving and coming back does not end a restriction
export async function execute(member) {
	if (member.user.bot) return;
	await member.client.core.sanctions.reapplyOnJoin(member.guild.id, member.id);
}
