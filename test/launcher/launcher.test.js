import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLauncher } from '../../launcher/launcher.js';
import { installVersion, readCurrent } from '../../launcher/versions.js';

// A fake app: behaviour chosen by the MODE constant written in its source
function fakeApp(mode, { schema = 1, version = 'dev' } = {}) {
	return `
const MODE = ${JSON.stringify(mode)};
process.on('message', (m) => {
	if (m?.type === 'shutdown') process.exit(0);
	if (m?.type === 'please-restart') process.send({ type: 'restart' });
});
console.log('[INFO]  fake app ' + MODE);
if (MODE === 'ready') setTimeout(() => process.send({ type: 'ready', version: ${JSON.stringify(version)}, schemaVersion: ${schema} }), 20);
if (MODE === 'crash') setTimeout(() => process.exit(3), 20);
setInterval(() => {}, 1000);
`;
}

function makeRoot(mode) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brl-launcher-'));
	fs.mkdirSync(path.join(root, 'src'));
	fs.mkdirSync(path.join(root, 'data'));
	fs.writeFileSync(path.join(root, 'src', 'index.js'), fakeApp(mode));
	fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
	fs.writeFileSync(path.join(root, 'data', 'bot.db'), 'ORIGINAL');
	return root;
}

function waitFor(emitter, event, predicate = () => true, timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
		const handler = (value) => {
			if (!predicate(value)) return;
			clearTimeout(timer);
			emitter.off(event, handler);
			resolve(value);
		};
		emitter.on(event, handler);
	});
}

function launcherFor(root, overrides = {}) {
	const exits = [];
	const launcher = createLauncher({
		root,
		envName: 'test',
		env: { ...process.env, NODE_TEST_CONTEXT: '' },
		repo: 'owner/repo',
		readyTimeoutMs: 1500,
		supervisorOptions: { backoff: [50, 50, 50], maxCrashes: 3, stopTimeoutMs: 2000, echo: false },
		print: () => undefined,
		exit: (code) => exits.push(code),
		...overrides,
	});
	return { launcher, exits };
}

// Fake release: "downloading" returns a body, "tar" writes the fake app of the wanted mode
function fakeRelease(mode, schema) {
	return {
		fetchImpl: async () => new Response('archive'),
		runImpl: async (command, args, options = {}) => {
			if (command === 'tar' && args[0] === '-tzf') return ['src/', 'src/index.js', 'package.json'];
			if (command === 'tar') {
				const dir = args[args.indexOf('-C') + 1];
				fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
				fs.writeFileSync(path.join(dir, 'src', 'index.js'), fakeApp(mode, { schema, version: path.basename(dir).replace('.tmp', '') }));
				fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
			}
			if (command === 'npm') fs.mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true });
			return [];
		},
	};
}

test('starts the app and becomes running once ready', async () => {
	const root = makeRoot('ready');
	const { launcher } = launcherFor(root);
	const ready = waitFor(launcher.supervisor.events, 'ready');
	launcher.start();
	await ready;
	assert.equal(launcher.supervisor.state, 'running');
	assert.ok(launcher.history.lines().some(l => l.text.includes('fake app ready')));
	await launcher.supervisor.stop();
});

test('restarts on crash, then gives up and exits with code 1', async () => {
	const root = makeRoot('crash');
	const { launcher, exits } = launcherFor(root);
	const crashed = waitFor(launcher.supervisor.events, 'state', s => s === 'crashed');
	launcher.start();
	await crashed;
	assert.deepEqual(exits, [1]);
	assert.ok(launcher.history.lines().some(l => l.text.includes('restarting in')));
});

test('restart requested by the app', async () => {
	const root = makeRoot('ready');
	const { launcher } = launcherFor(root);
	let ready = waitFor(launcher.supervisor.events, 'ready');
	launcher.start();
	await ready;
	const firstPid = launcher.supervisor.pid;
	ready = waitFor(launcher.supervisor.events, 'ready');
	launcher.supervisor.send({ type: 'please-restart' });
	await ready;
	assert.notEqual(launcher.supervisor.pid, firstPid);
	await launcher.supervisor.stop();
});

test('installs a version, backs up the database and switches to it', async () => {
	const root = makeRoot('ready');
	const { launcher } = launcherFor(root, fakeRelease('ready', 2));
	let ready = waitFor(launcher.supervisor.events, 'ready');
	launcher.start();
	await ready;

	ready = waitFor(launcher.supervisor.events, 'ready', m => m.version === 'v1.2.0');
	await launcher.install({ version: 'v1.2.0', assetId: 1 });
	await ready;

	assert.equal(readCurrent(root).version, 'v1.2.0');
	assert.equal(launcher.installState.step, 'done');
	const backups = fs.readdirSync(path.join(root, 'data', 'backups'));
	assert.ok(backups.some(f => f.startsWith('avant-v1.2.0') && f.endsWith('.db')));
	const meta = JSON.parse(fs.readFileSync(path.join(root, 'data', 'backups', backups.find(f => f.endsWith('.json'))), 'utf8'));
	assert.equal(meta.schemaVersion, 1);
	await launcher.supervisor.stop();
});

