import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, OWNER, BOB, MAIN } from '../helpers.js';
import { createWebServer } from '../../src/web/server.js';
import { csvCell } from '../../src/web/routes/helpers.js';

const noop = () => undefined;
const silent = { info: noop, warn: noop, error: noop };

// Fake Discord OAuth: the code is the Discord user id
function fakeDiscord() {
	return async (url, options = {}) => {
		const u = String(url);
		if (u.endsWith('/oauth2/token')) return Response.json({ access_token: `token-${new URLSearchParams(options.body).get('code')}` });
		if (u.endsWith('/users/@me')) {
			const id = options.headers.Authorization.replace('Bearer token-', '');
			return Response.json({ id, username: `user${id.slice(-2)}`, global_name: null, avatar: null });
		}
		throw new Error(`unexpected fetch ${u}`);
	};
}

async function setup() {
	const ctx = await withNetwork();
	const runtime = { info: () => ({ version: 'v1.0.0', supervised: false }), installState: () => null, restart: noop, stop: noop, install: noop };
	const consoleLog = { lines: () => ['secret line'], subscribe: () => noop };
	const versions = { describe: async () => ({ releases: [] }), current: () => ({ version: 'v1.0.0' }), ignore: noop, prepareInstall: async () => ({}) };
	const config = { ...ctx.core.config, APP_ID: '111111111111111111', CLIENT_SECRET: 'secret', WEB_PUBLIC_URL: 'http://localhost:3000' };
	ctx.core.config.APP_ID = config.APP_ID;
	ctx.core.config.WEB_PUBLIC_URL = config.WEB_PUBLIC_URL;
	const web = await createWebServer({ config, core: ctx.core, runtime, consoleLog, versions, logger: silent, fetchImpl: fakeDiscord(), staticDir: '/nonexistent', tls: null });
	return { ...ctx, app: web.app };
}

async function sessionFor(app, userId) {
	const start = await app.inject({ method: 'GET', url: '/api/auth/login' });
	const state = new URL(start.headers.location).searchParams.get('state');
	const res = await app.inject({
		method: 'GET',
		url: `/api/auth/callback?code=${userId}&state=${state}`,
		cookies: { oauth_state: start.cookies.find(c => c.name === 'oauth_state').value },
	});
	return { sid: res.cookies.find(c => c.name === 'sid').value };
}

test('an encoded /api path still goes through the guard', async () => {
	const { app } = await setup();
	for (const url of ['/%61pi/sanctions', '/%61pi/audit', '/api/%73anctions', '/%61pi/me']) {
		const res = await app.inject({ method: 'GET', url });
		assert.equal(res.statusCode, 401, url);
		assert.equal(res.headers['cache-control'], 'no-store', url);
	}
	assert.equal((await app.inject({ method: 'POST', url: '/%61pi/system/restart', headers: { 'x-requested-with': 'panel' }, payload: { confirm: true } })).statusCode, 401);
	assert.equal((await app.inject({ method: 'GET', url: '/%61pi/nope', cookies: await sessionFor(app, OWNER) })).json().error.code, 'NOT_FOUND');
});

test('websockets refuse a foreign Origin', async () => {
	const { app } = await setup();
	const { sid } = await sessionFor(app, OWNER);
	await app.ready();
	await assert.rejects(app.injectWS('/api/console', { headers: { cookie: `sid=${sid}`, origin: 'http://localhost:8080' } }));

	let socket;
	const first = new Promise((resolve) => {
		app.injectWS('/api/console', { headers: { cookie: `sid=${sid}`, origin: 'http://localhost:3000' } }, {
			onInit: ws => ws.once('message', data => resolve(JSON.parse(String(data)))),
		}).then((ws) => {
			socket = ws;
		});
	});
	assert.equal((await first).type, 'history');
	socket?.terminate();
});

