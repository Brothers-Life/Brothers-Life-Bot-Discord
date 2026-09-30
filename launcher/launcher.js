import fs from 'node:fs';
import path from 'node:path';
import { createRingBuffer } from './ringBuffer.js';
import { createSupervisor } from './supervisor.js';
import { readCurrent, writeCurrent, resolveEntry, installVersion, pruneVersions, run } from './versions.js';
import { backupDatabase, restoreDatabase } from './backup.js';

const HISTORY_LINES = 5000;

// Supervises the app and installs versions on its request.
// Only node:* modules here: this file must keep working whatever version gets installed.
export function createLauncher({
	root,
	envName = 'prod',
	env = process.env,
	repo,
	token,
	readyTimeoutMs = 60_000,
	fetchImpl = fetch,
	runImpl = run,
	supervisorOptions = {},
	exit = (code) => process.exit(code),
	print = (text) => process.stdout.write(`${text}\n`),
}) {
	const history = createRingBuffer(HISTORY_LINES);
	let lastSchemaVersion = null;
	let installing = false;
	let installState = null;
	let stopping = false;

	function log(text, level = 'info') {
		const line = `[LAUNCHER] ${text}`;
		history.push({ at: Date.now(), stream: 'launcher', level, text: line });
		print(line);
	}

	const supervisor = createSupervisor({
		resolveEntry: () => resolveEntry(root),
		args: [envName],
		env: { ...env, BOT_ROOT: root },
		getHistory: () => history.lines(),
		...supervisorOptions,
	});

	supervisor.events.on('line', (line) => {
		history.push(line);
		if (line.stream === 'launcher') print(line.text);
	});

	supervisor.events.on('ready', (message) => {
		lastSchemaVersion = message.schemaVersion ?? lastSchemaVersion;
		log(`App ready (${message.version ?? 'dev'}, schema v${message.schemaVersion ?? '?'})`);
		if (installState) supervisor.send({ type: 'install-progress', state: installState });
	});

	supervisor.events.on('state', (state) => {
		if (state === 'crashed' && !installing) {
			log('Giving up after repeated crashes. Fix the problem, then restart the server.', 'error');
			exit(1);
		}
	});

	supervisor.events.on('message', (message) => {
		if (message?.type === 'restart') {
			log('Restart requested from the panel');
			supervisor.restart().catch(error => log(`Restart failed: ${error.message}`, 'error'));
		}
		else if (message?.type === 'stop') {
			log('Stop requested from the panel');
			shutdown(0);
		}
		else if (message?.type === 'install') {
			install(message).catch(error => log(`Install crashed: ${error.stack ?? error.message}`, 'error'));
		}
	});

	function progress(version, step, extra = {}) {
		installState = { version, step, ...extra };
		supervisor.send({ type: 'install-progress', state: installState });
		log(`[install ${version}] ${step}${extra.error ? `: ${extra.error}` : ''}`, extra.error ? 'error' : 'info');
	}

	function waitReady() {
		return new Promise((resolve) => {
			const done = (ok, reason) => {
				clearTimeout(timer);
				supervisor.events.off('ready', onReady);
				supervisor.events.off('exit', onExit);
				resolve({ ok, reason });
			};
			const onReady = () => done(true);
			const onExit = ({ expected, code }) => {
				if (!expected) done(false, `the app exited with code ${code} before being ready`);
			};
			const timer = setTimeout(() => done(false, `the app was not ready within ${readyTimeoutMs / 1000}s`), readyTimeoutMs);
			supervisor.events.on('ready', onReady);
			supervisor.events.on('exit', onExit);
		});
	}

	async function install({ version, assetId, restoreBackup = null }) {
		if (installing) {
			log(`Ignoring install of ${version}: another install is running`, 'warn');
			return;
		}
		installing = true;
		const previous = readCurrent(root)?.version ?? null;

		try {
			try {
				await installVersion({ root, version, assetId, repo, token, fetchImpl, runImpl, onStep: step => progress(version, step) });
			}
			catch (error) {
				progress(version, 'failed', { error: error.message, done: true });
				return;
			}

			progress(version, 'stopping the bot');
			await supervisor.stop();

			const backup = backupDatabase(root, { label: `avant-${version}`, schemaVersion: lastSchemaVersion, fromVersion: previous });
			if (backup) log(`Database saved to data/backups/${backup}`);
			if (restoreBackup) {
				restoreDatabase(root, restoreBackup);
				log(`Database restored from ${restoreBackup}`);
			}
			writeCurrent(root, { version, previous, installedAt: Date.now() });

			installState = { version, step: 'starting' };
			const ready = waitReady();
			supervisor.start();
			const result = await ready;

			if (result.ok) {
				pruneVersions(root, [version, previous]);
				progress(version, 'done', { done: true });
				return;
			}

			// Rollback: previous code, previous data
			log(`${version} failed: ${result.reason}. Rolling back to ${previous ?? 'the base code'}.`, 'error');
			await supervisor.stop();
			if (backup) restoreDatabase(root, backup);
			if (previous) writeCurrent(root, { version: previous, previous: null, installedAt: Date.now() });
			else fs.rmSync(path.join(root, 'current.json'), { force: true });
			installState = { version, step: 'rolled back', error: result.reason, done: true };
			supervisor.resetCrashes();
			supervisor.start();
		}
		finally {
			installing = false;
		}
	}

	async function shutdown(code) {
		if (stopping) return;
		stopping = true;
		await supervisor.stop();
		log('Stopped');
		exit(code);
	}

	return {
		supervisor,
		history,
		install,
		shutdown,
		start() {
			const { version } = resolveEntry(root);
			log(`Starting ${version ?? 'base code'} (${envName})`);
			supervisor.start();
		},
		get installState() {
			return installState;
		},
	};
}
