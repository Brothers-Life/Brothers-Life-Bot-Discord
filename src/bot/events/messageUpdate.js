import { Events } from 'discord.js';
import { messageEdited } from '../eventLog.js';
import { automodFacts } from '../automodFacts.js';

export const name = Events.MessageUpdate;
export async function execute(oldMessage, message) {
	messageEdited(oldMessage, message);
	// Editing a message into a scam link must not bypass the automod
	if (message.guild && message.author && !message.partial && oldMessage.content !== message.content) {
		await message.client.core.automod.handleMessage(automodFacts(message), { edited: true });
	}
}
