import logger from './logger.js';
import { env } from './config.js';

// Returns false when the bot must not start. No process.exit() here: exiting while
// fetch is still closing its socket crashes Node on Windows (libuv assertion).
export async function startupChecks(config) {
	const prefix = 'STARTUP CHECKS | ';
	logger.info(prefix + 'Starting bot checks...');

	if (!config.TOKEN) {
		logger.error(prefix + 'TOKEN is missing (.env file or environment variable)!');
		return false;
	}
	else if (config.TOKEN === 'YOUR_BOT_TOKEN') {
		logger.error(prefix + 'Make sure to fill in your .env file!');
		return false;
	}

	if (!config.CLIENT_SECRET) {
		logger.warn(prefix + 'CLIENT_SECRET is missing: nobody will be able to log in to the panel.');
	}

	logger.info(prefix + 'Token found');
	logger.info(prefix + `Owner: ${config.OWNER_ID}`);
	logger.info(prefix + `Environment: ${env}`);

	try {
		const res = await fetch('https://discord.com/api/v10/users/@me', {
			headers: { Authorization: `Bot ${config.TOKEN}` },
		});

		if (res.status === 200) {
			const botData = await res.json();
			logger.success(prefix + 'Token is valid!');
			logger.info(prefix + 'Bot info:');
			logger.info(prefix + `Username: ${botData.username}`);
			logger.info(prefix + `Bot ID: ${botData.id}`);

			if (config.APP_ID && config.APP_ID !== botData.id) {
				logger.warn(prefix + `APP_ID (${config.APP_ID}) does not match the bot ID (${botData.id}).`);
			}
		}
		else if (res.status === 401) {
			logger.error(prefix + 'Token is invalid (Unauthorized)');
			return false;
		}
		else {
			logger.warn(prefix + `Unexpected Discord API response: ${res.status}`);
		}
	}
	catch (err) {
		logger.error(prefix + 'Error checking token:', err);
		return false;
	}

	logger.info(prefix + 'All startup checks passed...');
	return true;
}
