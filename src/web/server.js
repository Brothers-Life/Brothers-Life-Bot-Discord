import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { getTlsOptions, ensureSelfSigned } from './tls.js';
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
import { registerAnnouncementRoutes } from './routes/announcements.js';
import { registerOnboardingRoutes } from './routes/onboarding.js';
import { registerAntiraidRoutes } from './routes/antiraid.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerPollRoutes } from './routes/polls.js';
import { registerGiveawayRoutes } from './routes/giveaways.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerStaffRoutes } from './routes/staff.js';
import { registerStreamRoutes } from './routes/streams.js';
import { registerFivemRoutes } from './routes/fivem.js';
import { registerDmRoutes } from './routes/dms.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerCustomCommandRoutes } from './routes/customCommands.js';
import { registerBackupRoutes } from './routes/backups.js';
import { registerStaffActivityRoutes } from './routes/staffActivity.js';
import { registerRpEventRoutes } from './routes/rpEvents.js';
import { registerMusicRoutes } from './routes/music.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATIC_DIR = path.resolve(__dirname, '..', '..', 'web', 'dist');

const SECURITY_HEADERS = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'same-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
	'Content-Security-Policy': [
		'default-src \'self\'',
		// Any https image (announcement previews), blob: for the card previews rendered by the server
		'img-src \'self\' data: blob: https:',
		'style-src \'self\' \'unsafe-inline\'',
		'font-src \'self\' data:',
		'connect-src \'self\'',
		// Music page: the clip of the song being played
		'frame-src https://www.youtube-nocookie.com',
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
	registerAnnouncementRoutes(app, { core });
	registerOnboardingRoutes(app, { core });
	registerAntiraidRoutes(app, { core });
	registerStatsRoutes(app, { core });
	registerVoiceRoutes(app, { core });
	registerMessageRoutes(app, { core });
	registerPollRoutes(app, { core });
	registerGiveawayRoutes(app, { core });
	registerFeedbackRoutes(app, { core });
	registerStaffRoutes(app, { core });
	registerStreamRoutes(app, { core });
	registerFivemRoutes(app, { core });
	registerDmRoutes(app, { core });
	registerTemplateRoutes(app, { core });
	registerCustomCommandRoutes(app, { core });
	registerBackupRoutes(app, { core });
	registerStaffActivityRoutes(app, { core });
	registerRpEventRoutes(app, { core });
	registerMusicRoutes(app, { core });

	const hasPanel = fs.existsSync(path.join(staticDir, 'index.html'));
	const sendPanel = (reply) => {
		if (!hasPanel) return reply.type('text/plain').send('Panel not built: run "npm run build" in web/ (or use a release).');
		return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
	};
	if (hasPanel) {
		await app.register(fastifyStatic, { root: staticDir, index: false });
	}
	// "/" is a directory for @fastify/static, which refuses it (403) when index is off: serve the app explicitly
	app.get('/', (request, reply) => sendPanel(reply));

	// Unknown /api routes answer JSON, missing build files a real 404; everything else is the React app
	app.setNotFoundHandler((request, reply) => {
		if (request.url.startsWith('/api')) return sendError(reply, 404, 'NOT_FOUND', 'Route d’API inconnue.');
		if (request.url.startsWith('/assets/')) return reply.code(404).type('text/plain').send('Not found');
		return sendPanel(reply);
	});

	// The self-signed certificate lives 397 days: renew it in place, without restarting the bot
	let renewTimer = null;
	if (https && config.WEB_MODE === 'https-selfsigned') {
		renewTimer = setInterval(async () => {
			try {
				const { cert, key, renewed } = await ensureSelfSigned(config, logger);
				if (renewed) {
					app.server.setSecureContext({ cert, key });
					logger.warn('Panel certificate renewed: browsers will show the warning once more.');
				}
			}
			catch (error) {
				logger.error('Certificate renewal failed:', error);
			}
		}, 24 * 3600_000);
		renewTimer.unref();
	}

	return {
		app,
		async listen() {
			await app.listen({ port: config.WEB_PORT, host: '0.0.0.0' });
			logger.info(`Panel listening on port ${config.WEB_PORT} (${config.WEB_MODE}) → ${config.WEB_PUBLIC_URL}`);
		},
		close: () => {
			clearInterval(renewTimer);
			return app.close();
		},
	};
}
