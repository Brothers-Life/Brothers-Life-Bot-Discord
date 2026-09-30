import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	core.network.activate(owner, OTHER);
	executor.roles.set(MAIN, [
		{ id: '800000000000000001', name: 'Fondateur', color: '#e5484d', position: 5, editable: true },
		{ id: '800000000000000002', name: 'Admin', color: '#d6a249', position: 4, editable: true },
		{ id: '800000000000000003', name: 'Modo', color: '#000000', position: 3, editable: true },
	]);
	executor.roles.set(OTHER, [
		{ id: '810000000000000002', name: 'admin', editable: true },
		{ id: '810000000000000003', name: 'Modo', editable: true },
	]);
	return ctx;
}

test('main server roles become ranks, highest role = highest level, no permission', async () => {
	const { core, owner } = await setup();
	const results = await core.roleImport.importMainRoles(owner, ['800000000000000003', '800000000000000001', '800000000000000002']);
	assert.deepEqual(results.map(r => [r.name, r.status]), [['Fondateur', 'created'], ['Admin', 'created'], ['Modo', 'created']]);
	const ranks = core.ranks.list();
	assert.deepEqual(ranks.map(r => r.name), ['Fondateur', 'Admin', 'Modo'], 'sorted by level');
	assert.ok(ranks[0].level > ranks[1].level && ranks[1].level > ranks[2].level);
	assert.equal(ranks[0].color, '#e5484d');
	assert.equal(ranks[2].color, null, 'default Discord color is not copied');
	assert.ok(ranks.every(r => r.permissions.length === 0));
	assert.deepEqual(ranks[1].roles, [{ guildId: MAIN, roleId: '800000000000000002' }]);
});

test('an existing rank with the same name is linked, not duplicated; linked roles are skipped', async () => {
	const { core, owner } = await setup();
	const admin = core.ranks.create(owner, { name: 'admin', level: 70, permissions: ['panel.access'] });
	const first = await core.roleImport.importMainRoles(owner, ['800000000000000002']);
	assert.equal(first[0].status, 'linked');
	assert.equal(first[0].rankId, admin.id);
	assert.equal(core.ranks.list().length, 1);
	const again = await core.roleImport.importMainRoles(owner, ['800000000000000002']);
	assert.equal(again[0].status, 'already_linked');
	const candidates = await core.roleImport.candidates();
	assert.equal(candidates.roles.find(r => r.name === 'Admin').linkedRankId, admin.id);
});

test('levels stay below the importer; needs ranks.manage', async () => {
	const { core, owner } = await setup();
	const manager = core.ranks.create(owner, { name: 'Gérant', level: 30, permissions: ['ranks.manage'] });
	await core.ranks.assignDirect(owner, ALICE, manager.id);
	const alice = await core.ranks.resolve(ALICE);
	await core.roleImport.importMainRoles(alice, ['800000000000000001', '800000000000000002']);
	assert.ok(core.ranks.list().filter(r => r.name !== 'Gérant').every(r => r.level < 30));

	const nobody = await core.ranks.resolve('300000000000000009');
	await assert.rejects(core.roleImport.importMainRoles(nobody, ['800000000000000003']), ForbiddenError);
});

test('other servers: ranks are linked to the role of the same name', async () => {
	const { core, owner } = await setup();
	await core.roleImport.importMainRoles(owner, ['800000000000000002', '800000000000000003']);
	const results = await core.roleImport.linkByName(owner);
	assert.deepEqual(results.map(r => [r.rank, r.role, r.status]).sort(), [['Admin', 'admin', 'linked'], ['Modo', 'Modo', 'linked']]);
	assert.equal((await core.roleImport.linkByName(owner)).length, 0, 'already linked ranks are left alone');
});
