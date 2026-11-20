import { Events } from 'discord.js';

export const name = Events.GuildRoleUpdate;

// Staff roles are also mirrored by name: a renamed role can start or stop matching a staff role of the main server.
// A moved role can break the order of the network roles.
export async function execute(oldRole, role) {
	const renamed = oldRole.name !== role.name;
	const moved = oldRole.rawPosition !== role.rawPosition;
	if (!renamed && !moved) return;
	await role.client.core.staffSync.roleChanged(role.guild.id, { renamed, moved });
}
