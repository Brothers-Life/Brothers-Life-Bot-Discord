import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';

const MAIN_ROLE = '800000000000000001';
const OTHER_ROLE = '810000000000000001';

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	core.network.activate(owner, OTHER);
	executor.roles.set(OTHER, [{ id: OTHER_ROLE, name: 'Modo', editable: true }]);
	const modo = core.ranks.create(owner, { name: 'Modo', level: 40, permissions: [] });
	core.ranks.setRoleLinks(owner, modo.id, [MAIN_ROLE]);
	await core.staffSync.setLinks(owner, modo.id, OTHER, [OTHER_ROLE]);
	executor.rolePermissions.set(`${MAIN}:${MAIN_ROLE}`, { name: 'Modo', permissions: ['ViewChannel', 'KickMembers'], editable: true });
	executor.rolePermissions.set(`${OTHER}:${OTHER_ROLE}`, { name: 'Modo', permissions: ['ViewChannel', 'BanMembers'], editable: true });
	executor.calls.length = 0;
	return { ...ctx, modo };
}

test('preview shows what each linked role is missing or has in excess', async () => {
	const { core, owner, modo } = await setup();
	core.permissionSync.setProfile(owner, modo.id, ['ViewChannel', 'KickMembers', 'ModerateMembers']);
	const rows = await core.permissionSync.preview();
	const main = rows.find(r => r.guildId === MAIN);
	const other = rows.find(r => r.guildId === OTHER);
	assert.deepEqual(main.missing, ['ModerateMembers']);
	assert.deepEqual(main.extra, []);
	assert.deepEqual(other.missing.sort(), ['KickMembers', 'ModerateMembers']);
	assert.deepEqual(other.extra, ['BanMembers']);
});

test('apply sets the profile on every differing role, one failure does not stop the others', async () => {
	const { core, owner, modo, executor } = await setup();
	core.permissionSync.setProfile(owner, modo.id, ['ViewChannel', 'KickMembers']);
	executor.failOn.add(OTHER);
	const result = await core.permissionSync.apply(owner);
	assert.equal(result.applied, 0, 'main role already matches');
	assert.equal(result.failed, 1);

	executor.failOn.clear();
	const retry = await core.permissionSync.apply(owner);
	assert.equal(retry.applied, 1);
	assert.deepEqual(executor.rolePermissions.get(`${OTHER}:${OTHER_ROLE}`).permissions, ['ViewChannel', 'KickMembers']);
	assert.equal((await core.permissionSync.preview()).filter(r => r.missing.length || r.extra.length).length, 0);
});

test('only the owner can give Administrator; unknown permissions are refused', async () => {
	const { core, owner, modo } = await setup();
	const admin = core.ranks.create(owner, { name: 'Admin', level: 80, permissions: ['permsync.manage'] });
	await core.ranks.assignDirect(owner, ALICE, admin.id);
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => core.permissionSync.setProfile(alice, modo.id, ['Administrator']), ForbiddenError);
	assert.throws(() => core.permissionSync.setProfile(alice, modo.id, ['FlyAway']), ValidationError);
	core.permissionSync.setProfile(alice, modo.id, ['ViewChannel']);
	assert.throws(() => core.permissionSync.setProfile(alice, admin.id, ['ViewChannel']), ForbiddenError, 'own level');
});

test('drift is reported once until it changes', async () => {
	const { core, owner, modo } = await setup();
	core.permissionSync.setProfile(owner, modo.id, ['ViewChannel', 'KickMembers']);
	assert.equal((await core.permissionSync.checkDrift()).length, 1);
	await core.permissionSync.checkDrift();
	assert.equal(core.audit.query({ action: 'permissions.drift' }).length, 1);
});
