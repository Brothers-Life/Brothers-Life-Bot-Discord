import { Events } from 'discord.js';

export const name = Events.MessageCreate;
export function execute(message) {
	if (!message.guild || !message.author || message.webhookId) return;
	message.client.core.stats.message(message.guild.id, message.channelId, message.author.id, message.author.bot);
}
