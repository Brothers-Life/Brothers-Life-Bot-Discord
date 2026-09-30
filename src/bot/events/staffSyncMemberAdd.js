import { Events } from 'discord.js';

export const name = Events.GuildMemberAdd;

// A staff member joining another server of the network gets their staff roles right away
export async function execute(member) {
	const { network, staffSync } = member.client.core;
	if (member.guild.id === network.getMainId()) return;
	await staffSync.syncMember(member.guild.id, member.id);
}
