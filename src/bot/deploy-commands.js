// Usage:
//   node src/bot/deploy-commands.js <env>            -> deploys to DEV_GUILD_ID (instant)
//   node src/bot/deploy-commands.js <env> --global   -> deploys to every server (can take up to 1h)
import { REST, Routes } from 'discord.js';
import config, { env } from '../utils/config.js';
import logger from '../utils/logger.js';
import { loadCommands } from './loadCommands.js';

const isGlobal = process.argv.includes('--global');

if (!isGlobal && !config.DEV_GUILD_ID) {
	logger.error('DEV_GUILD_ID is missing in your config file (required for guild deployment).');
	process.exit(1);
}

const commands = (await loadCommands()).map(command => command.data.toJSON());
const rest = new REST().setToken(config.TOKEN);
const route = isGlobal
	? Routes.applicationCommands(config.APP_ID)
	: Routes.applicationGuildCommands(config.APP_ID, config.DEV_GUILD_ID);
const target = isGlobal ? 'globally' : `to guild ${config.DEV_GUILD_ID}`;

try {
	logger.info(`[${env}] Started refreshing ${commands.length} application (/) commands ${target}.`);
	const data = await rest.put(route, { body: commands });
	logger.success(`[${env}] Successfully reloaded ${data.length} application (/) commands ${target}.`);
}
catch (error) {
	logger.error('Unable to deploy commands:', error);
	process.exitCode = 1;
}
