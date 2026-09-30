import fetch from 'node-fetch';
import logger from './logger.js';

export async function startupChecks(config) {
	const prefix = 'STARTUP CHECKS | ';
	logger.info(prefix + 'Starting bot checks...');

	if (!config.TOKEN) {
		logger.error(prefix + 'Token is missing in your config file!');
		process.exit(1);
	}
	else if (config.TOKEN === 'YOUR_BOT_TOKEN') {
		logger.error(prefix + 'Make sure to replace the config.*.json values!');
		process.exit(1);
	}

	logger.info(prefix + 'Token found');
	logger.info(prefix + `Environment: ${process.argv[2]}`);

	try {
		const res = await fetch('https://discord.com/api/v10/users/@me', {
			headers: { Authorization: `Bot ${config.TOKEN}` },
		});

		if (res.status === 200) {
			const botData = await res.json();
			logger.success(prefix + 'Token is valid!');
			logger.info(prefix + 'Bot info:');
			logger.info(prefix + `Username: ${botData.username}`);
			logger.info(prefix + `Discriminator: #${botData.discriminator}`);
			logger.info(prefix + `Bot ID: ${botData.id}`);
		}
		else if (res.status === 401) {
			logger.error(prefix + 'Token is invalid (Unauthorized)');
			process.exit(1);
		}
		else {
			logger.warn(prefix + `Unexpected Discord API response: ${res.status}`);
		}
	}
	catch (err) {
		logger.error(prefix + 'Error checking token:', err);
		process.exit(1);
	}

	logger.info(prefix + 'All startup checks passed...');
}
