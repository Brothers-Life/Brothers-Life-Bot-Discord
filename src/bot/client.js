import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { createExecutor } from './executor.js';
import { loadCommands } from './loadCommands.js';
import logger from '../utils/logger.js';
import { cacheGuildInvites } from './invites.js';
import { createYtDlp } from './music/ytdlp.js';
import { createFfmpeg } from './music/ffmpeg.js';
import { createMusicResolver } from './music/resolver.js';
import { createMusicBackend } from './music/player.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const YOUTUBE_COOKIES_FILE = 'secret:youtube-cookies';

// The client is created before the core (the core needs the executor);
// the core is attached afterwards with attachCore().
export function createBot({ dataDir = path.join(__dirname, '..', '..', 'data') } = {}) {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildModeration,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildInvites,
			GatewayIntentBits.GuildExpressions,
			// Private messages to the bot (conversations answered from the panel)
			GatewayIntentBits.DirectMessages,
		],
		// Partials: still get events for messages/members that are no longer in cache
		partials: [Partials.GuildMember, Partials.Message, Partials.Channel, Partials.User],
		// Never @everyone/@here unless a message allows it explicitly (user text echoed in replies, templates…)
		allowedMentions: { parse: ['users', 'roles'], repliedUser: true },
	});
	client.commands = new Collection();
	client.cooldowns = new Collection();
	// Buttons, select menus and modals, by customId prefix ("ticket:open:3" -> components/tickets.js)
	client.components = new Collection();

	const executor = createExecutor(client);
	// Music: yt-dlp and ffmpeg are fetched into data/bin the first time they are needed
	const ytdlp = createYtDlp({ dataDir, logger });
	executor.music = createMusicBackend(client, { ytdlp, ffmpeg: createFfmpeg({ dataDir, logger }), logger });
	executor.musicResolver = createMusicResolver({ ytdlp });
	// Cookies of a YouTube account (Netscape format) read by yt-dlp: kept next to it, set from the panel.
	// Also kept in the database (files table): the disk of a container is wiped at each restart.
	const cookiesFile = path.join(dataDir, 'youtube-cookies.txt');
	let files = null;
	const writeCookies = (content) => {
		fs.mkdirSync(path.dirname(cookiesFile), { recursive: true });
		fs.writeFileSync(cookiesFile, content, { mode: 0o600 });
	};
	executor.hasYoutubeCookies = async () => fs.existsSync(cookiesFile);
	executor.setYoutubeCookies = async (content) => {
		if (content === null) {
			fs.rmSync(cookiesFile, { force: true });
			await files?.remove(YOUTUBE_COOKIES_FILE);
			return;
		}
		writeCookies(content);
		await files?.put(YOUTUBE_COOKIES_FILE, { kind: 'secret', mime: 'text/plain', data: content, compress: true });
	};

	return {
		client,
		executor,

		async attachCore(core) {
			client.core = core;
			files = core.files;
			// Cookies saved in the database come back on a fresh disk; a file already on disk (v1) goes to the database
			const saved = await files.get(YOUTUBE_COOKIES_FILE).catch(() => null);
			if (saved && !fs.existsSync(cookiesFile)) {
				writeCookies(saved.data);
			}
			else if (!saved && fs.existsSync(cookiesFile)) {
				await files.put(YOUTUBE_COOKIES_FILE, { kind: 'secret', mime: 'text/plain', data: fs.readFileSync(cookiesFile), compress: true }).catch(() => undefined);
			}
			executor.music.setHandlers({
				onEnd: (guildId, error) => core.music.trackEnded(guildId, { error }).catch(e => logger.error('Music failed:', e)),
				onLeft: (guildId) => core.music.leave(guildId, { reason: 'déconnecté du vocal' }).catch(() => undefined),
			});

			for (const command of await loadCommands()) {
				client.commands.set(command.data.name, command);
			}

			const componentsPath = path.join(__dirname, 'components');
			for (const file of fs.readdirSync(componentsPath).filter(f => f.endsWith('.js'))) {
				const component = await import(pathToFileURL(path.join(componentsPath, file)).href);
				client.components.set(component.prefix, component);
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

			// A server joining the network: start tracking its invites
			core.network.on('activated', ({ id }) => {
				const guild = client.guilds.cache.get(id);
				if (guild) cacheGuildInvites(guild);
			});

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
			executor.music.destroyAll();
			await client.destroy();
		},
	};
}
