// The split deployment in one process: a bot side (fake Discord) and an API side sharing the test database,
// linked by the real internal link (the bot dials the API's websocket).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCore } from '../src/core/context.js';
import { parseConfig } from '../src/utils/config.js';
import { createBotLink } from '../src/bot/link.js';
import { createApiLink } from '../src/api/link.js';
import { createPrincipal } from '../src/core/permissions.js';
import { ForbiddenError } from '../src/core/errors.js';
import { openTestDb } from './db.js';
import { createFakeExecutor, OWNER, ALICE, MAIN, OTHER } from './helpers.js';

const TOKEN = 'k'.repeat(48);
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined, success: () => undefined };

async function setup() {
	const db = await openTestDb();
	// The API side first: its HTTP server takes the bot's connection
	const server = http.createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const config = { ...parseConfig({ OWNER_ID: OWNER }), DATA_DIR: '/nonexistent', INTERNAL_TOKEN: TOKEN, API_URL: `http://127.0.0.1:${server.address().port}` };
	const lines = [];
	const apiLink = createApiLink({ config, consoleLog: { ingest: line => lines.push(line) }, logger: silent });
	const apiCore = createCore({ db, config, executor: apiLink.executor, logger: silent, remote: apiLink.remote });
	await apiCore.init();
	apiLink.attach(apiCore);
	apiLink.listen(server);

	const executor = createFakeExecutor();
	const botCore = createCore({ db, config, executor, logger: silent });
	await botCore.init({ worker: true });
	const runtime = { info: () => ({ version: 'v-test', supervised: false }), installState: () => null, restart: async () => 'restarted', stop: async () => undefined, install: () => undefined };
	const botLink = createBotLink({ config, core: botCore, executor, runtime, consoleLog: { subscribe: () => () => undefined }, logger: silent });
	const snapshot = once(apiLink.events, 'snapshot');
	botLink.start();
	await snapshot;

	await botCore.network.upsertSeen({ id: MAIN, name: 'Main' });
	await botCore.network.upsertSeen({ id: OTHER, name: 'Other' });
	const owner = createPrincipal({ id: OWNER, isOwner: true });
	await botCore.network.setMain(owner, MAIN);
	const close = async () => {
		await botLink.close();
		apiLink.close();
		server.close();
	};
	return { db, executor, botCore, apiCore, apiLink, owner, lines, close };
}

const until = async (check, ms = 3000) => {
	const end = Date.now() + ms;
	while (!await check()) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise(resolve => setTimeout(resolve, 20));
	}
};

test('Discord actions asked by the API are done by the bot', async () => {
	const { executor, apiCore, close } = await setup();
	executor.channels.set('610000000000000001', { guildId: MAIN, name: 'général' });
	const channels = await apiCore.executor.listTextChannels(MAIN);
	assert.deepEqual(channels.map(c => c.name), ['général']);
	await apiCore.executor.addRole(MAIN, ALICE, '700000000000000001');
	assert.deepEqual(executor.calls.at(-1), ['addRole', MAIN, ALICE, '700000000000000001']);
	await close();
});

test('the services living in the bot run there, with the panel user as actor and errors kept', async () => {
	const { botCore, apiCore, owner, close } = await setup();
	const config = await apiCore.antiraid.get(MAIN);
	await apiCore.antiraid.save(owner, MAIN, { ...config, enabled: true });
	// The bot's own cache sees the change at once: the call ran in the bot
	assert.equal((await botCore.antiraid.get(MAIN)).enabled, true);
	const alice = createPrincipal({ id: ALICE });
	await assert.rejects(apiCore.antiraid.save(alice, MAIN, config), ForbiddenError);
	await close();
});

test('live events of the bot reach the panel subscribers of the API', async () => {
	const { botCore, apiCore, owner, close } = await setup();
	const events = [];
	apiCore.dms.subscribe(event => events.push(event.type));
	const thread = await botCore.dms.open(owner, '300000000000000021', 'lea');
	await botCore.dms.send(owner, thread.id, { content: 'Salut' });
	await until(() => events.includes('message'));
	await close();
});

test('a change made from the panel refreshes the bot caches, and the other way round', async () => {
	const { botCore, apiCore, owner, close } = await setup();
	assert.equal(await botCore.network.getMainId(), MAIN);
	assert.equal(await apiCore.network.getMainId(), MAIN);
	await apiCore.network.setMain(owner, OTHER);
	await until(async () => await botCore.network.getMainId() === OTHER);
	await botCore.network.setMain(owner, MAIN);
	await until(async () => await apiCore.network.getMainId() === MAIN);
	await close();
});

test('the bot status and its console reach the API', async () => {
	const { apiCore, apiLink, close } = await setup();
	assert.equal(apiCore.executor.status().ready, true);
	assert.equal(apiLink.connected, true);
	assert.equal(apiLink.botRuntime.info().version, 'v-test');
	assert.equal(await apiLink.botRuntime.restart(), 'restarted');
	await close();
});
