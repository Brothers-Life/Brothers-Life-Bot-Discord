import { Events } from 'discord.js';
import logger from '../../utils/logger.js';

export const name = Events.ClientReady;
export const once = true;

// Syncs the servers table with the servers the bot is really in
export async function execute(client) {
	const { network } = client.core;
	logger.info(`Ready! Logged in as ${client.user.tag}`);

	for (const guild of client.guilds.cache.values()) {
		network.upsertSeen({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }) });
	}
	for (const guild of network.list()) {
		if (guild.botPresent && !client.guilds.cache.has(guild.id)) network.markLeft(guild.id);
	}

	// Member roles of the main server decide everyone's ranks: keep them all in cache
	const mainId = network.getMainId();
	if (mainId && client.guilds.cache.has(mainId)) {
		try {
			const members = await client.guilds.cache.get(mainId).members.fetch();
			logger.info(`Main server members cached (${members.size})`);
		}
		catch (error) {
			logger.warn('Unable to fetch the members of the main server:', error);
		}
	}

	const pending = network.list().filter(g => g.status === 'pending' && g.botPresent);
	if (!mainId) logger.warn('No main server yet: log in to the panel with OWNER_ID to choose it.');
	if (pending.length) logger.info(`${pending.length} server(s) waiting to be added to the network from the panel.`);

	client.emit('botSynced');
}
