import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';

export const DEFAULT_BACKOFF = [1000, 5000, 30_000, 300_000];
const LEVEL = /^\[(INFO|WARN|ERROR|SUCCESS|DEBUG)\]/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

// Runs the app in a child process, restarts it on crash with a growing delay,
// and gives up after `maxCrashes` crashes within `crashWindowMs`.
// Events: state (name), line ({ at, stream, level, text }), message (msg), ready (msg), exit ({ code, signal, expected })
export function createSupervisor({
	resolveEntry,
	args = [],
	env = process.env,
	backoff = DEFAULT_BACKOFF,
	maxCrashes = 5,
	crashWindowMs = 10 * 60_000,
	stopTimeoutMs = 15_000,
	echo = true,
	// Lines to replay in the panel console of a fresh process (previous run, crash messages...)
	getHistory = () => [],
}) {
	const events = new EventEmitter();
	let child = null;
	let state = 'stopped';
	let expectingExit = false;
	let restartTimer = null;
	let crashes = [];
	let exitWaiters = [];

	function setState(next) {
		state = next;
		events.emit('state', next);
	}

	function pipeLines(stream, name) {
		let partial = '';
		stream.setEncoding('utf8');
		stream.on('data', (chunk) => {
			if (echo) (name === 'stderr' ? process.stderr : process.stdout).write(chunk);
			const parts = (partial + chunk).split(/\r?\n/);
			partial = parts.pop();
			for (const raw of parts) {
				const text = raw.replace(ANSI, '');
				const level = LEVEL.exec(text)?.[1].toLowerCase() ?? (name === 'stderr' ? 'error' : 'raw');
				events.emit('line', { at: Date.now(), stream: name, level, text });
			}
		});
	}

	function spawnChild(history = []) {
		const { entry, cwd } = resolveEntry();
		expectingExit = false;
		setState('starting');
		child = fork(entry, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
		const current = child;
		pipeLines(current.stdout, 'stdout');
		pipeLines(current.stderr, 'stderr');
		if (history.length) current.send({ type: 'history', lines: history });

		current.on('message', (message) => {
			if (message?.type === 'ready') {
				setState('running');
				events.emit('ready', message);
			}
			events.emit('message', message);
		});

		current.on('exit', (code, signal) => {
			if (child === current) child = null;
			const expected = expectingExit;
			events.emit('exit', { code, signal, expected });
			const waiters = exitWaiters;
			exitWaiters = [];
			waiters.forEach(resolve => resolve());
			if (expected) return;
			onCrash(code, signal);
		});
	}

	function onCrash(code, signal) {
		const now = Date.now();
		crashes = crashes.filter(at => now - at < crashWindowMs);
		crashes.push(now);
		if (crashes.length >= maxCrashes) {
			setState('crashed');
			events.emit('line', { at: now, stream: 'launcher', level: 'error', text: `[LAUNCHER] ${crashes.length} crashes in ${Math.round(crashWindowMs / 60_000)} min: automatic restart disabled.` });
			return;
		}
		const delay = backoff[Math.min(crashes.length - 1, backoff.length - 1)];
		setState('restarting');
		events.emit('line', { at: now, stream: 'launcher', level: 'warn', text: `[LAUNCHER] App exited (code ${code}${signal ? `, ${signal}` : ''}), restarting in ${delay / 1000}s.` });
		restartTimer = setTimeout(() => {
			restartTimer = null;
			spawnChild(getHistory());
		}, delay);
	}

	return {
		events,

		get state() {
			return state;
		},

		get pid() {
			return child?.pid ?? null;
		},

		start(history = getHistory()) {
			if (child) return;
			clearTimeout(restartTimer);
			restartTimer = null;
			spawnChild(history);
		},

		// Graceful: asks the app to shut down, then kills it if it doesn't
		async stop() {
			clearTimeout(restartTimer);
			restartTimer = null;
			if (!child) {
				setState('stopped');
				return;
			}
			expectingExit = true;
			setState('stopping');
			const current = child;
			const exited = new Promise(resolve => exitWaiters.push(resolve));
			try {
				current.send({ type: 'shutdown' });
			}
			catch {
				current.kill('SIGTERM');
			}
			const timer = setTimeout(() => current.kill('SIGKILL'), stopTimeoutMs);
			await exited;
			clearTimeout(timer);
			setState('stopped');
		},

		async restart(history = undefined) {
			await this.stop();
			crashes = [];
			this.start(history);
		},

		send(message) {
			if (child?.connected) child.send(message);
		},

		resetCrashes() {
			crashes = [];
		},
	};
}
