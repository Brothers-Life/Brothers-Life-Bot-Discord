// API process of a split deployment: the panel's REST API and websockets, and the public API (keys brl_…).
// It reads and writes the database itself and asks the bot (BOT_URL) for everything done on Discord.
// It never holds the bot token. The panel's files are served by the front (src/front.js).
import { pkg, consoleLog, ipc, logger, onShutdown, run, shutdown } from './app/process.js';
import config from './utils/config.js';
import { scheduleLogCleanup } from './utils/logger.js';
import { startupChecks } from './utils/startupChecks.js';
import { openDb, databaseOptions } from './db/index.js';
import { schemaVersion } from './db/migrate.js';
import { createCore } from './core/context.js';
import { createVersionService } from './core/versions.js';
import { createWebServer } from './web/server.js';
import { createRuntime } from './runtime.js';
import { createApiLink } from './api/link.js';

run(async () => {
	logger.info(`Brothers Life bot v${pkg.version} (${config.ENV}) — API process`);
	if (!await startupChecks(config, { role: 'api' })) {
		await shutdown(1);
		return;
	}
	scheduleLogCleanup();

	const db = await openDb(databaseOptions(config));
	onShutdown(() => db.close());
	if (db.migration.from !== db.migration.to) {
		logger.info(`Database migrated from schema v${db.migration.from} to v${db.migration.to}`);
	}

	const link = createApiLink({ config, consoleLog, logger });
	const core = createCore({ db, config, executor: link.executor, logger, remote: link.remote });
	await core.init();
	link.attach(core);
	link.start();
	onShutdown(() => link.close());

	const versions = createVersionService({
		config,
		settings: core.settings,
		audit: core.audit,
		appVersion: pkg.version,
		dbSchemaVersion: () => schemaVersion(db),
	});
	const own = createRuntime({ ipc, logger, appVersion: pkg.version, shutdown });
	// The panel's buttons act on the bot (restart, stop); a version is installed on both processes
	const runtime = {
		info: () => ({ ...own.info(), split: true, bot: link.botRuntime.info() }),
		installState: () => own.installState(),
		restart: () => link.botRuntime.restart(),
		stop: () => link.botRuntime.stop(),
		install(payload) {
			own.install(payload);
			link.botRuntime.install(payload).catch(error => logger.error('The bot could not install the version:', error?.message ?? error));
		},
	};

	const web = await createWebServer({ config, core, runtime, consoleLog, versions, logger });
	await web.listen();
	onShutdown(() => web.close());
	onShutdown(() => core.logs.flush());
	onShutdown(() => core.apiKeys.flushAll());
	onShutdown(() => core.fivemData.close());

	ipc.send({ type: 'ready', version: `v${pkg.version}`, schemaVersion: await schemaVersion(db) });
	logger.success(`API ready on port ${config.WEB_PORT}.`);
});
