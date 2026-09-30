import { Events } from 'discord.js';

export const name = Events.ChannelDelete;

// A ticket channel deleted by hand closes its ticket; a deleted counter channel is forgotten
export function execute(channel) {
	channel.client.core.tickets.markChannelDeleted(channel.id);
	channel.client.core.stats.counterDeleted(channel.id);
}
