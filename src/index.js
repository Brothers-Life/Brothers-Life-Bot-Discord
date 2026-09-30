import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// First: capture every console line for the live console of the panel
import * as consoleLog from './utils/consoleCapture.js';
import * as ipc from './utils/ipc.js';
import config from './utils/config.js';
import logger, { scheduleLogCleanup } from './utils/logger.js';
import { startupChecks } from './utils/startupChecks.js';
import { openDb } from './db/index.js';
import { schemaVersion } from './db/migrate.js';
import { createCore } from './core/context.js';
import { createVersionService } from './core/versions.js';
import { createBot } from './bot/client.js';
import { createWebServer } from './web/server.js';
import { createRuntime } from './runtime.js';

consoleLog.install();
ipc.on('history', (message) => consoleLog.seed(message.lines ?? []));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const HOUR = 3600_000;
let shuttingDown = false;
const cleanups = [];

async function shutdown(code = 0) {
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

process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection:', reason));
process.on('uncaughtException', (error) => {
	logger.error('Uncaught exception:', error);
	shutdown(1);
});
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
ipc.on('shutdown', () => shutdown(0));

async function main() {
	logger.info(`Brothers Life bot v${pkg.version} (${config.ENV})`);
	if (!await startupChecks(config)) {
		// Explicit exit: under launcher.js the IPC channel would keep the process alive
		await shutdown(1);
		return;
	}
	scheduleLogCleanup();

	const db = openDb(path.join(config.DATA_DIR, 'bot.db'));
	cleanups.push(() => db.close());
	if (db.migration.from !== db.migration.to) {
		logger.info(`Database migrated from schema v${db.migration.from} to v${db.migration.to}`);
	}

	const bot = createBot();
	const core = createCore({ db, config, executor: bot.executor, logger });
	const versions = createVersionService({
		config,
		settings: core.settings,
		audit: core.audit,
		appVersion: pkg.version,
		dbSchemaVersion: () => schemaVersion(db),
	});
	const runtime = createRuntime({ ipc, logger, appVersion: pkg.version, shutdown });

	await bot.attachCore(core);
	cleanups.push(() => bot.destroy());

	const web = await createWebServer({ config, core, runtime, consoleLog, versions, logger });
	await web.listen();
	cleanups.push(() => web.close());
	cleanups.push(() => core.logs.flush());
	// Statistics still in memory are written before stopping
	cleanups.push(() => core.stats.flush());

	await bot.login(config.TOKEN);
	core.audit.record({ actorId: 'system', source: 'system', action: 'system.start', details: { version: `v${pkg.version}`, supervised: ipc.supervised } });

	const timers = [
		setInterval(() => core.sessions.purgeExpired(), HOUR),
		// Temporary bans reaching their end
		setInterval(() => core.sanctions.expireDue().catch(error => logger.error('Ban expiry failed:', error)), 30_000),
		// Scheduled announcements
		setInterval(() => core.announcements.sendDue().catch(error => logger.error('Announcements failed:', error)), 30_000),
		// Statistics collected in memory, counter channels, old statistics
		setInterval(() => core.stats.flush().catch(error => logger.error('Stats flush failed:', error)), 60_000),
		setInterval(() => core.stats.updateCounters().catch(error => logger.error('Counters failed:', error)), 10 * 60_000),
		setInterval(() => core.stats.purge(), 24 * HOUR),
		// Dynamic messages whose variables need a refresh
		setInterval(() => core.liveMessages.tick().catch(error => logger.error('Live messages failed:', error)), 60_000),
		// Scheduled polls to open, open polls reaching their end
		setInterval(() => core.polls.tick().catch(error => logger.error('Polls failed:', error)), 30_000),
		// Giveaways to open, to draw, unclaimed prizes to reroll
		setInterval(() => core.giveaways.tick().catch(error => logger.error('Giveaways failed:', error)), 30_000),
		// Raids that are over
		setInterval(() => core.antiraid.tick().catch(error => logger.error('Anti-raid tick failed:', error)), 30_000),
		// Temporary roles reaching their end
		setInterval(() => core.moderation.expireTempRoles().catch(error => logger.error('Temporary roles failed:', error)), 30_000),
		// Inactive tickets: reminder, then automatic close
		setInterval(() => core.tickets.sweep().catch(error => logger.error('Ticket sweep failed:', error)), 5 * 60_000),
		// Server events older than the retention period
		setInterval(() => core.events.purge(), 6 * HOUR),
		// Roles whose Discord permissions drifted from their rank profile (reported, not fixed)
		setInterval(() => core.permissionSync.checkDrift().catch(error => logger.warn('Permission check failed:', error.message)), 6 * HOUR),
	];
	if (config.GITHUB_REPO) {
		const check = () => versions.checkForUpdate().catch(error => logger.warn('Version check failed:', error.message));
		timers.push(setTimeout(check, 60_000), setInterval(check, 6 * HOUR));
	}
	cleanups.push(() => timers.forEach(clearInterval));

	ipc.send({ type: 'ready', version: `v${pkg.version}`, schemaVersion: schemaVersion(db) });
	logger.success(`Ready. Panel: ${config.WEB_PUBLIC_URL}`);
}

main().catch((error) => {
	logger.error('Fatal error during startup:', error);
	shutdown(1);
});
