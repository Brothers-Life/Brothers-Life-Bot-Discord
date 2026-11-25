import { Events } from 'discord.js';

// Private message to the bot: an answer to an application in progress, or else the conversation shown in the panel
export const name = Events.MessageCreate;
export async function execute(message) {
	if (message.guild || !message.author || message.author.bot) return;
	const { core } = message.client;
	const attachments = [...(message.attachments?.values() ?? [])].map(a => ({ name: a.name, url: a.url, contentType: a.contentType ?? null }));
	// An answer to a form asked in private messages (application) is not a conversation with the staff
	if (await core.formChats.message({ userId: message.author.id, content: message.content ?? '', attachments })) return;
	await core.dms.receive({
		userId: message.author.id,
		userName: message.author.globalName ?? message.author.username,
		content: message.content ?? '',
		attachments,
		messageId: message.id,
	});
}
