import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, OWNER, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { createWebServer } from '../../src/web/server.js';

const noop = () => undefined;
const silent = { info: noop, warn: noop, error: noop };

// Fake Discord OAuth: the code is the Discord user id
function fakeDiscord() {
	return async (url, options = {}) => {
		const u = String(url);
		if (u.endsWith('/oauth2/token')) {
			const code = new URLSearchParams(options.body).get('code');
			if (code === 'bad') return new Response('{}', { status: 400 });
			return Response.json({ access_token: `token-${code}` });
		}
		if (u.endsWith('/users/@me')) {
			const id = options.headers.Authorization.replace('Bearer token-', '');
			return Response.json({ id, username: `user${id.slice(-2)}`, global_name: null, avatar: null });
		}
		throw new Error(`unexpected fetch ${u}`);
	};
}

async function setup() {
	const ctx = await withNetwork();
	const runtimeCalls = [];
	const runtime = {
		info: () => ({ version: 'v1.0.0', supervised: false }),
		installState: () => null,
		restart: () => runtimeCalls.push('restart'),
		stop: () => runtimeCalls.push('stop'),
		install: (p) => runtimeCalls.push(['install', p]),
	};
	const consoleLog = { lines: () => [], subscribe: () => noop };
	const versions = { describe: async () => ({ releases: [] }), current: () => ({ version: 'v1.0.0' }), ignore: noop, prepareInstall: async () => ({}) };
	const config = { ...ctx.core.config, APP_ID: '111111111111111111', CLIENT_SECRET: 'secret', WEB_PUBLIC_URL: 'http://localhost:3000' };
	ctx.core.config.APP_ID = config.APP_ID;
	const web = await createWebServer({ config, core: ctx.core, runtime, consoleLog, versions, logger: silent, fetchImpl: fakeDiscord(), staticDir: '/nonexistent', tls: null });
	return { ...ctx, app: web.app, runtimeCalls };
}

function cookiesOf(res) {
	return Object.fromEntries(res.cookies.map(c => [c.name, c.value]));
}

async function login(app, userId) {
	const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
	assert.equal(start.statusCode, 302);
	const state = new URL(start.headers.location).searchParams.get('state');
	const res = await app.inject({
		method: 'GET',
		url: `/api/auth/callback?code=${userId}&state=${state}`,
		cookies: { oauth_state: cookiesOf(start).oauth_state },
	});
	return res;
}

async function sessionFor(app, userId) {
	const res = await login(app, userId);
	assert.equal(res.headers.location, '/', `login of ${userId} should succeed`);
	return { sid: cookiesOf(res).sid };
}

function api(app, cookies) {
	return (method, url, body) => app.inject({
		method,
		url,
		cookies,
		headers: method === 'GET' ? {} : { 'x-requested-with': 'panel' },
		...(body === undefined ? {} : { payload: body }),
	});
}

test('the owner can log in and read /api/me', async () => {
	const { app } = await setup();
	const call = api(app, await sessionFor(app, OWNER));
	const res = await call('GET', '/api/me');
	assert.equal(res.statusCode, 200);
	const me = res.json();
	assert.equal(me.user.id, OWNER);
	assert.equal(me.isOwner, true);
	assert.ok(me.permissions.includes('versions.install'));
});

test('login is refused without panel.access and audited', async () => {
	const { app, core } = await setup();
	const res = await login(app, ALICE);
	assert.equal(res.headers.location, '/login?error=denied');
	assert.equal(cookiesOf(res).sid, undefined);
	assert.equal(core.audit.query({ action: 'panel.login_denied' }).length, 1);
});

test('login fails on a wrong state', async () => {
	const { app } = await setup();
	const res = await app.inject({ method: 'GET', url: `/api/auth/callback?code=${OWNER}&state=forged`, cookies: { oauth_state: 'other' } });
	assert.equal(res.headers.location, '/login?error=state');
});

test('the session cookie is HttpOnly and SameSite=Strict', async () => {
	const { app } = await setup();
	const res = await login(app, OWNER);
	const sid = res.cookies.find(c => c.name === 'sid');
	assert.equal(sid.httpOnly, true);
	assert.equal(sid.sameSite, 'Strict');
});

test('401 without session, JSON 404 on unknown API routes', async () => {
	const { app } = await setup();
	const res = await app.inject({ method: 'GET', url: '/api/me' });
	assert.equal(res.statusCode, 401);
	assert.equal(res.json().error.code, 'UNAUTHENTICATED');
	const cookies = await sessionFor(app, OWNER);
	assert.equal((await api(app, cookies)('GET', '/api/nope')).json().error.code, 'NOT_FOUND');
});

