import { Events } from 'discord.js';
import logger from '../../utils/logger.js';

export const name = Events.GuildDelete;
export async function execute(guild) {
	// An outage is not a departure
	if (!guild.available) return;
	await guild.client.core.network.markLeft(guild.id);
	logger.warn(`Left server ${guild.name} (${guild.id}).`);
}
