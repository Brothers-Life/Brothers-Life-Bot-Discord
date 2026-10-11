// Split deployment: a process without access to the panel (the front) installs the version the panel asked for.
// fetchJson() returns { version, assetId } (or {}); the install itself is done by launcher.js.
const CHECK_MS = 2 * 60_000;

export function followRelease({ fetchJson, appVersion, ipc, logger, everyMs = CHECK_MS }) {
	if (!ipc.supervised) return () => undefined;
	let asked = null;
	const check = async () => {
		try {
			const release = await fetchJson();
			if (!release?.version || release.version === `v${appVersion}` || release.version === asked) return;
			asked = release.version;
			logger.info(`Installing ${release.version}, as asked from the panel`);
			ipc.send({ type: 'install', version: release.version, assetId: release.assetId });
		}
		catch (error) {
			logger.debug?.(`Version check skipped: ${error.message}`);
		}
	};
	const first = setTimeout(check, 15_000);
	const timer = setInterval(check, everyMs);
	first.unref();
	timer.unref();
	return () => {
		clearTimeout(first);
		clearInterval(timer);
	};
}
