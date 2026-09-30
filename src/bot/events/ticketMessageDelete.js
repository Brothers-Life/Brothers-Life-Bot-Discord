import { Events } from 'discord.js';

export const name = Events.MessageDelete;
export function execute(message) {
	message.client.core.tickets.removeMessage(message.channelId, message.id);
}
