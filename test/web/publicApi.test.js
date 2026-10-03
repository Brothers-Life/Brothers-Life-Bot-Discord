import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE } from '../helpers.js';
import { createWebServer } from '../../src/web/server.js';
import { API_RATE_LIMIT } from '../../src/web/guard.js';
import { toBruno, exampleOf } from '../../src/web/apiDocs.js';

const noop = () => undefined;
const silent = { info: noop, warn: noop, error: noop };

async function setup() {
	const ctx = await withNetwork();
	const runtime = { info: () => ({ version: 'v9.9.9', supervised: false }), installState: () => null, restart: noop, stop: noop, install: noop };
	const consoleLog = { lines: () => [], subscribe: () => noop };
	const versions = { describe: async () => ({ releases: [] }), current: () => ({ version: 'v9.9.9' }), ignore: noop, prepareInstall: async () => ({}) };
	const config = { ...ctx.core.config, WEB_PUBLIC_URL: 'https://10.0.0.1:3000' };
	ctx.core.config.WEB_PUBLIC_URL = config.WEB_PUBLIC_URL;
	const web = await createWebServer({ config, core: ctx.core, runtime, consoleLog, versions, logger: silent, staticDir: '/nonexistent', tls: null });
	const bearer = secret => (method, url, body) => web.app.inject({
		method, url, headers: { authorization: `Bearer ${secret}` }, ...(body === undefined ? {} : { payload: body }),
	});
	return { ...ctx, app: web.app, bearer };
}

test('a key reads and writes without cookie nor CSRF header', async () => {
	const { core, owner, bearer } = await setup();
	const call = bearer(core.apiKeys.create(owner, { name: 'Full' }).secret);
	const me = (await call('GET', '/api/me')).json();
	assert.equal(me.isOwner, true);
	assert.equal(me.apiKey.name, 'Full');

	const created = await call('POST', '/api/ranks', { name: 'Via API', level: 5 });
	assert.equal(created.statusCode, 201, created.body);
	assert.ok(core.ranks.list().some(r => r.name === 'Via API'));
	const entry = core.audit.query({ action: 'ranks.create' })[0];
	assert.equal(entry.actorId, owner.id);
	assert.equal(entry.details['Clé d’API'], 'Full');
});

test('invalid, revoked or panel-only: refused', async () => {
	const { core, owner, bearer } = await setup();
	assert.equal((await bearer('brl_' + 'a'.repeat(43))('GET', '/api/me')).json().error.code, 'INVALID_API_KEY');
	const key = core.apiKeys.create(owner, { name: 'K' });
	const call = bearer(key.secret);
	assert.equal((await call('GET', '/api/sessions')).json().error.code, 'PANEL_ONLY');
	assert.equal((await call('POST', '/api/api-keys', { name: 'escalade' })).json().error.code, 'PANEL_ONLY');
	assert.equal((await call('GET', '/api/api-keys')).json().error.code, 'PANEL_ONLY');
	await core.apiKeys.revoke(owner, key.id);
	assert.equal((await call('GET', '/api/me')).statusCode, 401);
});

test('route permissions apply to the key scope', async () => {
	const { core, owner, bearer } = await setup();
	const call = bearer(core.apiKeys.create(owner, { name: 'Lecture', permissions: ['network.view'] }).secret);
	assert.equal((await call('GET', '/api/network')).statusCode, 200);
	const res = await call('GET', '/api/ranks');
	assert.equal(res.statusCode, 403);
	assert.match(res.json().error.message, /ranks\.view/);
});

test('a key stops working when its owner loses api.use', async () => {
	const { core, owner, bearer } = await setup();
	const rank = core.ranks.create(owner, { name: 'Dev', level: 10, permissions: ['panel.access', 'api.use', 'network.view'] });
	await core.ranks.assignDirect(owner, ALICE, rank.id);
	const alice = await core.ranks.resolve(ALICE);
	const call = bearer(core.apiKeys.create(alice, { name: 'A' }).secret);
	assert.equal((await call('GET', '/api/network')).statusCode, 200);
	core.ranks.update(owner, rank.id, { permissions: ['panel.access', 'network.view'] });
	core.ranks.invalidate(ALICE);
	assert.equal((await call('GET', '/api/network')).statusCode, 403);
});

