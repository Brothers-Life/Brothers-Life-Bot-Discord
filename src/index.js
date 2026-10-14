// All-in-one process: the Discord bot and the panel API together (development, small installs).
// For a split deployment, run src/bot.js, src/api.js and src/front.js instead (docs/architecture.md).
import { pkg, consoleLog, ipc, logger, onShutdown, every, run, shutdown } from './app/process.js';
import path from 'node:path';
import config from './utils/config.js';
import { scheduleLogCleanup } from './utils/logger.js';
import { startupChecks } from './utils/startupChecks.js';
import { openDb, databaseOptions } from './db/index.js';
import { schemaVersion } from './db/migrate.js';
import { createCore } from './core/context.js';
import { createVersionService } from './core/versions.js';
import { createBot } from './bot/client.js';
import { setPanelUrl } from './bot/musicUi.js';
import { createWebServer } from './web/server.js';
import { createRuntime } from './runtime.js';
import { startTasks, startUpdateCheck } from './app/tasks.js';
import { importTelemetry } from './core/telemetry/importer.js';
import { takeOverLegacyPanel } from './core/telemetry/legacy.js';

run(async () => {
	logger.info(`Brothers Life bot v${pkg.version} (${config.ENV})`);
	if (!await startupChecks(config)) {
		// Explicit exit: under launcher.js the IPC channel would keep the process alive
		await shutdown(1);
		return;
	}
	scheduleLogCleanup();

	const db = await openDb(databaseOptions(config), { backupDir: path.join(config.DATA_DIR, 'backups'), appVersion: pkg.version, logger });
	onShutdown(() => db.close());
	if (db.migration.from !== db.migration.to) {
		logger.info(`Database migrated from schema v${db.migration.from} to v${db.migration.to}`);
	}

	const bot = createBot({ dataDir: config.DATA_DIR });
	setPanelUrl(config.WEB_PUBLIC_URL);
	const core = createCore({ db, config, executor: bot.executor, logger });
	// Caches every process needs, then the repairs only the bot process does
	await core.init({ worker: true });
	// Old FiveM panel: its settings and accesses (variables copied as they were), once
	await takeOverLegacyPanel({ core, db, config, logger });
	if (config.TELEMETRY_IMPORT_FROM) {
		importTelemetry({ db, url: config.TELEMETRY_IMPORT_FROM, settings: core.settings, logger })
			.then(counts => counts && logger.success('Old telemetry database imported.'))
			.catch(error => logger.error('Telemetry import failed:', error?.message ?? error));
	}
	const versions = createVersionService({
		config,
		settings: core.settings,
		audit: core.audit,
		appVersion: pkg.version,
		dbSchemaVersion: () => schemaVersion(db),
	});
	const runtime = createRuntime({ ipc, logger, appVersion: pkg.version, shutdown });

	await bot.attachCore(core);
	onShutdown(() => bot.destroy());

	const web = await createWebServer({ config, core, runtime, consoleLog, versions, logger });
	await web.listen();
	onShutdown(() => web.close());
	onShutdown(() => core.logs.flush());
	// Statistics still in memory are written before stopping
	onShutdown(() => core.stats.flush());
	onShutdown(() => core.apiKeys.flushAll());
	onShutdown(() => core.fivemData.close());

	await bot.login(config.TOKEN);
	await core.audit.record({ actorId: 'system', source: 'system', action: 'system.start', details: { version: `v${pkg.version}`, supervised: ipc.supervised } });

	const timers = [...startTasks({ core, every }), ...startUpdateCheck({ config, versions, logger })];
	onShutdown(() => timers.forEach(clearInterval));

	ipc.send({ type: 'ready', version: `v${pkg.version}`, schemaVersion: await schemaVersion(db) });
	logger.success(`Ready. Panel: ${config.WEB_PUBLIC_URL}`);
});
