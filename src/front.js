// Front process of a split deployment: serves the panel (React app built in web/dist) and forwards /api
// (and its websockets) and /public to the API (API_URL). This is the only address browsers use (WEB_PUBLIC_URL).
import { pkg, ipc, logger, onShutdown, run, shutdown } from './app/process.js';
import config from './utils/config.js';
import { createFrontServer } from './web/front.js';
import { getTlsOptions } from './web/tls.js';
import { followRelease } from './app/release.js';

run(async () => {
	logger.info(`Brothers Life bot v${pkg.version} (${config.ENV}) — front`);
	if (!config.API_URL) {
		logger.error('API_URL is missing: the front needs the address of the API (e.g. http://api:3001).');
		await shutdown(1);
		return;
	}
	const tls = await getTlsOptions(config, logger);
	const front = createFrontServer({ config, tls, logger });
	await front.listen();
	onShutdown(() => front.close());

	// Installs the version the panel asked for, like the bot and the API do
	const stop = followRelease({ fetchJson: () => front.apiJson('/api/system/release'), appVersion: pkg.version, ipc, logger });
	onShutdown(stop);

	ipc.send({ type: 'ready', version: `v${pkg.version}` });
	logger.success(`Front ready: ${config.WEB_PUBLIC_URL} → API ${config.API_URL}`);
});
