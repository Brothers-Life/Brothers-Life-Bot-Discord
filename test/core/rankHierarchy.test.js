import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';

const MOD_ROLE = '800000000000000061';

test('inheritance: a rank gets the permissions of every lower rank, shown with their origin', async () => {
	const { core, owner } = await withNetwork();
	core.ranks.create(owner, { name: 'Helper', level: 10, permissions: ['panel.access', 'tickets.view'] });
	core.ranks.create(owner, { name: 'Support', level: 20, permissions: ['dm.view'] });
	const mod = core.ranks.create(owner, { name: 'Modo', level: 30, permissions: ['sanctions.warn'], inherit: true });
	assert.deepEqual(mod.permissions, ['sanctions.warn']);
	assert.deepEqual(mod.inherited.map(i => `${i.permission}<${i.from}`).sort(), ['dm.view<Support', 'panel.access<Helper', 'tickets.view<Helper']);
	await core.ranks.assignDirect(owner, ALICE, mod.id);
	const alice = await core.ranks.resolve(ALICE);
	assert.ok(alice.can('tickets.view') && alice.can('dm.view') && alice.can('sanctions.warn'));

	// Turning inheritance off takes them back
	core.ranks.update(owner, mod.id, { inherit: false });
	core.ranks.invalidate();
	assert.equal((await core.ranks.resolve(ALICE)).can('tickets.view'), false);
});

test('inheritance cannot be used to hand out permissions the editor does not hold; duplicate copies everything but roles', async () => {
	const { core, owner } = await withNetwork();
	core.ranks.create(owner, { name: 'Base', level: 5, permissions: ['panel.access', 'backups.restore'] });
	const manager = core.ranks.create(owner, { name: 'Gestion', level: 50, permissions: ['panel.access', 'ranks.manage'] });
	await core.ranks.assignDirect(owner, BOB, manager.id);
	const bob = await core.ranks.resolve(BOB);
	assert.throws(() => core.ranks.create(bob, { name: 'Malin', level: 10, permissions: ['panel.access'], inherit: true }), ForbiddenError, 'would inherit backups.restore');

	const mod = core.ranks.create(owner, { name: 'Modo', level: 30, permissions: ['sanctions.warn'], inherit: true, syncRoles: false });
	const copy = core.ranks.duplicate(owner, mod.id);
	assert.deepEqual([copy.name, copy.level, copy.permissions, copy.inherit, copy.syncRoles, copy.roles], ['Modo (copie)', 29, ['sanctions.warn'], true, false, []]);
	assert.equal(core.ranks.duplicate(owner, mod.id).name, 'Modo (copie 2)');
});

test('roles: copied to the other servers (created then linked); a rank not synced is left alone there', async () => {
	const { core, owner, executor } = await withNetwork();
	core.network.activate(owner, OTHER);
	executor.roles.set(MAIN, [{ id: MOD_ROLE, name: 'Modérateur', color: '#e67e22', editable: true, dangerous: false, permissions: '2048' }]);
	executor.roles.set(OTHER, []);
	executor.guildModels.set(OTHER, { id: OTHER, name: 'Other', roles: [], channels: [], settings: {}, botRolePosition: 10 });
	const mod = core.ranks.create(owner, { name: 'Modo', level: 30, permissions: ['panel.access'] });
	core.ranks.setRoleLinks(owner, mod.id, [MOD_ROLE]);

	const { results, copiedPermissions } = await core.staffSync.copyRoleToNetwork(owner, mod.id);
	assert.equal(copiedPermissions, true);
	const other = results.find(r => r.guildId === OTHER);
	assert.equal(other.status, 'created');
	const created = executor.model(OTHER).roles[0];
	assert.deepEqual([created.name, created.permissions], ['Modérateur', '2048']);
	assert.deepEqual(core.staffSync.linksOf(OTHER).get(mod.id), [other.roleId]);
	assert.equal((await core.staffSync.copyRoleToNetwork(owner, mod.id)).results.find(r => r.guildId === OTHER).status, 'already');

	// Not synced: the member keeps (or never gets) the role on the other server
	core.ranks.update(owner, mod.id, { syncRoles: false });
	await core.ranks.assignDirect(owner, ALICE, mod.id);
	executor.memberRoles.set(`${OTHER}:${ALICE}`, []);
	await core.staffSync.syncUser(ALICE);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${ALICE}`), []);
	core.ranks.update(owner, mod.id, { syncRoles: true });
	await core.staffSync.syncUser(ALICE);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${ALICE}`), [other.roleId]);
});
