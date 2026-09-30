import { createHash } from 'node:crypto';
import logger from '../utils/logger.js';

// Registers the slash commands when they changed since the last start (a new version adds some):
// no manual deploy step on Pterodactyl. Dev: on DEV_GUILD_ID (instant); prod: globally.
export async function syncCommands(client, { config, settings }) {
	const commands = [...client.commands.values()].map(c => c.data.toJSON());
	const target = config.ENV === 'prod' || !config.DEV_GUILD_ID ? 'global' : config.DEV_GUILD_ID;
	const hash = createHash('sha256').update(JSON.stringify({ target, commands })).digest('hex');
	if (settings.get('commands.hash') === hash) return false;

	try {
		if (target === 'global') await client.application.commands.set(commands);
		else await client.application.commands.set(commands, target);
		settings.set('commands.hash', hash);
		logger.success(`${commands.length} slash commands registered (${target === 'global' ? 'all servers' : `server ${target}`})`);
		return true;
	}
	catch (error) {
		logger.error('Unable to register the slash commands:', error);
		return false;
	}
}
