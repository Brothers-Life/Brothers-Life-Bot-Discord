import crypto from 'node:crypto';
import { SESSION_COOKIE } from './guard.js';

const DISCORD = 'https://discord.com';
const STATE_COOKIE = 'oauth_state';
const SESSION_TTL_S = 12 * 3600;

function safeEqual(a, b) {
	const x = Buffer.from(String(a));
	const y = Buffer.from(String(b));
	return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Discord OAuth2 (code grant, scope identify). Access requires panel.access (or OWNER_ID).
export function registerAuthRoutes(app, { config, core, fetchImpl = fetch }) {
	const secure = config.WEB_MODE !== 'http';
	const redirectUri = `${config.WEB_PUBLIC_URL}/api/auth/callback`;
	const rateLimit = { max: 10, timeWindow: '15 minutes' };

	function audit(action, request, actorId, details) {
		core.audit.record({ actorId, source: 'panel', action, target: actorId, details: { ip: request.ip, ...details } });
	}

	app.get('/api/auth/login', { config: { public: true, rateLimit } }, async (request, reply) => {
		if (!config.CLIENT_SECRET || !config.APP_ID) {
			return reply.redirect('/login?error=not_configured');
		}
		const state = crypto.randomBytes(24).toString('base64url');
		// Lax: this cookie must survive the top-level redirect back from discord.com
		reply.setCookie(STATE_COOKIE, state, { path: '/api/auth', httpOnly: true, sameSite: 'lax', secure, maxAge: 600 });

		const url = new URL('/oauth2/authorize', DISCORD);
		url.search = new URLSearchParams({
			client_id: config.APP_ID,
			response_type: 'code',
			redirect_uri: redirectUri,
			scope: 'identify',
			state,
			prompt: 'none',
		}).toString();
		return reply.redirect(url.toString());
	});

	app.get('/api/auth/callback', { config: { public: true, rateLimit } }, async (request, reply) => {
		const { code, state, error } = request.query ?? {};
		const expected = request.cookies?.[STATE_COOKIE];
		reply.clearCookie(STATE_COOKIE, { path: '/api/auth' });

		if (error) return reply.redirect('/login?error=cancelled');
		if (!code || !state || !expected || !safeEqual(state, expected)) {
			return reply.redirect('/login?error=state');
		}

		let user;
		try {
			const tokenRes = await fetchImpl(`${DISCORD}/api/oauth2/token`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					client_id: config.APP_ID,
					client_secret: config.CLIENT_SECRET,
					grant_type: 'authorization_code',
					code: String(code),
					redirect_uri: redirectUri,
				}),
			});
			if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
			const token = await tokenRes.json();

			const userRes = await fetchImpl(`${DISCORD}/api/users/@me`, {
				headers: { Authorization: `Bearer ${token.access_token}` },
			});
			if (!userRes.ok) throw new Error(`user lookup failed (${userRes.status})`);
			user = await userRes.json();
		}
		catch (err) {
			request.log.warn(err);
			return reply.redirect('/login?error=discord');
		}

		core.ranks.invalidate(user.id);
		const principal = await core.ranks.resolve(user.id);
		if (!principal.can('panel.access')) {
			audit('panel.login_denied', request, user.id, { username: user.username });
			return reply.redirect('/login?error=denied');
		}

		const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
		const sessionId = core.sessions.create({
			discordId: user.id,
			username: user.global_name ?? user.username,
			avatar,
			ip: request.ip,
			userAgent: request.headers['user-agent'],
		});
		audit('panel.login', request, user.id, { username: user.username });

		reply.setCookie(SESSION_COOKIE, sessionId, { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: SESSION_TTL_S });
		return reply.redirect('/');
	});

	app.post('/api/auth/logout', { config: { public: true } }, async (request, reply) => {
		const sessionId = request.cookies?.[SESSION_COOKIE];
		if (request.headers['x-requested-with'] !== 'panel') return reply.code(403).send({ error: { code: 'CSRF', message: 'Missing X-Requested-With header.' } });
		const session = sessionId ? core.sessions.get(sessionId) : null;
		if (session) {
			core.sessions.revoke(sessionId);
			audit('panel.logout', request, session.discordId);
		}
		reply.clearCookie(SESSION_COOKIE, { path: '/' });
		return { ok: true };
	});
}
