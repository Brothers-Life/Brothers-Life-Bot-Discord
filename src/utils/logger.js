import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import defaultConfig from './loggerConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Launcher sets BOT_ROOT so logs stay in the same place whatever version is running
const LOG_DIR = process.env.BOT_ROOT
	? path.join(process.env.BOT_ROOT, 'logs')
	: path.resolve(__dirname, '..', defaultConfig.logs.logDir || '../logs');
// Tests stay silent and don't touch the log files
const SILENT = Boolean(process.env.NODE_TEST_CONTEXT);
if (!SILENT && !fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

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

// en-CA => YYYY-MM-DD
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

function getDay() {
	return dayFormatter.format(new Date());
}

// Appending is O(1) per line; sync so nothing is lost on process.exit()
function appendLine(filePath, line) {
	try {
		fs.appendFileSync(filePath, line + '\n', 'utf8');
	}
	catch (err) {
		// Never go through the logger here, it would recurse
		console.error(`Unable to write to ${filePath}: ${err.message}`);
	}
}

// Errors are printed with their stack, objects are inspected
function formatArgs(args) {
	return format(...args.map(arg => (arg instanceof Error ? arg.stack ?? arg.message : arg)));
}

function createLogger(type) {
	return function(...args) {
		if (SILENT) return;
		const message = formatArgs(args);
		const prefix = `[${type.toUpperCase()}]`;
		const paddedPrefix = prefix + ' '.repeat(TYPE_WIDTH - type.length);
		const coloredPrefix = `${COLORS[type.toUpperCase()]}${paddedPrefix}${COLORS.RESET}`;

		// Console
		console.log(`${coloredPrefix} ${message}`);

		// Files
		const line = `[${getTime()}] ${prefix} ${message}`;
		appendLine(path.join(LOG_DIR, `${getDay()}_all.txt`), line);
		if (type === 'error') appendLine(path.join(LOG_DIR, 'all_error.txt'), line);
	};
}

const logger = {
	info: createLogger('info'),
	warn: createLogger('warn'),
	error: createLogger('error'),
	success: createLogger('success'),
	debug: createLogger('debug'),
};

function cleanOldLogs() {
	const now = Date.now();

	for (const file of fs.readdirSync(LOG_DIR)) {
		const filePath = path.join(LOG_DIR, file);
		try {
			if (now - fs.statSync(filePath).mtimeMs > MAX_AGE) {
				fs.unlinkSync(filePath);
				logger.info(`Deleted log file: ${file}`);
			}
		}
		catch (err) {
			logger.error(`Unable to clean log file ${file}:`, err);
		}
	}
}

// Only called by the bot process: a cron job keeps the event loop alive,
// so scheduling it at import time would prevent the deploy scripts from exiting.
// See https://crontab.cronhub.io/
export function scheduleLogCleanup() {
	cleanOldLogs();
	cron.schedule('0 3 * * *', cleanOldLogs, { timezone: TIMEZONE });
}

export default logger;
