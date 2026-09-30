import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';

const MODO_MAIN = '800000000000000001';
const MODO_OTHER = '810000000000000001';
const HELPER_OTHER = '810000000000000002';

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	core.network.activate(owner, OTHER);
	executor.roles.set(OTHER, [
		{ id: MODO_OTHER, name: 'Modo', editable: true },
		{ id: HELPER_OTHER, name: 'Helper', editable: true },
		{ id: '810000000000000009', name: 'Admin', editable: false },
	]);
	const modo = core.ranks.create(owner, { name: 'Modo', level: 40, permissions: [] });
	core.ranks.setRoleLinks(owner, modo.id, [MODO_MAIN]);
	await core.staffSync.setLinks(owner, modo.id, OTHER, [MODO_OTHER]);
	executor.calls.length = 0;
	return { ...ctx, modo };
}

test('a rank holder gets the linked role on the other servers, and loses it with the rank', async () => {
	const { core, executor } = await setup();
	executor.memberRoles.set(`${MAIN}:${ALICE}`, [MODO_MAIN]);
	executor.memberRoles.set(`${OTHER}:${ALICE}`, []);

	await core.staffSync.syncUser(ALICE);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${ALICE}`), [MODO_OTHER]);

	executor.memberRoles.set(`${MAIN}:${ALICE}`, []);
	core.ranks.invalidate(ALICE);
	await core.staffSync.syncUser(ALICE);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${ALICE}`), []);
	assert.equal(core.audit.query({ action: 'staff_sync.member' }).length, 2);
});

test('roles not linked to a rank are never touched', async () => {
	const { core, executor } = await setup();
	executor.memberRoles.set(`${OTHER}:${BOB}`, ['820000000000000000', HELPER_OTHER]);
	await core.staffSync.syncMember(OTHER, BOB);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${BOB}`), ['820000000000000000', HELPER_OTHER]);
	assert.equal(executor.calls.length, 0);
});

test('direct ranks count too; non-members are skipped', async () => {
	const { core, executor, owner, modo } = await setup();
	await core.ranks.assignDirect(owner, BOB, modo.id);
	executor.memberRoles.set(`${OTHER}:${BOB}`, []);
	await core.staffSync.syncUser(BOB);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${BOB}`), [MODO_OTHER]);
	assert.equal(await core.staffSync.syncMember(OTHER, '399999999999999999'), null);
});

test('syncAll finds rank holders and stale role holders', async () => {
	const { core, executor } = await setup();
	executor.memberRoles.set(`${MAIN}:${ALICE}`, [MODO_MAIN]);
	executor.memberRoles.set(`${OTHER}:${ALICE}`, []);
	executor.memberRoles.set(`${OTHER}:${BOB}`, [MODO_OTHER]);
	const { changed } = await core.staffSync.syncAll();
	assert.equal(changed, 2);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${ALICE}`), [MODO_OTHER]);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${BOB}`), []);
});

test('links: roles above the bot, @everyone and unknown roles are refused', async () => {
	const { core, owner, modo } = await setup();
	await assert.rejects(core.staffSync.setLinks(owner, modo.id, OTHER, ['810000000000000009']), /au-dessus/);
	await assert.rejects(core.staffSync.setLinks(owner, modo.id, OTHER, [OTHER]), ValidationError);
	await assert.rejects(core.staffSync.setLinks(owner, modo.id, OTHER, ['899999999999999999']), ValidationError);
});

test('links need ranks.manage and a rank below your level', async () => {
	const { core, owner, modo } = await setup();
	const admin = core.ranks.create(owner, { name: 'Admin', level: 40, permissions: ['ranks.manage'] });
	await core.ranks.assignDirect(owner, ALICE, admin.id);
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(core.staffSync.setLinks(alice, modo.id, OTHER, [HELPER_OTHER]), ForbiddenError);
	const bob = await core.ranks.resolve(BOB);
	await assert.rejects(core.staffSync.setLinks(bob, modo.id, OTHER, [HELPER_OTHER]), ForbiddenError);
});

