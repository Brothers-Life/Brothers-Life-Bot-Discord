import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ConfigError extends Error {
	constructor(problems) {
		super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
		this.problems = problems;
	}
}

const WEB_MODES = ['http', 'https-selfsigned', 'https-custom'];
const SNOWFLAKE = /^\d{17,20}$/;

// Process being started: all (src/index.js), bot, api or front (split deployment), from the entry file
export const role = process.env.BRL_ROLE || ({ 'bot.js': 'bot', 'api.js': 'api', 'front.js': 'front' }[path.basename(process.argv[1] ?? '')] ?? 'all');

// Pure: turns raw environment variables into a validated config object.
// The front serves files and forwards requests: it needs no Discord setting.
export function parseConfig(vars, { role: processRole = 'all' } = {}) {
	const problems = [];
	const str = (key) => (vars[key] ?? '').trim();

	const config = {
		TOKEN: str('TOKEN'),
		APP_ID: str('APP_ID'),
		CLIENT_SECRET: str('CLIENT_SECRET'),
		DEV_GUILD_ID: str('DEV_GUILD_ID'),
		OWNER_ID: str('OWNER_ID'),
		// Pterodactyl gives the allocated port in SERVER_PORT
		WEB_PORT: Number(str('WEB_PORT') || str('SERVER_PORT') || 3000),
		WEB_MODE: str('WEB_MODE') || 'http',
		WEB_PUBLIC_URL: str('WEB_PUBLIC_URL').replace(/\/+$/, ''),
		TLS_CERT: str('TLS_CERT'),
		TLS_KEY: str('TLS_KEY'),
		GITHUB_REPO: str('GITHUB_REPO'),
		GITHUB_TOKEN: str('GITHUB_TOKEN'),
		USE_TRANSLATION_CACHE: str('USE_TRANSLATION_CACHE') !== 'false',
		// PostgreSQL: DATABASE_URL (postgres://user:password@host:5432/database, given by Railway) or the DB_* variables
		DATABASE_URL: str('DATABASE_URL'),
		DB_HOST: str('DB_HOST'),
		DB_PORT: str('DB_PORT'),
		DB_USER: str('DB_USER'),
		DB_PASSWORD: vars.DB_PASSWORD ?? '',
		DB_NAME: str('DB_NAME'),
		// Split deployment (bot, API and front in separate processes, see docs/architecture.md)
		// Shared secret of the internal link between the API and the bot (32 characters or more)
		INTERNAL_TOKEN: str('INTERNAL_TOKEN'),
		// API: the panel files are served by the front; true keeps serving them from the API too
		SERVE_PANEL: str('SERVE_PANEL') ? str('SERVE_PANEL') === 'true' : true,
		// API behind the front (or another reverse proxy): addresses whose X-Forwarded-For is trusted
		TRUST_PROXY: str('TRUST_PROXY'),
		// Front and bot: where to reach the API (http://api:3001); the bot dials API_URL/internal/bot
		API_URL: str('API_URL').replace(/\/+$/, ''),
		// FiveM telemetry (bl_telemetry): ingest token and server address until they are set from the panel
		TELEMETRY_INGEST_TOKEN: str('TELEMETRY_INGEST_TOKEN'),
		// Old panel database (bl-panel-api) copied once into the telemetry tables, then ignored
		TELEMETRY_IMPORT_FROM: str('TELEMETRY_IMPORT_FROM'),
		TELEMETRY_FIVEM_BASE: str('TELEMETRY_FIVEM_BASE').replace(/\/+$/, ''),
	};

	if (processRole !== 'front' && !SNOWFLAKE.test(config.OWNER_ID)) problems.push('OWNER_ID must be a single Discord user ID (17 to 20 digits)');
	if (config.APP_ID && !SNOWFLAKE.test(config.APP_ID)) problems.push('APP_ID must be a Discord ID');
	if (config.DEV_GUILD_ID && !SNOWFLAKE.test(config.DEV_GUILD_ID)) problems.push('DEV_GUILD_ID must be a Discord ID');
	if (!Number.isInteger(config.WEB_PORT) || config.WEB_PORT < 1 || config.WEB_PORT > 65535) problems.push('WEB_PORT must be a port number');
	if (!WEB_MODES.includes(config.WEB_MODE)) problems.push(`WEB_MODE must be one of: ${WEB_MODES.join(', ')}`);

	if (!config.WEB_PUBLIC_URL) {
		// On Pterodactyl, SERVER_IP is the allocation address (0.0.0.0 when bound to every interface)
		const ip = str('SERVER_IP');
		const host = ip && ip !== '0.0.0.0' ? ip : 'localhost';
		config.WEB_PUBLIC_URL = `${config.WEB_MODE === 'http' ? 'http' : 'https'}://${host}:${config.WEB_PORT}`;
	}
	else if (!/^https?:\/\/[^/]+$/.test(config.WEB_PUBLIC_URL)) {
		problems.push('WEB_PUBLIC_URL must look like http(s)://host[:port], without path');
	}
	// The API and the bot never serve browsers directly in a split deployment (the front does, with its own WEB_MODE)
	else if (!['api', 'bot'].includes(processRole) && config.WEB_MODE !== 'http' && !config.WEB_PUBLIC_URL.startsWith('https://')) {
		problems.push(`WEB_PUBLIC_URL must start with https:// when WEB_MODE is ${config.WEB_MODE}`);
	}
	else if (!['api', 'bot'].includes(processRole) && config.WEB_MODE === 'http' && !config.WEB_PUBLIC_URL.startsWith('http://')) {
		problems.push('WEB_PUBLIC_URL must start with http:// when WEB_MODE is http');
	}

	if (config.WEB_MODE === 'https-custom' && (!config.TLS_CERT || !config.TLS_KEY)) {
		problems.push('TLS_CERT and TLS_KEY are required when WEB_MODE is https-custom');
	}
	if (config.DATABASE_URL) {
		let url = null;
		try {
			url = new URL(config.DATABASE_URL);
		}
		catch {
			// reported below
		}
		if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
			problems.push('DATABASE_URL must look like postgres://user:password@host:5432/database');
		}
	}
	if (config.DB_PORT && !(Number.isInteger(Number(config.DB_PORT)) && Number(config.DB_PORT) >= 1 && Number(config.DB_PORT) <= 65535)) {
		problems.push('DB_PORT must be a port number');
	}
	if (config.INTERNAL_TOKEN && config.INTERNAL_TOKEN.length < 32) problems.push('INTERNAL_TOKEN must be 32 characters or more');
	for (const key of ['API_URL']) {
		if (config[key] && !/^https?:\/\/[^/]+$/.test(config[key])) problems.push(`${key} must look like http://host:port, without path`);
	}
	if (config.GITHUB_REPO && !/^[\w.-]+\/[\w.-]+$/.test(config.GITHUB_REPO)) {
		problems.push('GITHUB_REPO must look like owner/repo');
	}

	if (problems.length) throw new ConfigError(problems);
	return config;
}

