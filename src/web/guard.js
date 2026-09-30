import { sendError } from './errors.js';

export const SESSION_COOKIE = 'sid';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Every /api route must declare `config.permission` (a string, or null for "logged in with panel.access")
// or `config.public: true`. A route without declaration refuses to start: no route is open by accident.
export function registerGuard(app, core) {
	app.addHook('onRoute', (route) => {
		if (!route.url.startsWith('/api')) return;
		const config = route.config ?? {};
		if (!config.public && config.permission === undefined) {
			throw new Error(`Route ${route.method} ${route.url} must declare config.permission or config.public`);
		}
	});

	app.decorateRequest('session', null);
	app.decorateRequest('actor', null);

	app.addHook('preHandler', async (request, reply) => {
		const config = request.routeOptions.config ?? {};
		if (!request.url.startsWith('/api') || config.public) return;

		// Browsers can't send this header cross-site without a CORS preflight, which we never allow
		if (MUTATING.has(request.method) && request.headers['x-requested-with'] !== 'panel') {
			return sendError(reply, 403, 'CSRF', 'Missing X-Requested-With header.');
		}

		const actor = await authenticate(request, core);
		if (!actor) return sendError(reply, 401, 'UNAUTHENTICATED', 'Please log in.');
		if (!actor.can('panel.access')) return sendError(reply, 403, 'FORBIDDEN', 'You no longer have access to the panel.');
		if (config.permission && !actor.can(config.permission)) {
			return sendError(reply, 403, 'FORBIDDEN', `Missing permission: ${config.permission}`);
		}
		if (config.confirm && request.body?.confirm !== true) {
			return sendError(reply, 400, 'CONFIRMATION_REQUIRED', 'This action must be confirmed (confirm: true).');
		}
	});
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
