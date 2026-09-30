import fs from 'fs';
import path from 'path';
import logger from './logger.js';

function loadConfig() {
	const env = process.argv[2] || 'dev';

	if (!process.argv[2]) {
		logger.warn(
			`No environment argument provided, default usage: "${env}".`,
		);
	}

	const configPath = path.join(process.cwd(), 'src', 'config', `config.${env}.json`);

	let config;
	try {
		logger.info(`Loading the configuration for the environment "${env}"`);
		config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
	}
	catch (err) {
		logger.error(`Unable to load the configuration for the environment "${env}"`);
		logger.error(err.message);
		process.exit(1);
	}

	return config;
}

const config = loadConfig();
export default config;
