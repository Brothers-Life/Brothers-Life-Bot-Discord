import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// First positional argument (flags like --global are ignored)
export const env = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'dev';

function loadConfig() {
	if (!process.argv.slice(2).some(arg => !arg.startsWith('--'))) {
		logger.warn(`No environment argument provided, default usage: "${env}".`);
	}

	const configPath = path.join(__dirname, '..', 'config', `config.${env}.json`);

	try {
		logger.info(`Loading the configuration for the environment "${env}"`);
		return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
	}
	catch (err) {
		logger.error(`Unable to load the configuration for the environment "${env}": ${err.message}`);
		process.exit(1);
	}
}

const config = loadConfig();
export default config;
