import { Events } from 'discord.js';

export const name = Events.MessageDelete;
export async function execute(message) {
	await message.client.core.tickets.removeMessage(message.channelId, message.id);
}
