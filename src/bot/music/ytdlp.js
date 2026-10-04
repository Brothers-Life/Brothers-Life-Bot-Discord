import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { unzip } from './unzip.js';

// yt-dlp reads YouTube (and SoundCloud, Twitch, etc.). Its standalone build is downloaded into data/bin
// and refreshed every few days: YouTube changes often and old versions stop working.
// On Linux the "onedir" build (.zip) is used: the single-file one unpacks ~90 MB into /tmp at every run,
// which fills the small /tmp of hosted containers (and leaves leftovers when a track is skipped).
const glibc = Boolean(process.report?.getReport?.().header?.glibcVersionRuntime);
const ASSETS = {
	win32: { name: 'yt-dlp.exe' },
	darwin: { name: 'yt-dlp_macos' },
	linux: { name: process.arch === 'arm64' ? (glibc ? 'yt-dlp_linux_aarch64' : 'yt-dlp_musllinux_aarch64') : glibc ? 'yt-dlp_linux' : 'yt-dlp_musllinux', zip: true },
};
const REFRESH_MS = 3 * 86_400_000;

export function createYtDlp({ dataDir, logger = console }) {
	const asset = ASSETS[process.platform];
	const binDir = path.join(dataDir, 'bin');
	const appDir = path.join(binDir, 'yt-dlp-app');
	const file = asset?.zip ? path.join(appDir, asset.name) : path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
	// Netscape cookies file exported from a browser: needed when YouTube asks the server to "sign in"
	const cookies = path.join(dataDir, 'youtube-cookies.txt');
	let download = null;

	async function fetchBinary() {
		if (!asset) throw new Error(`yt-dlp n’existe pas pour ${process.platform}`);
		const response = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset.name}${asset.zip ? '.zip' : ''}`, { redirect: 'follow' });
		if (!response.ok) throw new Error(`téléchargement de yt-dlp impossible (${response.status})`);
		const content = Buffer.from(await response.arrayBuffer());
		fs.mkdirSync(binDir, { recursive: true });
		if (asset.zip) {
			const fresh = `${appDir}.new`;
			fs.rmSync(fresh, { recursive: true, force: true });
			unzip(content, fresh);
			// Running processes keep their files (Linux): the old folder can go
			fs.rmSync(appDir, { recursive: true, force: true });
			fs.renameSync(fresh, appDir);
			// The single-file build of earlier versions
			fs.rmSync(path.join(binDir, 'yt-dlp'), { force: true });
		}
		else {
			const tmp = `${file}.part`;
			fs.writeFileSync(tmp, content);
			fs.chmodSync(tmp, 0o755);
			fs.renameSync(tmp, file);
		}
		logger.info?.('yt-dlp downloaded');
	}

	// Leftovers of the single-file build in /tmp (_MEIxxxx folders of ~90 MB each)
	let cleaned = false;
	function cleanTmp() {
		if (cleaned || !asset?.zip) return;
		cleaned = true;
		const tmp = os.tmpdir();
		for (const name of fs.readdirSync(tmp).filter(n => n.startsWith('_MEI'))) {
			try {
				const full = path.join(tmp, name);
				if (Date.now() - fs.statSync(full).mtimeMs > 10 * 60_000) fs.rmSync(full, { recursive: true, force: true });
			}
			catch {
				// someone else's folder
			}
		}
	}

	async function binary() {
		if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
		cleanTmp();
		const stat = fs.existsSync(file) ? fs.statSync(file) : null;
		if (!stat) {
			download ??= fetchBinary().finally(() => { download = null; });
			await download;
		}
		else if (Date.now() - stat.mtimeMs > REFRESH_MS && !download) {
			// Refreshed in the background: the current version keeps working meanwhile
			download = fetchBinary().catch(error => logger.warn('yt-dlp update failed:', error.message)).finally(() => { download = null; });
		}
		return file;
	}

	function baseArgs() {
		const base = ['--no-warnings', '--ignore-config', '--js-runtimes', `node:${process.execPath}`];
		if (fs.existsSync(cookies)) base.push('--cookies', cookies);
		return base;
	}

	return {
		cookiesPath: cookies,

		// The audio of a link, written on stdout as it downloads (piped into ffmpeg)
		async spawnAudio(target) {
			const bin = await binary();
			const child = spawn(bin, [...baseArgs(), '-f', 'bestaudio[acodec=opus]/bestaudio/best', '--no-playlist', '--no-part', '-q', '-o', '-', target], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
			// Listened at once: a failed spawn emits "error" on the next tick, before the caller can listen (crash otherwise)
			child.on('error', error => logger.warn('yt-dlp failed to start:', error.message));
			return child;
		},

		// Runs yt-dlp and returns its parsed JSON output
		async json(args, { timeout = 45_000 } = {}) {
			const bin = await binary();
			const base = [...baseArgs(), '-J'];
			const stdout = await new Promise((resolve, reject) => {
				execFile(bin, [...base, ...args], { maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true }, (error, out, err) => {
					if (error) {
						const line = String(err || error.message).split('\n').find(l => l.startsWith('ERROR')) ?? String(err || error.message).trim().split('\n').at(-1);
						reject(new Error(humanError(line)));
					}
					else {
						resolve(out);
					}
				});
			});
			return JSON.parse(stdout);
		},
	};
}

export function humanError(line = '') {
	if (/Sign in to confirm/i.test(line)) return 'YouTube demande une connexion : ajoute un fichier de cookies (voir la page Musique du panel).';
	if (/Private video|private/i.test(line)) return 'Vidéo privée.';
	if (/age/i.test(line) && /confirm/i.test(line)) return 'Vidéo réservée aux adultes : cookies nécessaires.';
	if (/unavailable|not available/i.test(line)) return 'Vidéo indisponible.';
	if (/Unsupported URL/i.test(line)) return 'Ce lien n’est pas pris en charge.';
	return line.replace(/^ERROR:\s*/, '').slice(0, 200) || 'Lecture impossible.';
}
