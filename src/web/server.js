import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { getTlsOptions } from './tls.js';
import { errorHandler, sendError } from './errors.js';
import { registerGuard } from './guard.js';
import { registerAuthRoutes } from './auth.js';
import { registerPanelRoutes } from './routes/panel.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerSanctionRoutes } from './routes/sanctions.js';
import { registerEventRoutes } from './routes/events.js';
import { registerAutomodRoutes } from './routes/automod.js';
import { registerMemberRoutes } from './routes/members.js';
import { registerTicketRoutes } from './routes/tickets.js';
import { registerPermissionRoutes } from './routes/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATIC_DIR = path.resolve(__dirname, '..', '..', 'web', 'dist');

const SECURITY_HEADERS = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'same-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
	'Content-Security-Policy': [
		'default-src \'self\'',
		'img-src \'self\' data: https://cdn.discordapp.com',
		'style-src \'self\' \'unsafe-inline\'',
		'font-src \'self\' data:',
		'connect-src \'self\'',
		'frame-ancestors \'none\'',
		'base-uri \'self\'',
		'form-action \'self\'',
	].join('; '),
};

export async function createWebServer({ config, core, runtime, consoleLog, versions, logger, fetchImpl = fetch, staticDir = DEFAULT_STATIC_DIR, tls }) {
	const https = tls === undefined ? await getTlsOptions(config, logger) : tls;
	const app = Fastify({
		https: https ?? undefined,
		logger: false,
		trustProxy: false,
		bodyLimit: 256 * 1024,
	});

	app.setErrorHandler(errorHandler(logger));
	app.addHook('onSend', async (request, reply) => {
		reply.headers(SECURITY_HEADERS);
		if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
	});

	await app.register(cookie);
	await app.register(rateLimit, { global: false });
	await app.register(websocket, { options: { maxPayload: 4096 } });
	registerGuard(app, core);

	registerAuthRoutes(app, { config, core, fetchImpl });
	registerPanelRoutes(app, { core, runtime });
	registerSystemRoutes(app, { core, runtime, consoleLog, versions });
	registerSanctionRoutes(app, { core });
	registerEventRoutes(app, { core });
	registerAutomodRoutes(app, { core });
	registerMemberRoutes(app, { core });
	registerTicketRoutes(app, { core });
	registerPermissionRoutes(app, { core });

	const hasPanel = fs.existsSync(path.join(staticDir, 'index.html'));
	if (hasPanel) {
		await app.register(fastifyStatic, { root: staticDir, index: false });
	}

	// Unknown /api routes answer JSON; everything else is the React app (client-side routing)
	app.setNotFoundHandler((request, reply) => {
		if (request.url.startsWith('/api')) return sendError(reply, 404, 'NOT_FOUND', 'Route d’API inconnue.');
		if (!hasPanel) return reply.type('text/plain').send('Panel not built: run "npm run build" in web/ (or use a release).');
		return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
	});

	return {
		app,
		async listen() {
			await app.listen({ port: config.WEB_PORT, host: '0.0.0.0' });
			logger.info(`Panel listening on port ${config.WEB_PORT} (${config.WEB_MODE}) → ${config.WEB_PUBLIC_URL}`);
		},
		close: () => app.close(),
	};
}
