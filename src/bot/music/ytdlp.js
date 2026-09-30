import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

// yt-dlp reads YouTube (and SoundCloud, Twitch, etc.). Its standalone build is downloaded into data/bin
// and refreshed every few days: YouTube changes often and old versions stop working.
const ASSETS = {
	win32: 'yt-dlp.exe',
	darwin: 'yt-dlp_macos',
	// Alpine-based images (musl, no glibc) need their own build
	linux: process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : process.report?.getReport?.().header?.glibcVersionRuntime ? 'yt-dlp_linux' : 'yt-dlp_musllinux',
};
const REFRESH_MS = 3 * 86_400_000;

export function createYtDlp({ dataDir, logger = console }) {
	const file = path.join(dataDir, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
	// Netscape cookies file exported from a browser: needed when YouTube asks the server to "sign in"
	const cookies = path.join(dataDir, 'youtube-cookies.txt');
	let download = null;

	async function fetchBinary() {
		const asset = ASSETS[process.platform];
		if (!asset) throw new Error(`yt-dlp n’existe pas pour ${process.platform}`);
		const response = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, { redirect: 'follow' });
		if (!response.ok) throw new Error(`téléchargement de yt-dlp impossible (${response.status})`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.part`;
		fs.writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
		fs.chmodSync(tmp, 0o755);
		fs.renameSync(tmp, file);
		logger.info?.('yt-dlp downloaded');
	}

	async function binary() {
		if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
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
			return spawn(bin, [...baseArgs(), '-f', 'bestaudio[acodec=opus]/bestaudio/best', '--no-playlist', '--no-part', '-q', '-o', '-', target], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
