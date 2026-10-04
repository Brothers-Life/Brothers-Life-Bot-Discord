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
import { setPanelUrl } from './bot/musicUi.js';
import { createWebServer } from './web/server.js';
import { createRuntime } from './runtime.js';

consoleLog.install();
ipc.on('history', (message) => consoleLog.seed(message.lines ?? []));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const HOUR = 3600_000;
let shuttingDown = false;
const cleanups = [];

// A periodic task that never runs twice at once: a slow run (many giveaways, Discord rate limits...) makes
// the next one wait instead of overlapping (double draw, double post). A throw is logged, never fatal.
function every(ms, task, label, level = 'error') {
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

	const bot = createBot({ dataDir: config.DATA_DIR });
	setPanelUrl(config.WEB_PUBLIC_URL);
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
	cleanups.push(() => core.apiKeys.flushAll());
	cleanups.push(() => core.fivemData.close());

	await bot.login(config.TOKEN);
	core.audit.record({ actorId: 'system', source: 'system', action: 'system.start', details: { version: `v${pkg.version}`, supervised: ipc.supervised } });

	const timers = [
		every(HOUR, () => core.sessions.purgeExpired(), 'Session purge failed'),
		// Temporary bans reaching their end
		every(30_000, () => core.sanctions.expireDue(), 'Ban expiry failed'),
		// Scheduled announcements
		every(30_000, () => core.announcements.sendDue(), 'Announcements failed'),
		// Statistics collected in memory, counter channels, old statistics
		every(60_000, () => core.stats.flush(), 'Stats flush failed'),
		every(10 * 60_000, () => core.stats.updateCounters(), 'Counters failed'),
		every(24 * HOUR, () => core.stats.purge(), 'Stats purge failed'),
		// Dynamic messages whose variables need a refresh
		every(60_000, () => core.liveMessages.tick(), 'Live messages failed'),
		// Scheduled polls to open, open polls reaching their end
		every(30_000, () => core.polls.tick(), 'Polls failed'),
		// Giveaways to open, to draw, unclaimed prizes to reroll
		every(30_000, () => core.giveaways.tick(), 'Giveaways failed'),
		// Staff bugs still unassigned after their urgency delay
		every(60_000, () => core.feedback.tick(), 'Feedback reminders failed'),
		// RP events: reminders, start and end
		every(60_000, () => core.rpEvents.tick(), 'RP events failed'),
		// Monthly staff activity report
		every(10 * 60_000, () => core.staffActivity.tick(), 'Staff report failed'),
		// Nightly server backups
		every(10 * 60_000, () => core.backups.tick(), 'Backups failed'),
		// FiveM servers (status messages) and the bot status
		every(60_000, () => core.fivem.tick(), 'FiveM failed'),
		every(30_000, () => core.fivem.presenceTick(), 'Bot status failed'),
		// Streams and videos to announce
		every(60_000, () => core.streams.tick(), 'Streams failed'),
		// Music: leaves when alone or with nothing to play, refreshes the now-playing message
		every(30_000, () => core.music.tick(), 'Music tick failed'),
		// Staff meetings: reminders, start, end
		every(60_000, () => core.meetings.tick(), 'Meetings tick failed'),
		// Channels opening or closing at set hours
		every(60_000, () => core.channelSchedules.tick(), 'Channel schedules failed'),
		// Newcomers not verified in time
		every(60_000, () => core.verification.tick(), 'Verification tick failed'),
		// Staff absences that start or end
		every(60_000, () => core.absences.tick(), 'Absences failed'),
		// Raids that are over
		every(30_000, () => core.antiraid.tick(), 'Anti-raid tick failed'),
		// Temporary roles reaching their end
		every(30_000, () => core.moderation.expireTempRoles(), 'Temporary roles failed'),
		// Inactive tickets: reminder, then automatic close
		every(5 * 60_000, () => core.tickets.sweep(), 'Ticket sweep failed'),
		// Server events older than the retention period
		every(6 * HOUR, () => core.events.purge(), 'Events purge failed'),
		// Roles whose Discord permissions drifted from their rank profile (reported, not fixed)
		every(6 * HOUR, () => core.permissionSync.checkDrift(), 'Permission check failed', 'warn'),
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