test('permissions are enforced per route', async () => {
	const { app, core, owner } = await setup();
	const viewer = core.ranks.create(owner, { name: 'Viewer', level: 10, permissions: ['panel.access', 'network.view'] });
	await core.ranks.assignDirect(owner, ALICE, viewer.id);
	const call = api(app, await sessionFor(app, ALICE));

	assert.equal((await call('GET', '/api/network')).statusCode, 200);
	const denied = await call('GET', '/api/ranks');
	assert.equal(denied.statusCode, 403);
	assert.equal(denied.json().error.code, 'FORBIDDEN');
	assert.equal((await call('POST', `/api/network/${OTHER}/activate`)).statusCode, 403);
});

test('losing panel.access locks out an open session immediately', async () => {
	const { app, core, owner } = await setup();
	const viewer = core.ranks.create(owner, { name: 'Viewer', level: 10, permissions: ['panel.access'] });
	await core.ranks.assignDirect(owner, ALICE, viewer.id);
	const call = api(app, await sessionFor(app, ALICE));
	assert.equal((await call('GET', '/api/me')).statusCode, 200);

	core.ranks.update(owner, viewer.id, { permissions: [] });
	assert.equal((await call('GET', '/api/me')).statusCode, 403);
});

test('mutations need the X-Requested-With header', async () => {
	const { app } = await setup();
	const cookies = await sessionFor(app, OWNER);
	const res = await app.inject({ method: 'POST', url: `/api/network/${OTHER}/activate`, cookies });
	assert.equal(res.statusCode, 403);
	assert.equal(res.json().error.code, 'CSRF');
});

test('sensitive actions need confirm: true', async () => {
	const { app, core } = await setup();
	const call = api(app, await sessionFor(app, OWNER));
	const res = await call('POST', `/api/network/${OTHER}/main`, {});
	assert.equal(res.statusCode, 400);
	assert.equal(res.json().error.code, 'CONFIRMATION_REQUIRED');
	assert.equal((await call('POST', `/api/network/${OTHER}/main`, { confirm: true })).statusCode, 200);
	assert.equal(core.network.getMainId(), OTHER);
});

test('rank CRUD and anti-escalation through the API', async () => {
	const { app, core, owner } = await setup();
	const admin = core.ranks.create(owner, { name: 'Admin', level: 50, permissions: ['panel.access', 'ranks.view', 'ranks.manage', 'members.assign'] });
	await core.ranks.assignDirect(owner, ALICE, admin.id);
	const call = api(app, await sessionFor(app, ALICE));

	const created = await call('POST', '/api/ranks', { name: 'Modo', level: 20, permissions: ['panel.access'] });
	assert.equal(created.statusCode, 201);
	const escalate = await call('POST', '/api/ranks', { name: 'Evil', level: 20, permissions: ['versions.install'] });
	assert.equal(escalate.statusCode, 403);
	const self = await call('POST', `/api/members/${ALICE}/ranks`, { rankId: created.json().id });
	assert.equal(self.statusCode, 403);
	const other = await call('POST', `/api/members/${BOB}/ranks`, { rankId: created.json().id });
	assert.equal(other.statusCode, 200);

	const members = (await call('GET', '/api/members')).json();
	assert.deepEqual(members.map(m => m.id).sort(), [ALICE, BOB].sort());
});

test('log routes through the API', async () => {
	const { app, executor } = await setup();
	executor.channels.set('123456789012345678', { guildId: MAIN, name: 'logs' });
	const call = api(app, await sessionFor(app, OWNER));
	const res = await call('PUT', `/api/logs/${MAIN}/ranks`, { channelId: '123456789012345678' });
	assert.equal(res.statusCode, 200, res.body);
	const logs = (await call('GET', '/api/logs')).json();
	assert.deepEqual(logs.guilds.find(g => g.id === MAIN).routes, [{ category: 'ranks', channelId: '123456789012345678', enabled: true }]);
});

test('sessions: list own, revoke, never expose raw ids', async () => {
	const { app } = await setup();
	const cookies = await sessionFor(app, OWNER);
	const call = api(app, cookies);
	await sessionFor(app, OWNER);
	const list = (await call('GET', '/api/sessions')).json();
	assert.equal(list.length, 2);
	assert.ok(list.every(s => s.id === undefined && s.key));
	const other = list.find(s => !s.current);
	assert.equal((await call('DELETE', `/api/sessions/${other.key}`)).statusCode, 200);
	assert.equal((await call('GET', '/api/sessions')).json().length, 1);
});

test('restart goes through the runtime and is audited', async () => {
	const { app, core, runtimeCalls } = await setup();
	const call = api(app, await sessionFor(app, OWNER));
	assert.equal((await call('POST', '/api/system/restart', { confirm: true })).statusCode, 200);
	await new Promise(r => setTimeout(r, 400));
	assert.deepEqual(runtimeCalls, ['restart']);
	assert.equal(core.audit.query({ action: 'system.restart' }).length, 1);
});

test('logout revokes the session', async () => {
	const { app } = await setup();
	const cookies = await sessionFor(app, OWNER);
	const res = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies, headers: { 'x-requested-with': 'panel' } });
	assert.equal(res.statusCode, 200);
	assert.equal((await api(app, cookies)('GET', '/api/me')).statusCode, 401);
});

