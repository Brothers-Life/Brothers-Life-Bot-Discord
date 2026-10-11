import { Events } from 'discord.js';
import { ticketMessage } from '../ticketMessages.js';

export const name = Events.MessageUpdate;
export async function execute(oldMessage, message) {
	if (!message.guild || message.partial) return;
	const { content, embeds } = ticketMessage(message);
	await message.client.core.tickets.updateMessage(message.channelId, { id: message.id, content, embeds });
}
