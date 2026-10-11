import { Events } from 'discord.js';
import { ticketMessage } from '../ticketMessages.js';

export const name = Events.MessageCreate;
export async function execute(message) {
	if (!message.guild) return;
	await message.client.core.tickets.recordMessage(message.channelId, ticketMessage(message));
}
