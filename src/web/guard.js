import { sendError } from './errors.js';
import { requestContext } from '../core/requestContext.js';

export const SESSION_COOKIE = 'sid';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BEARER = /^Bearer\s+(\S+)$/i;

// Requests per minute and per API key
export const API_RATE_LIMIT = 240;

// Every /api route must declare `config.permission` (a string, or null for "logged in with panel.access")
// or `config.public: true`. A route without declaration refuses to start: no route is open by accident.
// `config.apiKey: false` keeps a route for the panel only (API keys get a 403 there).
// Returns the list of declared routes, used for the API documentation (OpenAPI, Bruno).
export function registerGuard(app, core) {
	const routes = [];
	app.addHook('onRoute', (route) => {
		if (!route.url.startsWith('/api')) return;
		const config = route.config ?? {};
		if (!config.public && config.permission === undefined) {
			throw new Error(`Route ${route.method} ${route.url} must declare config.permission or config.public`);
		}
		for (const method of [route.method].flat()) {
			if (method === 'HEAD') continue;
			routes.push({
				method,
				url: route.url,
				permission: config.permission ?? null,
				public: Boolean(config.public),
				confirm: Boolean(config.confirm),
				apiKey: !config.public && config.apiKey !== false && !route.websocket,
				websocket: Boolean(route.websocket),
				schema: route.schema ?? null,
			});
		}
	});

	app.addHook('onRequest', (request, reply, done) => requestContext.run({}, done));
	app.decorateRequest('session', null);
	app.decorateRequest('actor', null);

	// Fixed one-minute windows, per key
	const windows = new Map();
	function overLimit(keyId) {
		const minute = Math.floor(Date.now() / 60_000);
		const w = windows.get(keyId);
		if (!w || w.minute !== minute) {
			if (windows.size > 1000) windows.clear();
			windows.set(keyId, { minute, count: 1 });
			return false;
		}
		w.count += 1;
		return w.count > API_RATE_LIMIT;
	}

	app.addHook('preHandler', async (request, reply) => {
		const config = request.routeOptions.config ?? {};
		if (!request.url.startsWith('/api') || config.public) return;

		const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
		let actor;
		if (bearer) {
			const key = core.apiKeys.authenticate(bearer, request.ip);
			if (!key) return sendError(reply, 401, 'INVALID_API_KEY', 'Clé d’API invalide, expirée ou révoquée.');
			if (config.apiKey === false || request.ws) return sendError(reply, 403, 'PANEL_ONLY', 'Cette route n’est pas accessible avec une clé d’API.');
			if (overLimit(key.id)) {
				reply.header('Retry-After', String(60 - Math.floor(Date.now() / 1000) % 60));
				return sendError(reply, 429, 'RATE_LIMITED', `Trop de requêtes : ${API_RATE_LIMIT} par minute et par clé.`);
			}
			actor = await core.apiKeys.actorFor(key);
			request.actor = actor;
			const context = requestContext.get();
			if (context) context.apiKey = actor.apiKey;
		}
		else {
			// Browsers can't send this header cross-site without a CORS preflight, which we never allow.
			// A bearer key is never sent automatically by a browser, so it needs no such check.
			if (MUTATING.has(request.method) && request.headers['x-requested-with'] !== 'panel') {
				return sendError(reply, 403, 'CSRF', 'En-tête X-Requested-With manquant.');
			}
			actor = await authenticate(request, core);
			if (!actor) return sendError(reply, 401, 'UNAUTHENTICATED', 'Connecte-toi.');
		}

		if (!actor.can('panel.access')) return sendError(reply, 403, 'FORBIDDEN', 'Tu n’as plus accès au panel.');
		if (bearer && !actor.can('api.use')) return sendError(reply, 403, 'FORBIDDEN', 'Permission manquante : api.use');
		if (config.permission && !actor.can(config.permission)) {
			return sendError(reply, 403, 'FORBIDDEN', `Permission manquante : ${config.permission}`);
		}
		if (config.confirm && request.body?.confirm !== true) {
			return sendError(reply, 400, 'CONFIRMATION_REQUIRED', 'Cette action doit être confirmée.');
		}
	});

	return routes;
}

// Reads the session cookie; sets request.session and request.actor
export async function authenticate(request, core) {
	// The cookie holds a 256-bit random id: nothing to sign, it is only looked up server-side
	const session = core.sessions.touch(request.cookies?.[SESSION_COOKIE]);
	if (!session) return null;

	const principal = await core.ranks.resolve(session.discordId);
	request.session = session;
	request.actor = { ...principal, source: 'panel', can: principal.can };
	return request.actor;
}
