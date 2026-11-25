import { Events } from 'discord.js';

// A message in a channel where the bot is asking the questions of a form (ticket, application)
export const name = Events.MessageCreate;
export async function execute(message) {
	if (!message.guild || !message.author || message.author.bot) return;
	await message.client.core.formChats.message({
		channelId: message.channelId,
		userId: message.author.id,
		content: message.content ?? '',
		attachments: [...(message.attachments?.values() ?? [])].map(a => ({ name: a.name, url: a.url, contentType: a.contentType ?? null })),
	});
}
