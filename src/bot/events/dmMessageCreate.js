import { Events } from 'discord.js';

// Private message to the bot: goes to the conversation shown in the panel
export const name = Events.MessageCreate;
export async function execute(message) {
	if (message.guild || !message.author || message.author.bot) return;
	await message.client.core.dms.receive({
		userId: message.author.id,
		userName: message.author.globalName ?? message.author.username,
		content: message.content ?? '',
		attachments: [...(message.attachments?.values() ?? [])].map(a => ({ name: a.name, url: a.url, contentType: a.contentType ?? null })),
		messageId: message.id,
	});
}
