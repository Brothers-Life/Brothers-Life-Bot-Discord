import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import defaultConfig from '../config/loggerConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.resolve(__dirname, '..', defaultConfig.logs.logDir || '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const COLORS = {
	RESET: '\x1b[0m',
	INFO: '\x1b[36m',
	WARN: '\x1b[33m',
	ERROR: '\x1b[31m',
	SUCCESS: '\x1b[32m',
	DEBUG: '\x1b[35m',
};

const TIMEZONE = defaultConfig.logs.timezone || 'Europe/Paris';
const LANG = defaultConfig.logs.lang || 'fr-FR';
const MAX_AGE = (defaultConfig.logs.maxAgeDays || 30) * 24 * 60 * 60 * 1000;
const TYPE_WIDTH = Math.max(...Object.keys(COLORS).map(t => t.length));

function getTime() {
	return new Date().toLocaleString(LANG, { timeZone: TIMEZONE });
}

function prependFile(filePath, content) {
	try {
		let existing = '';
		if (fs.existsSync(filePath)) existing = fs.readFileSync(filePath, 'utf8');
		fs.writeFileSync(filePath, content + '\n' + existing, 'utf8');
	}
	catch (err) {
		console.error(`Unable to write to ${filePath}: ${err.message}`);
	}
}

function createLogger(type) {
	return function(message) {
		const time = getTime();
		const prefix = `[${type.toUpperCase()}]`;
		const paddedPrefix = prefix + ' '.repeat(TYPE_WIDTH - type.length);
		const coloredPrefix = `${COLORS[type.toUpperCase()]}${paddedPrefix}${COLORS.RESET}`;

		// Console
		console.log(`${coloredPrefix} ${message}`);

		// Folders
		try {
			// YYYY-MM-DD
			const day = formatDateInTimezone(TIMEZONE);
			const allFile = path.join(LOG_DIR, `${day}_all.txt`);
			const typeFile = path.join(LOG_DIR, `all_${type.toLowerCase()}.txt`);

			const line = `[${time}] ${prefix} ${message}`;
			prependFile(allFile, line);
			if (type != 'error') return;
			prependFile(typeFile, line);
		}
		catch (e) {
			logger.error(e);
		}
	};
}

function formatDateInTimezone(timezone) {
	const now = new Date();

	const parts = new Intl.DateTimeFormat('en-CA', { // en-CA => YYYY-MM-DD
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);

	let year, month, day;
	for (const part of parts) {
		if (part.type === 'year') year = part.value;
		else if (part.type === 'month') month = part.value;
		else if (part.type === 'day') day = part.value;
	}

	return `${year}-${month}-${day}`;
}

const logger = {
	info: createLogger('info'),
	warn: createLogger('warn'),
	error: createLogger('error'),
	success: createLogger('success'),
	debug: createLogger('debug'),
};

function cleanOldLogs() {
	const files = fs.readdirSync(LOG_DIR);
	const now = Date.now();
	const maxAge = MAX_AGE;

	for (const file of files) {
		const filePath = path.join(LOG_DIR, file);
		const stats = fs.statSync(filePath);
		if (now - stats.mtimeMs > maxAge) {
			fs.unlinkSync(filePath);
			logger.info(`Deleted log file : ${file}`);
		}
	}
}

// See https://crontab.cronhub.io/
cron.schedule('0 3 * * *', () => {
	console.info('Checking old logs...');
	cleanOldLogs();
	console.info('Verification of old logs completed!');
});

export default logger;