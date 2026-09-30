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

// Pure: turns raw environment variables into a validated config object
export function parseConfig(vars) {
	const problems = [];
	const str = (key) => (vars[key] ?? '').trim();

	const config = {
		TOKEN: str('TOKEN'),
		APP_ID: str('APP_ID'),
		CLIENT_SECRET: str('CLIENT_SECRET'),
		DEV_GUILD_ID: str('DEV_GUILD_ID'),
		OWNER_ID: str('OWNER_ID'),
		WEB_PORT: Number(str('WEB_PORT') || 3000),
		WEB_MODE: str('WEB_MODE') || 'http',
		WEB_PUBLIC_URL: str('WEB_PUBLIC_URL').replace(/\/+$/, ''),
		TLS_CERT: str('TLS_CERT'),
		TLS_KEY: str('TLS_KEY'),
		GITHUB_REPO: str('GITHUB_REPO'),
		GITHUB_TOKEN: str('GITHUB_TOKEN'),
		USE_TRANSLATION_CACHE: str('USE_TRANSLATION_CACHE') !== 'false',
	};

	if (!SNOWFLAKE.test(config.OWNER_ID)) problems.push('OWNER_ID must be a single Discord user ID (17 to 20 digits)');
	if (config.APP_ID && !SNOWFLAKE.test(config.APP_ID)) problems.push('APP_ID must be a Discord ID');
	if (config.DEV_GUILD_ID && !SNOWFLAKE.test(config.DEV_GUILD_ID)) problems.push('DEV_GUILD_ID must be a Discord ID');
	if (!Number.isInteger(config.WEB_PORT) || config.WEB_PORT < 1 || config.WEB_PORT > 65535) problems.push('WEB_PORT must be a port number');
	if (!WEB_MODES.includes(config.WEB_MODE)) problems.push(`WEB_MODE must be one of: ${WEB_MODES.join(', ')}`);

	if (!config.WEB_PUBLIC_URL) {
		config.WEB_PUBLIC_URL = `${config.WEB_MODE === 'http' ? 'http' : 'https'}://localhost:${config.WEB_PORT}`;
	}
	else if (!/^https?:\/\/[^/]+$/.test(config.WEB_PUBLIC_URL)) {
		problems.push('WEB_PUBLIC_URL must look like http(s)://host[:port], without path');
	}
	else if (config.WEB_MODE !== 'http' && !config.WEB_PUBLIC_URL.startsWith('https://')) {
		problems.push(`WEB_PUBLIC_URL must start with https:// when WEB_MODE is ${config.WEB_MODE}`);
	}
	else if (config.WEB_MODE === 'http' && !config.WEB_PUBLIC_URL.startsWith('http://')) {
		problems.push('WEB_PUBLIC_URL must start with http:// when WEB_MODE is http');
	}

	if (config.WEB_MODE === 'https-custom' && (!config.TLS_CERT || !config.TLS_KEY)) {
		problems.push('TLS_CERT and TLS_KEY are required when WEB_MODE is https-custom');
	}
	if (config.GITHUB_REPO && !/^[\w.-]+\/[\w.-]+$/.test(config.GITHUB_REPO)) {
		problems.push('GITHUB_REPO must look like owner/repo');
	}

	if (problems.length) throw new ConfigError(problems);
	return config;
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

	const config = parseConfig({ ...fileVars, ...pickDefined(process.env) });
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
