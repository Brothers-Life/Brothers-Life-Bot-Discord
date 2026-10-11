// What every process of the bot shares (all-in-one, bot, API, front): console capture for the panel,
// launcher.js messages (IPC), ordered shutdown, periodic tasks that never overlap.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// First: capture every console line for the live console of the panel
import * as consoleLog from '../utils/consoleCapture.js';
import * as ipc from '../utils/ipc.js';
import logger from '../utils/logger.js';

consoleLog.install();
ipc.on('history', (message) => consoleLog.seed(message.lines ?? []));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
export { consoleLog, ipc, logger };

let shuttingDown = false;
const cleanups = [];

export function onShutdown(cleanup) {
	cleanups.push(cleanup);
}

export function isShuttingDown() {
	return shuttingDown;
}

export async function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info('Shutting down...');
	for (const cleanup of cleanups.reverse()) {
		try {
			await cleanup();
		}
		catch (error) {
			logger.error('Error during shutdown:', error);
		}
	}
	process.exitCode = code;
	// Let pending writes finish, then leave even if a handle is still open
	setTimeout(() => process.exit(code), 1000).unref();
}

// A periodic task that never runs twice at once: a slow run (many giveaways, Discord rate limits...) makes
// the next one wait instead of overlapping (double draw, double post). A throw is logged, never fatal.
export function every(ms, task, label, level = 'error') {
	let running = false;
	return setInterval(async () => {
		if (running || shuttingDown) return;
		running = true;
		try {
			await task();
		}
		catch (error) {
			logger[level](`${label}:`, level === 'warn' ? error?.message : error);
		}
		finally {
			running = false;
		}
	}, ms);
}

// Runs main() with the crash and signal handling of a supervised process
export function run(main) {
	process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection:', reason));
	process.on('uncaughtException', (error) => {
		logger.error('Uncaught exception:', error);
		shutdown(1);
	});
	process.on('SIGINT', () => shutdown(0));
	process.on('SIGTERM', () => shutdown(0));
	ipc.on('shutdown', () => shutdown(0));
	main().catch((error) => {
		logger.error('Fatal error during startup:', error);
		shutdown(1);
	});
}
