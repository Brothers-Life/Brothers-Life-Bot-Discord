import { Events } from 'discord.js';

export const name = Events.GuildRoleUpdate;

// Staff roles are also mirrored by name: a renamed role can start or stop matching a staff role of the main server
export async function execute(oldRole, role) {
	if (oldRole.name === role.name) return;
	role.client.core.staffSync.scheduleSyncAll?.();
}
