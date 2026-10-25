import { Events } from 'discord.js';

export const name = Events.GuildRoleCreate;

// A new role named like a staff role of the main server is given to that staff right away
export async function execute(role) {
	role.client.core.staffSync.scheduleSyncAll?.();
}
