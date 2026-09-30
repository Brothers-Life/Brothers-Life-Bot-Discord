import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

// ffmpeg turns the audio into what Discord expects (and applies speed, filters, seek).
// Order: FFMPEG_PATH, then an ffmpeg installed on the machine, then a static build downloaded into data/bin.
const RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';

function onPath() {
	try {
		execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { stdio: 'ignore' });
		return 'ffmpeg';
	}
	catch {
		return null;
	}
}

export function createFfmpeg({ dataDir, logger = console }) {
	const file = path.join(dataDir, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
	let found = null;
	let download = null;

	async function fetchBinary() {
		const response = await fetch(`${RELEASE}/ffmpeg-${process.platform}-${process.arch}.gz`, { redirect: 'follow' });
		if (!response.ok) throw new Error(`téléchargement de ffmpeg impossible (${response.status})`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.part`;
		fs.writeFileSync(tmp, zlib.gunzipSync(Buffer.from(await response.arrayBuffer())));
		fs.chmodSync(tmp, 0o755);
		fs.renameSync(tmp, file);
		logger.info?.('ffmpeg downloaded');
	}

	return {
		async path() {
			if (found) return found;
			if (process.env.FFMPEG_PATH) return (found = process.env.FFMPEG_PATH);
			const system = onPath();
			if (system) return (found = system);
			if (!fs.existsSync(file)) {
				download ??= fetchBinary().finally(() => { download = null; });
				await download;
			}
			return (found = file);
		},
	};
}
