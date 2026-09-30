import { Events } from 'discord.js';
import logger from '../../utils/logger.js';

export const name = Events.ClientReady;
export const once = true;
export function execute(client) {
	logger.info(`Ready! Logged in as ${client.user.tag}`);
}