test('requests are limited per key', async () => {
	const { core, owner, bearer } = await setup();
	const call = bearer(core.apiKeys.create(owner, { name: 'Spam' }).secret);
	let last;
	for (let i = 0; i <= API_RATE_LIMIT; i++) last = await call('GET', '/api/api-docs');
	// The window may roll over during the loop: one more call settles it
	if (last.statusCode !== 429) last = await call('GET', '/api/api-docs');
	assert.equal(last.statusCode, 429);
	assert.ok(last.headers['retry-after']);
});

test('docs: catalogue, OpenAPI and Bruno collection', async () => {
	const { core, owner, bearer } = await setup();
	const call = bearer(core.apiKeys.create(owner, { name: 'Docs' }).secret);
	const docs = (await call('GET', '/api/api-docs')).json();
	assert.equal(docs.baseUrl, 'https://10.0.0.1:3000');
	assert.ok(docs.routes.length > 200);
	assert.ok(docs.routes.some(r => r.method === 'POST' && r.url === '/api/ranks' && r.permission === 'ranks.manage'));
	assert.ok(!docs.routes.some(r => r.url.startsWith('/api/api-keys') || r.url.startsWith('/api/auth') || r.url === '/api/console'));

	const openapi = (await call('GET', '/api/openapi.json')).json();
	assert.equal(openapi.openapi, '3.0.3');
	assert.ok(openapi.paths['/api/ranks/{id}'].patch);
	assert.equal(openapi.components.securitySchemes.apiKey.scheme, 'bearer');

	const zip = await call('GET', '/api/bruno.zip');
	assert.equal(zip.headers['content-type'], 'application/zip');
	assert.equal(zip.rawPayload.readUInt32LE(0), 0x04034B50);
	assert.ok(zip.rawPayload.includes(Buffer.from('brothers-life-api/collection.bru')));
});

test('Bruno files are well formed', async () => {
	const routes = [
		{ method: 'POST', url: '/api/ranks/:id/duplicate', permission: 'ranks.manage', confirm: true, apiKey: true, schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, confirm: { type: 'boolean' } } } } },
		{ method: 'GET', url: '/api/audit', permission: 'audit.view', apiKey: true, schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } } } } },
		{ method: 'GET', url: '/api/console', permission: 'console.view', apiKey: false },
	];
	const files = toBruno(routes, { baseUrl: 'https://x' });
	const paths = files.map(f => f.path);
	assert.ok(paths.includes('bruno.json'));
	assert.ok(paths.includes('environments/Production.bru'));
	assert.ok(!paths.some(p => p.includes('console')));
	const dup = files.find(f => f.path.endsWith('post-ranks-id-duplicate.bru')).content;
	assert.match(dup, /url: \{\{baseUrl\}\}\/api\/ranks\/:id\/duplicate/);
	assert.match(dup, /params:path \{\n {2}id: \n\}/);
	assert.match(dup, /"confirm": true/);
	assert.match(files.find(f => f.path.endsWith('get-audit.bru')).content, /params:query \{\n {2}~limit: \n\}/);
	assert.match(files.find(f => f.path === 'collection.bru').content, /token: \{\{apiKey\}\}/);
	assert.deepEqual(exampleOf({ type: 'object', properties: { a: { type: 'string', pattern: '^\\d{17,20}$' }, n: { anyOf: [{ type: 'null' }, { type: 'integer' }] } } }), { a: '000000000000000000', n: null });
});

test('the panel manages keys with its session', async () => {
	const { core, owner, app } = await setup();
	const sid = core.sessions.create({ discordId: owner.id });
	const headers = { 'x-requested-with': 'panel' };
	const created = await app.inject({ method: 'POST', url: '/api/api-keys', cookies: { sid }, headers, payload: { name: 'Bot externe', permissions: ['network.view'], expiresInDays: 30 } });
	assert.equal(created.statusCode, 201, created.body);
	assert.ok(created.json().secret);
	const listed = (await app.inject({ method: 'GET', url: '/api/api-keys', cookies: { sid } })).json();
	assert.equal(listed.keys.length, 1);

	assert.equal(listed.keys[0].secret, undefined);
	assert.ok(listed.permissions.length > 10);
	const unlimited = await app.inject({ method: 'POST', url: '/api/api-keys', cookies: { sid }, headers, payload: { name: 'Sans limite', permissions: null, expiresInDays: null } });
	assert.equal(unlimited.statusCode, 201, unlimited.body);
	assert.equal(unlimited.json().permissions, null);
	assert.equal(unlimited.json().expiresAt, null);
	const revoked = await app.inject({ method: 'DELETE', url: `/api/api-keys/${created.json().id}`, cookies: { sid }, headers });
	assert.equal(revoked.statusCode, 200);
});
