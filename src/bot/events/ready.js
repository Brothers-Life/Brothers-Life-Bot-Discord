import { Events } from 'discord.js';
import logger from '../../utils/logger.js';
import { cacheGuildInvites } from '../invites.js';
import { syncCommands } from '../syncCommands.js';
import { syncCustomCommands } from '../customCommands.js';

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

	// Invite counters, to know which invite each new member used
	for (const guildId of network.activeIds()) {
		const guild = client.guilds.cache.get(guildId);
		if (guild) await cacheGuildInvites(guild);
	}

	const pending = network.list().filter(g => g.status === 'pending' && g.botPresent);
	if (!mainId) logger.warn('No main server yet: log in to the panel with OWNER_ID to choose it.');
	if (pending.length) logger.info(`${pending.length} server(s) waiting to be added to the network from the panel.`);

	// People already in voice when the bot starts
	const states = [];
	for (const guildId of network.activeIds()) {
		const guild = client.guilds.cache.get(guildId);
		for (const state of guild?.voiceStates.cache.values() ?? []) {
			if (state.channelId) states.push({ guildId, userId: state.id, channelId: state.channelId, bot: Boolean(state.member?.user?.bot), afk: state.channelId === guild.afkChannelId });
		}
	}
	client.core.stats.seedVoice(states);
	await client.core.voiceRooms.cleanup().catch(error => logger.warn('Voice rooms cleanup failed:', error.message));

	const builtinChanged = await syncCommands(client, client.core);
	// On the dev server the bot's own commands and the custom ones share one list: a new built-in list means sending both again
	if (builtinChanged && client.core.config.DEV_GUILD_ID) client.core.settings.set(`commands.custom.${client.core.config.DEV_GUILD_ID}`, null);
	await syncCustomCommands(client).catch(error => logger.warn('Custom commands sync failed:', error.message));
	// Again after each change in the panel (grouped), and now and then for servers that joined the network
	let customSync = null;
	client.core.customCommands.onChange(() => {
		clearTimeout(customSync);
		customSync = setTimeout(() => syncCustomCommands(client).catch(error => logger.warn('Custom commands sync failed:', error.message)), 2000);
	});
	setInterval(() => syncCustomCommands(client).catch(() => null), 10 * 60_000).unref();

	client.emit('botSynced');
}
