import { Events } from 'discord.js';

export const name = Events.ChannelDelete;

// A ticket channel deleted by hand closes its ticket
export function execute(channel) {
	channel.client.core.tickets.markChannelDeleted(channel.id);
}