test('security headers are set', async () => {
	const { app } = await setup();
	const res = await app.inject({ method: 'GET', url: '/api/me' });
	assert.equal(res.headers['x-frame-options'], 'DENY');
	assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('sanctions through the API: create with a duration, list, revoke', async () => {
	const { app, core, executor } = await setup();
	const call = api(app, await sessionFor(app, OWNER));
	const created = await call('POST', '/api/sanctions', { type: 'ban', userId: '300000000000000001', reason: 'Raid', duration: '7j' });
	assert.equal(created.statusCode, 201, created.body);
	const ban = created.json();
	assert.ok(ban.expiresAt - ban.createdAt >= 7 * 86_400_000 - 1000);
	assert.equal(executor.calls.filter(c => c[0] === 'ban').length, 1);

	const bad = await call('POST', '/api/sanctions', { type: 'ban', userId: '300000000000000001', duration: 'demain' });
	assert.equal(bad.statusCode, 400);

	const list = (await call('GET', '/api/sanctions?active=true')).json();
	assert.equal(list.length, 1);
	assert.equal(list[0].moderator.name.startsWith('user-'), true);

	assert.equal((await call('POST', `/api/sanctions/${ban.id}/revoke`, {})).statusCode, 400, 'needs confirmation');
	assert.equal((await call('POST', `/api/sanctions/${ban.id}/revoke`, { confirm: true, reason: 'Appel' })).statusCode, 200);
	assert.equal(core.sanctions.isBanned('300000000000000001'), false);
});

test('sanction permissions are checked per type through the API', async () => {
	const { app, core, owner } = await setup();
	const modo = core.ranks.create(owner, { name: 'Modo', level: 10, permissions: ['panel.access', 'sanctions.warn'] });
	await core.ranks.assignDirect(owner, ALICE, modo.id);
	const call = api(app, await sessionFor(app, ALICE));
	assert.equal((await call('POST', '/api/sanctions', { type: 'ban', userId: '300000000000000001' })).statusCode, 403);
	assert.equal((await call('POST', '/api/sanctions', { type: 'warn', userId: '300000000000000001', reason: 'x' })).statusCode, 201);
	assert.equal((await call('GET', '/api/sanctions')).statusCode, 403, 'listing needs sanctions.view');
});

test('the panel is served on "/" and on client routes; missing assets are 404', async () => {
	const fs = await import('node:fs');
	const os = await import('node:os');
	const path = await import('node:path');
	const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brl-panel-'));
	fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>panel</title>');
	fs.mkdirSync(path.join(staticDir, 'assets'));
	fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');

	const ctx = await withNetwork();
	const web = await createWebServer({
		config: ctx.core.config, core: ctx.core, runtime: { info: () => ({}), installState: () => null },
		consoleLog: { lines: () => [], subscribe: () => noop }, versions: {}, logger: silent, staticDir, tls: null,
	});
	for (const url of ['/', '/login', '/network', '/sanctions?user=1']) {
		const res = await web.app.inject({ method: 'GET', url });
		assert.equal(res.statusCode, 200, url);
		assert.match(res.body, /<title>panel<\/title>/, url);
	}
	assert.equal((await web.app.inject({ method: 'GET', url: '/assets/app.js' })).body, 'console.log(1)');
	assert.equal((await web.app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode, 404);
});

test('invite link carries the application id, the bot permissions and both scopes', async () => {
	const { app } = await setup();
	const res = await api(app, await sessionFor(app, OWNER))('GET', '/api/network/invite');
	const url = new URL(res.json().url);
	assert.equal(url.searchParams.get('client_id'), '111111111111111111');
	assert.equal(url.searchParams.get('permissions'), '8');
	assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
});

test('announcements through the API: create, send with confirmation', async () => {
	const { app, core, executor } = await setup();
	core.network.activate(await core.ranks.resolve(OWNER), OTHER);
	executor.channels.set('610000000000000001', { guildId: MAIN, name: 'annonces' });
	const call = api(app, await sessionFor(app, OWNER));
	const created = await call('POST', '/api/announcements', {
		name: 'Test', payload: { content: 'Salut', embed: { title: 'Titre' } },
		targets: [{ guildId: MAIN, channelId: '610000000000000001', ping: 'none' }],
	});
	assert.equal(created.statusCode, 201, created.body);
	const id = created.json().id;
	assert.equal((await call('POST', `/api/announcements/${id}/send`, {})).statusCode, 400, 'needs confirmation');
	const sent = await call('POST', `/api/announcements/${id}/send`, { confirm: true });
	assert.equal(sent.json().status, 'sent');
	const targets = (await call('GET', '/api/announcements/targets')).json();
	assert.ok(targets.some(t => t.id === MAIN && t.channels.length));
});