// The database settings that are missing (empty when DATABASE_URL or every DB_* variable is set)
export function missingDatabaseConfig(config) {
	if (config.DATABASE_URL) return [];
	return ['DB_HOST', 'DB_USER', 'DB_NAME'].filter(key => !config[key]);
}

// Launcher sets BOT_ROOT so that every installed version shares the same .env and data/
export function resolveRootDir() {
	return process.env.BOT_ROOT || path.resolve(__dirname, '..', '..');
}

// Real environment variables (Pterodactyl startup variables) win over the .env file.
// Empty real variables are ignored so an unset Pterodactyl variable doesn't erase the file value.
export function loadConfig(envName, rootDir = resolveRootDir()) {
	const envFile = path.join(rootDir, `.env.${envName}`);
	let fileVars = {};

	if (fs.existsSync(envFile)) {
		fileVars = parseEnv(fs.readFileSync(envFile, 'utf8'));
		logger.info(`Loaded ${path.basename(envFile)}`);
	}
	else {
		logger.warn(`${path.basename(envFile)} not found, using environment variables only`);
	}

	const config = parseConfig({ ...fileVars, ...pickDefined(process.env) }, { role });
	config.ENV = envName;
	config.ROOT_DIR = rootDir;
	config.DATA_DIR = path.join(rootDir, 'data');
	return config;
}

function pickDefined(obj) {
	return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
}

// First positional argument (flags like --global are ignored)
export const env = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'dev';

let config;
if (process.env.NODE_TEST_CONTEXT) {
	// Under `node --test`, modules must not read .env files nor exit
	config = parseConfig({ OWNER_ID: '100000000000000000' });
	config.ENV = 'test';
	config.ROOT_DIR = resolveRootDir();
	config.DATA_DIR = path.join(config.ROOT_DIR, 'data');
}
else {
	if (!process.argv.slice(2).some(arg => !arg.startsWith('--'))) {
		logger.warn(`No environment argument provided, default usage: "${env}".`);
	}
	try {
		config = loadConfig(env);
	}
	catch (err) {
		logger.error(err.message);
		process.exit(1);
	}
}

export default config;
