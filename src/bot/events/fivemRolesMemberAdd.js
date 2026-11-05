import { Events } from 'discord.js';

export const name = Events.GuildMemberAdd;

// A member joining a server gets the roles their job, gang or staff role in game gives there (automatic sync on)
export async function execute(member) {
	if (member.user.bot) return;
	member.client.core.fivemRoles.syncMember(member.guild.id, member.id);
}
