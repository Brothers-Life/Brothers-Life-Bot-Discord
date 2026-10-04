import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork } from '../helpers.js';
import { createWebServer } from '../../src/web/server.js';

const noop = () => undefined;
const silent = { info: noop, warn: noop, error: noop };

async function setup() {
	const ctx = await withNetwork();
	const runtime = { info: () => ({ version: 'v9.9.9', supervised: false }), installState: () => null, restart: noop, stop: noop, install: noop };
	const consoleLog = { lines: () => [], subscribe: () => noop };
	const versions = { describe: async () => ({ releases: [] }), current: () => ({ version: 'v9.9.9' }), ignore: noop, prepareInstall: async () => ({}) };
	const web = await createWebServer({ config: ctx.core.config, core: ctx.core, runtime, consoleLog, versions, logger: silent, staticDir: '/nonexistent', tls: null });
	const bearer = secret => (method, url, body) => web.app.inject({ method, url, headers: { authorization: `Bearer ${secret}` }, ...(body === undefined ? {} : { payload: body }) });
	return { ...ctx, app: web.app, bearer };
}

test('the bridge key posts txAdmin events; identifiers are dropped; it cannot read the settings', async () => {
	const { core, owner, bearer } = await setup();
	const call = bearer(core.apiKeys.create(owner, { name: 'Pont txAdmin', permissions: ['fivem.events'] }).secret);
	const res = await call('POST', '/api/fivem/events', { type: 'playerWarned', server: 'BRL', data: { author: 'Admin', reason: 'Test', targetName: 'Léa', targetIds: ['license:abc'], targetNetId: null } });
	assert.equal(res.statusCode, 200, res.body);
	assert.equal(res.json().status, 'logged');
	const stored = core.fivemEvents.recent()[0];
	assert.equal(stored.type, 'playerWarned');
	assert.equal(JSON.stringify(stored.data).includes('license'), false);

	// Deprecated txAdmin name still accepted
	assert.equal((await call('POST', '/api/fivem/events', { type: 'healedPlayer', data: { target: -1, author: 'Admin' } })).json().status, 'logged');
	assert.equal((await call('POST', '/api/fivem/events', { type: 'nope' })).statusCode, 400);
	assert.equal((await call('GET', '/api/fivem-events')).statusCode, 403);
	assert.equal((await call('POST', '/api/fivem-events/maintenance', { active: true })).statusCode, 403);
});

test('a key without fivem.events cannot post events', async () => {
	const { core, owner, bearer } = await setup();
	const call = bearer(core.apiKeys.create(owner, { name: 'Lecture', permissions: ['network.view'] }).secret);
	const res = await call('POST', '/api/fivem/events', { type: 'serverStarted', data: {} });
	assert.equal(res.statusCode, 403);
	assert.match(res.json().error.message, /fivem\.events/);
});
