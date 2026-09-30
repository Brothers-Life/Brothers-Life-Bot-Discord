import { Events } from 'discord.js';

export const name = Events.GuildUpdate;
export function execute(_oldGuild, guild) {
	guild.client.core.network.upsertSeen({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }) });
}