test('members: lookup across the network', async () => {
	const { core, executor } = await setup();
	executor.memberRoles.set(`${MAIN}:${ALICE}`, [MODO_MAIN]);
	executor.memberRoles.set(`${OTHER}:${ALICE}`, [MODO_OTHER]);
	const profile = await core.members.lookup(ALICE);
	assert.deepEqual(profile.ranks.map(r => r.name), ['Modo']);
	assert.equal(profile.guilds.length, 2);
	assert.equal(profile.guilds.find(g => g.id === OTHER).member.roles[0].linkedToRank, true);
	assert.equal(profile.sanctions.banned, false);
});

test('members: role changes are guarded', async () => {
	const { core, owner, executor } = await setup();
	executor.roles.set(OTHER, [
		{ id: MODO_OTHER, name: 'Modo', editable: true },
		{ id: HELPER_OTHER, name: 'Helper', editable: true },
		{ id: '810000000000000007', name: 'Admin', editable: true, dangerous: true },
	]);
	executor.memberRoles.set(`${OTHER}:${BOB}`, []);
	const manager = core.ranks.create(owner, { name: 'Gérant', level: 50, permissions: ['members.manage'] });
	await core.ranks.assignDirect(owner, ALICE, manager.id);
	const alice = await core.ranks.resolve(ALICE);

	await core.members.addRole(alice, OTHER, BOB, HELPER_OTHER);
	assert.deepEqual(executor.memberRoles.get(`${OTHER}:${BOB}`), [HELPER_OTHER]);
	await assert.rejects(core.members.addRole(alice, OTHER, BOB, MODO_OTHER), /lié à un rang/);
	await assert.rejects(core.members.addRole(alice, OTHER, BOB, '810000000000000007'), ForbiddenError);
	await assert.rejects(core.members.addRole(alice, OTHER, ALICE, HELPER_OTHER), ForbiddenError);
	await core.members.addRole(owner, OTHER, BOB, '810000000000000007');
	await core.members.setNickname(alice, OTHER, BOB, 'Bobby');
	assert.equal(core.audit.query({ action: 'members' }).length, 3);
});

test('only the owner can link a dangerous role to a rank', async () => {
	const { core, owner, modo, executor } = await setup();
	executor.roles.set(OTHER, [{ id: '810000000000000007', name: 'Admin', editable: true, dangerous: true }]);
	const manager = core.ranks.create(owner, { name: 'Gérant', level: 80, permissions: ['ranks.manage'] });
	await core.ranks.assignDirect(owner, ALICE, manager.id);
	const alice = await core.ranks.resolve(ALICE);
	await assert.rejects(core.staffSync.setLinks(alice, modo.id, OTHER, ['810000000000000007']), ForbiddenError);
	await core.staffSync.setLinks(owner, modo.id, OTHER, ['810000000000000007']);
});

test('members: search by name across the network, exact names first, or by ID', async () => {
	const { core, executor } = await setup();
	executor.guildMembers.set(MAIN, [
		{ id: '300000000000000001', username: 'pedro_fan' },
		{ id: '300000000000000002', username: 'pedro', globalName: 'Pedro' },
	]);
	executor.guildMembers.set(OTHER, [
		{ id: '300000000000000002', username: 'pedro', nickname: 'Chef' },
		{ id: '300000000000000003', username: 'max' },
	]);
	const found = await core.members.search('Pedro');
	assert.deepEqual(found.map(m => m.id), ['300000000000000002', '300000000000000001']);
	assert.deepEqual(found[0].guilds, ['Main', 'Other']);
	assert.deepEqual((await core.members.search('@max')).map(m => m.id), ['300000000000000003']);
	assert.equal((await core.members.search('p')).length, 0, 'at least 2 characters');
	assert.equal((await core.members.search(ALICE))[0].id, ALICE, 'an ID still works');
});
