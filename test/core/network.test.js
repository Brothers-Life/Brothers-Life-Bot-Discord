import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestCore, withNetwork, OWNER, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';

test('a server seen by the bot starts as pending', () => {
	const { core } = createTestCore();
	const guild = core.network.upsertSeen({ id: MAIN, name: 'Main' });
	assert.equal(guild.status, 'pending');
	assert.equal(guild.isMain, false);
	assert.equal(core.network.getMainId(), null);
	assert.equal(core.audit.query()[0].action, 'network.bot_joined');
});

test('seeing a server again updates its name without duplicating the audit', () => {
	const { core } = createTestCore();
	core.network.upsertSeen({ id: MAIN, name: 'Main' });
	core.network.upsertSeen({ id: MAIN, name: 'Renamed' });
	assert.equal(core.network.get(MAIN).name, 'Renamed');
	assert.equal(core.audit.query({ action: 'network.bot_joined' }).length, 1);
});

test('the owner can choose the main server, which becomes active', async () => {
	const { core, owner } = await withNetwork();
	const main = core.network.getMain();
	assert.equal(main.id, MAIN);
	assert.equal(main.status, 'active');
	assert.equal(core.network.get(OTHER).status, 'pending');
	assert.deepEqual(core.network.activeIds(), [MAIN]);

	core.network.setMain(owner, OTHER);
	assert.equal(core.network.getMainId(), OTHER);
	assert.equal(core.network.get(MAIN).isMain, false);
});

test('activate and remove a server', async () => {
	const { core, owner } = await withNetwork();
	const events = [];
	core.network.on('activated', g => events.push(['activated', g.id]));
	core.network.on('removed', g => events.push(['removed', g.id]));

	core.network.activate(owner, OTHER);
	assert.equal(core.network.get(OTHER).status, 'active');
	core.network.remove(owner, OTHER);
	assert.equal(core.network.get(OTHER).status, 'removed');
	assert.deepEqual(events, [['activated', OTHER], ['removed', OTHER]]);
});

test('the main server cannot be removed', async () => {
	const { core, owner } = await withNetwork();
	assert.throws(() => core.network.remove(owner, MAIN), ValidationError);
});

test('a server the bot left cannot be activated', async () => {
	const { core, owner } = await withNetwork();
	core.network.markLeft(OTHER);
	assert.equal(core.network.get(OTHER).botPresent, false);
	assert.throws(() => core.network.activate(owner, OTHER), ValidationError);
});

test('managing the network needs network.manage', async () => {
	const { core } = await withNetwork();
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => core.network.activate(alice, OTHER), ForbiddenError);
	assert.ok(OWNER);
});
