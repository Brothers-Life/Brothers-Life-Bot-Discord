import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestCore, withNetwork, OWNER, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';

test('a server seen by the bot starts as pending', async () => {
	const { core } = await createTestCore();
	const guild = await core.network.upsertSeen({ id: MAIN, name: 'Main' });
	assert.equal(guild.status, 'pending');
	assert.equal(guild.isMain, false);
	assert.equal(await core.network.getMainId(), null);
	assert.equal((await core.audit.query())[0].action, 'network.bot_joined');
});

test('seeing a server again updates its name without duplicating the audit', async () => {
	const { core } = await createTestCore();
	await core.network.upsertSeen({ id: MAIN, name: 'Main' });
	await core.network.upsertSeen({ id: MAIN, name: 'Renamed' });
	assert.equal((await core.network.get(MAIN)).name, 'Renamed');
	assert.equal((await core.audit.query({ action: 'network.bot_joined' })).length, 1);
});

test('the owner can choose the main server, which becomes active', async () => {
	const { core, owner } = await withNetwork();
	const main = await core.network.getMain();
	assert.equal(main.id, MAIN);
	assert.equal(main.status, 'active');
	assert.equal((await core.network.get(OTHER)).status, 'pending');
	assert.deepEqual(await core.network.activeIds(), [MAIN]);

	await core.network.setMain(owner, OTHER);
	assert.equal(await core.network.getMainId(), OTHER);
	assert.equal((await core.network.get(MAIN)).isMain, false);
});

test('activate and remove a server', async () => {
	const { core, owner } = await withNetwork();
	const events = [];
	core.network.on('activated', g => events.push(['activated', g.id]));
	core.network.on('removed', g => events.push(['removed', g.id]));

	await core.network.activate(owner, OTHER);
	assert.equal((await core.network.get(OTHER)).status, 'active');
	await core.network.remove(owner, OTHER);
	assert.equal((await core.network.get(OTHER)).status, 'removed');
	assert.deepEqual(events, [['activated', OTHER], ['removed', OTHER]]);
});

test('the main server cannot be removed', async () => {
	const { core, owner } = await withNetwork();
	await assert.rejects(async () => core.network.remove(owner, MAIN), ValidationError);
});

test('a server the bot left cannot be activated', async () => {
	const { core, owner } = await withNetwork();
	await core.network.markLeft(OTHER);
	assert.equal((await core.network.get(OTHER)).botPresent, false);
	await assert.rejects(async () => core.network.activate(owner, OTHER), ValidationError);
});

test('managing the network needs network.manage', async () => {
	const { core } = await withNetwork();
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(async () => core.network.activate(alice, OTHER), ForbiddenError);
	assert.ok(OWNER);
});
