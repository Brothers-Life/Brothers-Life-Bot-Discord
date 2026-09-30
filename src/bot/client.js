import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { createExecutor } from './executor.js';
import { loadCommands } from './loadCommands.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The client is created before the core (the core needs the executor);
// the core is attached afterwards with attachCore().
export function createBot() {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration],
		partials: [Partials.GuildMember],
	});
	client.commands = new Collection();
	client.cooldowns = new Collection();

	const executor = createExecutor(client);

	return {
		client,
		executor,

		async attachCore(core) {
			client.core = core;

			for (const command of await loadCommands()) {
				client.commands.set(command.data.name, command);
			}

			const eventsPath = path.join(__dirname, 'events');
			for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
				const event = await import(pathToFileURL(path.join(eventsPath, file)).href);
				const handler = async (...args) => {
					try {
						await event.execute(...args);
					}
					catch (error) {
						logger.error(`Error in event ${event.name}:`, error);
					}
				};
				if (event.once) client.once(event.name, handler);
				else client.on(event.name, handler);
			}

			// A new main server means new rank roles to watch: cache its members
			core.network.on('mainChanged', ({ main }) => {
				client.guilds.cache.get(main.id)?.members.fetch()
					.catch(error => logger.warn('Unable to fetch the members of the new main server:', error));
			});

			client.on('error', (error) => logger.error('Client error:', error));
			client.on('warn', (message) => logger.warn(message));
		},

		// Resolves once the bot is connected and its servers are synced
		async login(token) {
			const ready = new Promise((resolve) => client.once('botSynced', resolve));
			await client.login(token);
			await ready;
		},

		async destroy() {
			await client.destroy();
		},
	};
}
