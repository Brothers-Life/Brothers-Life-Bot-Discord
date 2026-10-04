import { Events, PermissionFlagsBits } from 'discord.js';

export const name = Events.MessageCreate;
// Counting, one-word story, sticky message, auto-publish, media only
export async function execute(message) {
	// Discord's own notices (thread created, pin, boost...): never a wrong count, word or "not a media"
	// (in a media channel, the notice of a new thread would be deleted and its author told to use a thread)
	if (!message.guild || !message.author || message.system) return;
	await message.client.core.channelFeatures.onMessage({
		guildId: message.guild.id,
		channelId: message.channelId,
		messageId: message.id,
		authorId: message.author.id,
		bot: message.author.bot || Boolean(message.webhookId),
		self: message.author.id === message.client.user.id,
		content: message.content ?? '',
		attachments: message.attachments.size,
		mediaEmbeds: message.embeds.filter(e => e.image || e.video || e.thumbnail).length,
		staff: Boolean(message.member?.permissions.has(PermissionFlagsBits.ManageMessages)),
	});
}
