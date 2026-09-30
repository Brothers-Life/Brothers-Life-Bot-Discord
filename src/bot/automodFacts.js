// What the automod needs to know about a message
export function automodFacts(message) {
	return {
		guildId: message.guildId,
		channelId: message.channelId,
		messageId: message.id,
		userId: message.author.id,
		userName: message.author.username,
		content: message.content ?? '',
		mentionCount: (message.mentions?.users.size ?? 0) + (message.mentions?.roles.size ?? 0),
		attachmentCount: message.attachments?.size ?? 0,
		hasEveryone: Boolean(message.mentions?.everyone),
		roleIds: message.member ? [...message.member.roles.cache.keys()] : [],
		isBot: Boolean(message.author.bot || message.webhookId || message.system),
	};
}
