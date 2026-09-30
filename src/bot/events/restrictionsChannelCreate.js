import { Events } from 'discord.js';

export const name = Events.ChannelCreate;
// A new channel also denies what the restriction roles forbid
export async function execute(channel) {
	if (!channel.guild) return;
	const { core } = channel.client;
	if (core.network.find(channel.guild.id)?.status !== 'active') return;
	await core.restrictions.syncChannel(channel.guild.id, channel.id);
}
