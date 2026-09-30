import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN } from '../helpers.js';
import { createFivem } from '../../src/core/fivem.js';
import { fivemPayload } from '../../src/bot/fivemUi.js';

const CHANNEL = '610000000000000001';

async function setup() {
	const world = { up: true };
	const fetchImpl = async (url) => {
		if (!world.up) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
		if (url.endsWith('/dynamic.json')) return { ok: true, status: 200, json: async () => ({ clients: 2, sv_maxclients: 64, hostname: '^1Brothers ^7Life RP' }) };
		if (url.endsWith('/players.json')) return { ok: true, status: 200, json: async () => [{ id: 7, name: 'Léa' }, { id: 3, name: 'Tom' }] };
		return { ok: false, status: 404 };
	};
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	executor.channels.set(CHANNEL, { guildId: MAIN, name: 'statut' });
	const fivem = createFivem({ db: core.db, network: core.network, audit: core.audit, executor, settings: core.settings, logs: core.logs, fetchImpl, logger: { warn: () => undefined } });
	return { ...ctx, fivem, world };
}

test('servers: address checked, status polled, message kept up to date, offline when unreachable', async () => {
	const { fivem, owner, executor, world } = await setup();
	await assert.rejects(fivem.save(owner, { name: 'RP', address: 'pas une adresse' }), /ip:port/);
	await assert.rejects(fivem.save(owner, { name: 'RP', address: '1.2.3.4:30120', joinCode: 'x!' }), /cfx/);
	const server = await fivem.save(owner, { name: 'BRL RP', address: 'http://51.75.12.34:30120/', joinCode: 'https://cfx.re/join/abc123' });
	assert.equal(server.address, '51.75.12.34:30120');
	assert.equal(server.joinCode, 'abc123');
	assert.equal(server.status.players, 2);
	assert.equal(server.status.hostname, 'Brothers Life RP', 'color codes removed');
	assert.deepEqual(server.status.list.map(p => p.id), [3, 7]);

	await fivem.addStatusMessage(owner, server.id, MAIN, CHANNEL);
	assert.equal(executor.fivemMessages.length, 1);
	const first = fivem.get(server.id).messages[0].messageId;
	world.up = false;
	await fivem.tick();
	const last = executor.fivemMessages.at(-1);
	assert.equal(last.messageId, first, 'the same message is edited');
	assert.equal(last.data.status.online, false);
	assert.match(last.data.status.error, /5 s/);
	assert.deepEqual(fivem.variables(), { fivem: 0, fivemMax: 0 });
});

test('bot status rotates between servers, offline text when down; embed has a join button', async () => {
	const { fivem, owner, executor, world } = await setup();
	const a = await fivem.save(owner, { name: 'Serveur A', address: '1.2.3.4:30120', joinCode: 'abcd12' });
	const b = await fivem.save(owner, { name: 'Serveur B', address: '1.2.3.5:30120' });
	fivem.setPresence(owner, { enabled: true, serverIds: [a.id, b.id] });
	assert.equal(await fivem.presenceTick(), '2/64 joueurs sur Serveur A');
	world.up = false;
	await fivem.tick();
	assert.equal(await fivem.presenceTick(), 'Serveur B est hors ligne');
	assert.equal(executor.botStatus, 'Serveur B est hors ligne');

	const current = fivem.get(a.id);
	const payload = fivemPayload({ server: current, status: current.status }).components[0].toJSON();
	assert.equal(payload.components[0].url, 'https://cfx.re/join/abcd12');
	await assert.rejects(fivem.save({ id: '1', can: () => false }, { name: 'x', address: '1.2.3.4:1' }), /fivem.manage/);
});

test('addresses: link-local and metadata endpoints refused, local network accepted for FiveM', async () => {
	const { fivem, owner } = await setup();
	await assert.rejects(fivem.save(owner, { name: 'x', address: '169.254.169.254:80' }), /refusée/);
	await assert.rejects(fivem.save(owner, { name: 'x', address: 'metadata.google.internal:80' }), /refusée/);
	const local = await fivem.save(owner, { name: 'Local', address: '127.0.0.1:30120' });
	assert.equal(local.address, '127.0.0.1:30120');
});