test('HTML documents of the API are sandboxed', async () => {
	const { app, core, owner } = await setup();
	const category = await core.tickets.saveCategory(owner, MAIN, { name: 'Support' });
	const ticket = await core.tickets.open({ guildId: MAIN, userId: BOB, userName: 'bob', categoryId: category.id });
	await core.tickets.close(OWNER, ticket.id);
	const res = await app.inject({ method: 'GET', url: `/api/tickets/${ticket.id}/transcript`, cookies: await sessionFor(app, OWNER) });
	assert.equal(res.statusCode, 200);
	assert.match(res.headers['content-security-policy'], /; sandbox/);
	const json = await app.inject({ method: 'GET', url: '/api/me', cookies: await sessionFor(app, OWNER) });
	assert.doesNotMatch(json.headers['content-security-policy'], /sandbox/);
});

test('null clears a permission profile (null-first anyOf, no coercion to [""])', async () => {
	const { app, core, owner } = await setup();
	const rank = core.ranks.create(owner, { name: 'Modo', level: 10, permissions: ['panel.access'] });
	const cookies = await sessionFor(app, OWNER);
	const put = body => app.inject({ method: 'PUT', url: `/api/permissions/${rank.id}`, cookies, headers: { 'x-requested-with': 'panel' }, payload: body });
	assert.equal((await put({ permissions: ['ViewChannel'] })).statusCode, 200);
	const cleared = await put({ permissions: null });
	assert.equal(cleared.statusCode, 200, cleared.body);
});

test('feedback handling with an API key needs the permission in the key scope', async () => {
	const { app, core, owner } = await setup();
	const box = core.feedback.createBox(owner, MAIN, { preset: 'suggestions', config: { cooldownMinutes: 0 } });
	const item = await core.feedback.create({ boxId: box.id, guildId: MAIN, userId: BOB, userName: 'bob', answers: [{ id: 'title', type: 'short', label: 'Titre', value: 'Une idée' }] });
	const call = (secret, url, payload) => app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${secret}` }, payload });

	const narrow = core.apiKeys.create(owner, { name: 'Musique', permissions: ['music.use'] }).secret;
	for (const [url, payload] of [[`/api/feedback/items/${item.id}/status`, { status: 'accepted' }], [`/api/feedback/items/${item.id}/assign`, {}], [`/api/feedback/items/${item.id}/review`, { approved: true }]]) {
		const res = await call(narrow, url, payload);
		assert.equal(res.statusCode, 403, `${url}: ${res.body}`);
	}
	assert.equal(core.feedback.get(owner, item.id).status, 'pending');

	const full = core.apiKeys.create(owner, { name: 'Suggestions', permissions: ['feedback.manage'] }).secret;
	const res = await call(full, `/api/feedback/items/${item.id}/status`, { status: 'accepted' });
	assert.equal(res.statusCode, 200, res.body);
});

test('CSV cells never start a formula', () => {
	assert.equal(csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
	assert.equal(csvCell('+33 6'), '\'+33 6');
	assert.equal(csvCell('@SUM(A1)'), '\'@SUM(A1)');
	assert.equal(csvCell(-3), '-3');
	assert.equal(csvCell('a;b'), '"a;b"');
	assert.equal(csvCell(null), '');
});

test('the server list is readable by any panel user, the network history only with network.view', async () => {
	const { app, core, owner } = await setup();
	const rank = core.ranks.create(owner, { name: 'Support', level: 10, permissions: ['panel.access', 'tickets.view'] });
	await core.ranks.assignDirect(owner, BOB, rank.id);
	const res = await app.inject({ method: 'GET', url: '/api/network', cookies: await sessionFor(app, BOB) });
	assert.equal(res.statusCode, 200, res.body);
	const main = res.json().find(g => g.id === MAIN);
	assert.equal(main.isMain, true);
	assert.equal(main.firstSeenAt, undefined);
	const full = await app.inject({ method: 'GET', url: '/api/network', cookies: await sessionFor(app, OWNER) });
	assert.ok(full.json().find(g => g.id === MAIN).firstSeenAt);
});
