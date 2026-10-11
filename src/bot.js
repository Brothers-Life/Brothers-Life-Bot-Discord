// Bot process of a split deployment: the Discord connection, the periodic tasks and the services holding live
// state (music, tickets, raids…). The API reaches it through its internal link (INTERNAL_TOKEN, BOT_RPC_PORT).
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
import { createBotLink } from './bot/link.js';
import { createRuntime } from './runtime.js';
import { startTasks, startUpdateCheck } from './app/tasks.js';

run(async () => {
	logger.info(`Brothers Life bot v${pkg.version} (${config.ENV}) — bot process`);
	if (!await startupChecks(config, { role: 'bot' })) {
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
	await core.init({ worker: true });
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
	onShutdown(() => core.logs.flush());
	onShutdown(() => core.stats.flush());
	onShutdown(() => core.fivemData.close());

	// Listening before the Discord login: the panel shows "bot starting" instead of an error meanwhile
	const link = createBotLink({ config, core, executor: bot.executor, runtime, consoleLog, logger });
	await link.start();
	onShutdown(() => link.close());

	await bot.login(config.TOKEN);
	link.pushSnapshot();
	bot.client.on('guildCreate', () => link.pushSnapshot());
	bot.client.on('guildDelete', () => link.pushSnapshot());
	await core.audit.record({ actorId: 'system', source: 'system', action: 'system.start', details: { version: `v${pkg.version}`, process: 'bot', supervised: ipc.supervised } });

	const timers = [...startTasks({ core, every }), ...startUpdateCheck({ config, versions, logger })];
	onShutdown(() => timers.forEach(clearInterval));

	ipc.send({ type: 'ready', version: `v${pkg.version}`, schemaVersion: await schemaVersion(db) });
	logger.success('Bot ready.');
});
