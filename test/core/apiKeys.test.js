import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB } from '../helpers.js';
import { createApiKeys } from '../../src/core/apiKeys.js';

async function aliceWith(core, owner, permissions, level = 10) {
	const rank = core.ranks.create(owner, { name: `R${level}`, level, permissions });
	await core.ranks.assignDirect(owner, ALICE, rank.id);
	core.ranks.invalidate(ALICE);
	return core.ranks.resolve(ALICE);
}

test('a key is shown once, stored hashed, and authenticates', async () => {
	const { core, owner, db } = await withNetwork();
	const key = core.apiKeys.create(owner, { name: 'Site' });
	assert.match(key.secret, /^brl_[A-Za-z0-9_-]{43}$/);
	assert.equal(key.prefix, key.secret.slice(0, 12));
	const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(key.id);
	assert.notEqual(row.hash, key.secret);
	assert.ok(!JSON.stringify(row).includes(key.secret));
	assert.equal(core.apiKeys.authenticate(key.secret).id, key.id);
	assert.equal(core.apiKeys.authenticate('brl_' + 'x'.repeat(43)), null);
	assert.equal(core.apiKeys.authenticate('nope'), null);
	assert.equal(core.apiKeys.list(owner)[0].secret, undefined);
	assert.equal(core.audit.query({ action: 'api.create' }).length, 1);
});

test('a key acts as its owner, cut down to its permissions', async () => {
	const { core, owner } = await withNetwork();
	const alice = await aliceWith(core, owner, ['panel.access', 'api.use', 'network.view', 'ranks.view']);
	const key = core.apiKeys.create(alice, { name: 'Lecture', permissions: ['network.view'] });
	assert.deepEqual(key.permissions, ['api.use', 'network.view', 'panel.access']);
	const actor = await core.apiKeys.actorFor(key);
	assert.equal(actor.id, ALICE);
	assert.deepEqual(actor.apiKey, { id: key.id, name: 'Lecture' });
	assert.ok(actor.can('network.view'));
	assert.ok(!actor.can('ranks.view'));
	assert.ok(!actor.permissions.includes('ranks.view'));
});

test('a key cannot get more than its creator, and follows their rank', async () => {
	const { core, owner } = await withNetwork();
	const alice = await aliceWith(core, owner, ['panel.access', 'api.use', 'network.view']);
	assert.throws(() => core.apiKeys.create(alice, { name: 'X', permissions: ['ranks.manage'] }), { code: 'FORBIDDEN' });
	assert.throws(() => core.apiKeys.create(alice, { name: 'X', permissions: ['nope.nope'] }), { code: 'VALIDATION' });
	const key = core.apiKeys.create(alice, { name: 'Tout' });
	assert.equal(key.permissions, null);
	assert.ok((await core.apiKeys.actorFor(key)).can('network.view'));

	await core.ranks.unassignDirect(owner, ALICE, core.ranks.list()[0].id);
	core.ranks.invalidate(ALICE);
	assert.ok(!(await core.apiKeys.actorFor(key)).can('network.view'));
});

test('api.use is needed to create a key', async () => {
	const { core, owner } = await withNetwork();
	const alice = await aliceWith(core, owner, ['panel.access']);
	assert.throws(() => core.apiKeys.create(alice, { name: 'X' }), { code: 'FORBIDDEN' });
});

test('expired and revoked keys stop working', async () => {
	const { core, owner, db } = await withNetwork();
	let at = 1_000_000;
	const apiKeys = createApiKeys({ db, audit: core.audit, ranks: core.ranks, now: () => at });
	const key = apiKeys.create(owner, { name: 'Court', expiresInDays: 1 });
	assert.ok(apiKeys.authenticate(key.secret));
	at += 86_400_001;
	assert.equal(apiKeys.authenticate(key.secret), null);
	assert.equal(apiKeys.list(owner)[0].expired, true);

	const other = apiKeys.create(owner, { name: 'Autre' });
	await apiKeys.revoke(owner, other.id);
	assert.equal(apiKeys.authenticate(other.secret), null);
	assert.ok(!apiKeys.list(owner).some(k => k.id === other.id));
	await assert.rejects(apiKeys.revoke(owner, other.id), { code: 'NOT_FOUND' });
	assert.throws(() => apiKeys.create(owner, { name: 'X', expiresInDays: 0 }), { code: 'VALIDATION' });
});

test('only api.manage revokes the key of someone else, and not of a higher level', async () => {
	const { core, owner } = await withNetwork();
	const alice = await aliceWith(core, owner, ['panel.access', 'api.use']);
	const ownerKey = core.apiKeys.create(owner, { name: 'Owner' });
	await assert.rejects(core.apiKeys.revoke(alice, ownerKey.id), { code: 'FORBIDDEN' });

	const manager = core.ranks.create(owner, { name: 'Manager', level: 20, permissions: ['panel.access', 'api.use', 'api.manage'] });
	await core.ranks.assignDirect(owner, BOB, manager.id);
	const bob = await core.ranks.resolve(BOB);
	const aliceKey = core.apiKeys.create(alice, { name: 'Alice' });
	assert.equal(core.apiKeys.list(bob, { all: true }).length, 2);
	assert.equal(core.apiKeys.list(alice, { all: true }).length, 1);
	await core.apiKeys.revoke(bob, aliceKey.id);
	await assert.rejects(core.apiKeys.revoke(bob, ownerKey.id), { code: 'FORBIDDEN' });
});

test('usage is counted and flushed', async () => {
	const { core, owner } = await withNetwork();
	const key = core.apiKeys.create(owner, { name: 'Compteur' });
	for (let i = 0; i < 3; i++) core.apiKeys.authenticate(key.secret, '1.2.3.4');
	core.apiKeys.flushAll();
	const [listed] = core.apiKeys.list(owner);
	assert.equal(listed.uses, 3);
	assert.equal(listed.lastIp, '1.2.3.4');
});
