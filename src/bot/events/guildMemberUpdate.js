import { Events } from 'discord.js';

export const name = Events.GuildMemberUpdate;

// Ranks come from roles on the main server: drop the cached permissions as soon as they change
// then give or take their staff roles on the other servers
export async function execute(oldMember, member) {
	const { network, ranks, staffSync } = member.client.core;
	if (member.guild.id !== network.getMainId()) return;
	if (!oldMember.partial && oldMember.roles.cache.equals(member.roles.cache)) return;
	ranks.invalidate(member.id);
	await staffSync.syncUser(member.id);
}
