// Shape of a Discord message as recorded for the live ticket view of the panel
export function ticketMessage(message) {
	return {
		id: message.id,
		authorId: message.author?.id ?? null,
		authorName: message.webhookId ? message.author?.username : (message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? null),
		authorAvatar: message.author?.displayAvatarURL?.({ size: 64 }) ?? null,
		bot: Boolean(message.author?.bot),
		content: message.content ?? '',
		attachments: [...(message.attachments?.values() ?? [])].map(a => ({ name: a.name, url: a.url, contentType: a.contentType ?? null, size: a.size })),
		embeds: (message.embeds ?? []).map(e => ({ title: e.title ?? null, description: e.description ?? null, color: e.hexColor ?? null, fields: e.fields?.map(f => ({ name: f.name, value: f.value })) ?? [] })),
		createdAt: message.createdTimestamp,
	};
}
