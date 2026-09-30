import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { startupChecks } from './utils/startupChecks.js';
import { loadCommands } from './utils/loadCommands.js';
import config from './utils/config.js';
import logger, { scheduleLogCleanup } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.on('unhandledRejection', (reason) => {
	logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
	logger.error('Uncaught exception:', error);
	process.exit(1);
});

// Disable this when you are comfortable with discordjs
if (!await startupChecks(config)) {
	process.exitCode = 1;
}
else {
	await startBot();
}

async function startBot() {
	scheduleLogCleanup();

	const client = new Client({ intents: [GatewayIntentBits.Guilds] });
	client.commands = new Collection();
	client.cooldowns = new Collection();

	for (const command of await loadCommands()) {
		client.commands.set(command.data.name, command);
	}

	const eventsPath = path.join(__dirname, 'events');
	const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

	for (const file of eventFiles) {
		const event = await import(pathToFileURL(path.join(eventsPath, file)).href);
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		}
		else {
			client.on(event.name, (...args) => event.execute(...args));
		}
	}

	client.on('error', (error) => logger.error('Client error:', error));
	client.on('warn', (message) => logger.warn(message));

	try {
		await client.login(config.TOKEN);
	}
	catch (error) {
		logger.error('Unable to log in to Discord:', error);
		await client.destroy();
		process.exitCode = 1;
	}
}
