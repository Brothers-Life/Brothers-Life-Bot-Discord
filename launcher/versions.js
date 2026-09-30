import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const KEEP_VERSIONS = 3;
const VERSION = /^v\d+\.\d+\.\d+$/;

export function readCurrent(root) {
	try {
		const state = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
		return VERSION.test(state.version) ? state : null;
	}
	catch {
		return null;
	}
}

export function writeCurrent(root, state) {
	const file = path.join(root, 'current.json');
	fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
	fs.renameSync(`${file}.tmp`, file);
}

// Entry of the app to run: an installed version, or the code next to launcher.js
export function resolveEntry(root) {
	const current = readCurrent(root);
	if (current) {
		const dir = path.join(root, 'versions', current.version);
		if (fs.existsSync(path.join(dir, 'src', 'index.js'))) return { entry: path.join(dir, 'src', 'index.js'), cwd: dir, version: current.version };
	}
	return { entry: path.join(root, 'src', 'index.js'), cwd: root, version: null };
}

export function run(command, args, { cwd, onLine = () => undefined } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
		const output = [];
		const collect = (chunk) => {
			for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
				output.push(line);
				onLine(line);
			}
		};
		child.stdout.on('data', collect);
		child.stderr.on('data', collect);
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(output);
			else reject(new Error(`${command} ${args.join(' ')} failed (code ${code}): ${output.slice(-5).join(' | ')}`));
		});
	});
}

// Downloads a release asset, extracts it and installs its production dependencies.
// Nothing changes for the running bot until the caller switches current.json.
export async function installVersion({ root, version, assetId, repo, token, fetchImpl = fetch, runImpl = run, onStep = () => undefined }) {
	if (!VERSION.test(version)) throw new Error(`Invalid version ${version}`);
	const versionsDir = path.join(root, 'versions');
	const finalDir = path.join(versionsDir, version);
	if (fs.existsSync(path.join(finalDir, 'node_modules')) && fs.existsSync(path.join(finalDir, 'src', 'index.js'))) {
		onStep(`${version} already installed`);
		return finalDir;
	}

	const tmpDir = path.join(versionsDir, `${version}.tmp`);
	const archive = path.join(versionsDir, `${version}.tar.gz`);
	fs.rmSync(tmpDir, { recursive: true, force: true });
	fs.mkdirSync(tmpDir, { recursive: true });

	try {
		onStep('downloading');
		const headers = { Accept: 'application/octet-stream', 'User-Agent': 'brl-bot-launcher', 'X-GitHub-Api-Version': '2022-11-28' };
		if (token) headers.Authorization = `Bearer ${token}`;
		const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/assets/${assetId}`, { headers, redirect: 'follow' });
		if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
		await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(archive));

		onStep('extracting');
		await runImpl('tar', ['-xzf', archive, '-C', tmpDir]);
		if (!fs.existsSync(path.join(tmpDir, 'src', 'index.js'))) throw new Error('The archive does not contain src/index.js');

		onStep('installing dependencies');
		await runImpl('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: tmpDir });

		fs.rmSync(finalDir, { recursive: true, force: true });
		fs.renameSync(tmpDir, finalDir);
		return finalDir;
	}
	catch (error) {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		throw error;
	}
	finally {
		fs.rmSync(archive, { force: true });
	}
}

// Keeps the running version, the previous one and the most recent others
export function pruneVersions(root, keep = []) {
	const dir = path.join(root, 'versions');
	if (!fs.existsSync(dir)) return;
	const installed = fs.readdirSync(dir)
		.filter(name => VERSION.test(name))
		.map(name => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	const kept = new Set(keep.filter(Boolean));
	let extra = 0;
	for (const { name } of installed) {
		if (kept.has(name)) continue;
		if (extra < KEEP_VERSIONS) {
			extra++;
			continue;
		}
		fs.rmSync(path.join(dir, name), { recursive: true, force: true });
	}
}