test('rolls back code and data when the new version does not start', async () => {
	const root = makeRoot('ready');
	const { launcher } = launcherFor(root, fakeRelease('crash', 2));
	let ready = waitFor(launcher.supervisor.events, 'ready');
	launcher.start();
	await ready;

	// The broken version would have migrated the database
	ready = waitFor(launcher.supervisor.events, 'ready');
	const installing = launcher.install({ version: 'v2.0.0', assetId: 1 });
	await waitFor(launcher.supervisor.events, 'state', s => s === 'starting');
	fs.writeFileSync(path.join(root, 'data', 'bot.db'), 'MIGRATED BY BROKEN VERSION');
	await installing;
	await ready;

	assert.equal(readCurrent(root), null, 'back to the base code');
	assert.equal(fs.readFileSync(path.join(root, 'data', 'bot.db'), 'utf8'), 'ORIGINAL');
	assert.equal(launcher.installState.step, 'rolled back');
	assert.match(launcher.installState.error, /exited|not ready/);
	await launcher.supervisor.stop();
});

test('a failed download leaves everything untouched', async () => {
	const root = makeRoot('ready');
	const { launcher } = launcherFor(root, { fetchImpl: async () => new Response('nope', { status: 404 }) });
	const ready = waitFor(launcher.supervisor.events, 'ready');
	launcher.start();
	await ready;
	const pid = launcher.supervisor.pid;

	await launcher.install({ version: 'v1.0.0', assetId: 1 });
	assert.equal(launcher.installState.step, 'failed');
	assert.equal(launcher.supervisor.pid, pid, 'the running bot was not touched');
	assert.equal(fs.existsSync(path.join(root, 'versions', 'v1.0.0')), false);
	await launcher.supervisor.stop();
});

// Archive whose listing is chosen by the test; extraction writes a normal app (plus extra hook)
function listedRelease(entries, afterExtract = () => undefined) {
	const calls = [];
	return {
		calls,
		fetchImpl: async () => new Response('archive'),
		runImpl: async (command, args, options = {}) => {
			calls.push([command, ...args]);
			if (command === 'tar' && args[0] === '-tzf') return entries;
			if (command === 'tar') {
				const dir = args[args.indexOf('-C') + 1];
				fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
				fs.writeFileSync(path.join(dir, 'src', 'index.js'), '');
				afterExtract(dir);
			}
			if (command === 'npm') fs.mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true });
			return [];
		},
	};
}

for (const bad of ['../evil.js', 'src/../../evil.js', '/etc/cron.d/evil', 'C:\\evil.js', 'src\\..\\..\\evil.js']) {
	test(`refuses an archive with an unsafe path (${bad}) before extracting it`, async () => {
		const root = makeRoot('ready');
		const release = listedRelease(['src/', 'src/index.js', bad]);
		await assert.rejects(installVersion({ root, version: 'v1.0.0', assetId: 1, repo: 'owner/repo', ...release }), /unsafe/i);
		assert.ok(!release.calls.some(c => c[0] === 'tar' && c[1] === '-xzf'), 'nothing extracted');
		assert.equal(fs.existsSync(path.join(root, 'versions', 'v1.0.0')), false);
	});
}

test('refuses an archive that contains a symbolic link', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, async () => {
	const root = makeRoot('ready');
	const release = listedRelease(['src/', 'src/index.js', 'src/link'], dir => fs.symlinkSync('/etc', path.join(dir, 'src', 'link')));
	await assert.rejects(installVersion({ root, version: 'v1.0.0', assetId: 1, repo: 'owner/repo', ...release }), /link/i);
	assert.equal(fs.existsSync(path.join(root, 'versions', 'v1.0.0')), false);
});

test('refuses an asset id or a repository that is not well formed', async () => {
	const root = makeRoot('ready');
	const release = listedRelease(['src/index.js']);
	await assert.rejects(installVersion({ root, version: 'v1.0.0', assetId: '1/../../x', repo: 'owner/repo', ...release }), /asset/i);
	await assert.rejects(installVersion({ root, version: 'v1.0.0', assetId: 1, repo: 'owner/repo/../x', ...release }), /repo/i);
	assert.equal(release.calls.length, 0);
});
