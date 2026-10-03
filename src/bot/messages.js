import { EmbedBuilder } from 'discord.js';
import { parseEmoji } from '../core/emoji.js';

// Embeds of a message edited in the panel ({ content, embed } of src/core/announcements.js normalizePayload)
export function buildEmbeds(payload) {
	const e = payload.embed;
	if (!e?.enabled) return [];
	const embed = new EmbedBuilder().setColor(Number.parseInt((e.color ?? '#d6a249').slice(1), 16));
	if (e.title) embed.setTitle(e.title);
	if (e.url && e.title) embed.setURL(e.url);
	if (e.description) embed.setDescription(e.description);
	if (e.authorName) embed.setAuthor({ name: e.authorName, iconURL: e.authorIconUrl ?? undefined });
	if (e.thumbnailUrl) embed.setThumbnail(e.thumbnailUrl);
	if (e.imageUrl) embed.setImage(e.imageUrl);
	if (e.footerText) embed.setFooter({ text: e.footerText, iconURL: e.footerIconUrl ?? undefined });
	if (e.timestamp) embed.setTimestamp(new Date());
	if (e.fields?.length) embed.addFields(e.fields);
	return [embed];
}

// "🎫", "<:name:id>" or "<a:name:id>" -> what discord.js expects for buttons and menus
export function emojiOf(value) {
	const emoji = parseEmoji(value);
	// An invalid emoji is dropped: Discord would refuse the whole message (or modal) for it
	if (!emoji) return undefined;
	return emoji.id ? { id: emoji.id, animated: emoji.animated ?? false } : emoji.name;
}
