import { Events } from 'discord.js';

export const name = Events.ChannelDelete;

// A ticket channel deleted by hand closes its ticket; a deleted counter channel is forgotten
export async function execute(channel) {
	await channel.client.core.tickets.markChannelDeleted(channel.id);
	await channel.client.core.stats.counterDeleted(channel.id);
	await channel.client.core.voiceRooms.channelDeleted(channel.id);
}
