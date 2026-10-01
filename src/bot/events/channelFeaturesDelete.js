import { Events } from 'discord.js';

export const name = Events.MessageDelete;
// A counted number deleted: the counting channel is told where the count is
export async function execute(message) {
	if (!message.guildId) return;
	await message.client.core.channelFeatures.onDelete(message.channelId, message.id);
}
