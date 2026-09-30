import { AppError } from './core/errors.js';

// What the panel can ask about/to the process: restart, stop, install a version.
// Under launcher.js these go through IPC; alone (npm run dev) restart/stop just exit.
export function createRuntime({ ipc, logger, appVersion, shutdown }) {
	const startedAt = Date.now();
	let install = null;

	ipc.on('install-progress', (message) => {
		install = { ...message.state, at: Date.now() };
		const level = message.state.error ? 'error' : 'info';
		logger[level](`[install ${message.state.version}] ${message.state.step}${message.state.error ? `: ${message.state.error}` : ''}`);
	});

	return {
		info() {
			return {
				version: `v${appVersion}`,
				supervised: ipc.supervised,
				startedAt,
				node: process.version,
				platform: `${process.platform}/${process.arch}`,
				memory: process.memoryUsage().rss,
			};
		},

		installState() {
			return install;
		},

		async restart() {
			if (ipc.supervised) return ipc.send({ type: 'restart' });
			logger.warn('Restart requested but the bot is not running under launcher.js: exiting.');
			await shutdown(0);
		},

		async stop() {
			if (ipc.supervised) return ipc.send({ type: 'stop' });
			await shutdown(0);
		},

		install(payload) {
			if (!ipc.supervised) {
				throw new AppError('NOT_SUPERVISED', 'Versions can only be installed when the bot runs with launcher.js (npm start).', 409);
			}
			if (install && !install.done && !install.error && Date.now() - install.at < 15 * 60_000) {
				throw new AppError('BUSY', `Version ${install.version} is already being installed.`, 409);
			}
			install = { version: payload.version, step: 'requested', at: Date.now() };
			ipc.send({ type: 'install', ...payload });
		},
	};
}
