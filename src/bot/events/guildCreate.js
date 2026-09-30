import { Events } from 'discord.js';
import logger from '../../utils/logger.js';

export const name = Events.GuildCreate;
export function execute(guild) {
	guild.client.core.network.upsertSeen({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }) });
	logger.info(`Joined server ${guild.name} (${guild.id}): waiting to be added to the network from the panel.`);
}
