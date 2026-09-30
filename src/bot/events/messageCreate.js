import { Events } from 'discord.js';
import { automodFacts } from '../automodFacts.js';

export const name = Events.MessageCreate;
export async function execute(message) {
	if (!message.guild || !message.author) return;
	await message.client.core.automod.handleMessage(automodFacts(message));
}
