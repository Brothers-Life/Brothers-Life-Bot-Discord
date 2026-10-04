import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { createAudit } from '../../src/core/audit.js';
import { createRankService } from '../../src/core/ranks.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';

const OWNER = '100000000000000001';
const ALICE = '100000000000000002';
const BOB = '100000000000000003';
const CAROL = '100000000000000004';
const MAIN = '900000000000000001';

let db, audit, ranks, memberRoles;

beforeEach(() => {
	db = openDb(':memory:');
	audit = createAudit({ db });
	memberRoles = new Map();
	ranks = createRankService({
		db,
		audit,
		ownerId: OWNER,
		getMainGuildId: () => MAIN,
		getMemberRoleIds: async (guildId, userId) => (guildId === MAIN ? memberRoles.get(userId) ?? null : null),
	});
});

async function owner() {
	return ranks.resolve(OWNER);
}

test('the owner has every permission, even unknown ones', async () => {
	const principal = await owner();
	assert.equal(principal.isOwner, true);
	assert.ok(principal.can('versions.install'));
	assert.ok(principal.can('something.from_the_future'));
});

test('a user without rank has no permission', async () => {
	const principal = await ranks.resolve(ALICE);
	assert.equal(principal.can('panel.access'), false);
	assert.deepEqual(principal.permissions, []);
	assert.equal(principal.level, 0);
});

test('permissions are the union of role ranks and direct ranks', async () => {
	const modo = ranks.create(await owner(), { name: 'Modo', level: 20, permissions: ['panel.access', 'audit.view'] });
	const logs = ranks.create(await owner(), { name: 'Logs', level: 10, permissions: ['logs.manage'] });
	ranks.setRoleLinks(await owner(), modo.id, ['role-modo']);
	memberRoles.set(ALICE, ['role-modo', 'other-role']);
	await ranks.assignDirect(await owner(), ALICE, logs.id);

	const principal = await ranks.resolve(ALICE);
	assert.deepEqual(principal.permissions, ['audit.view', 'logs.manage', 'panel.access']);
	assert.equal(principal.level, 20);
	assert.deepEqual(principal.ranks.map(r => r.name).sort(), ['Logs', 'Modo']);
});

test('role ranks only count on the main server', async () => {
	const modo = ranks.create(await owner(), { name: 'Modo', level: 20, permissions: ['panel.access'] });
	ranks.setRoleLinks(await owner(), modo.id, ['role-modo']);
	// Not a member of the main server
	const principal = await ranks.resolve(BOB);
	assert.equal(principal.can('panel.access'), false);
});

test('cache is invalidated when roles change', async () => {
	const modo = ranks.create(await owner(), { name: 'Modo', level: 20, permissions: ['panel.access'] });
	ranks.setRoleLinks(await owner(), modo.id, ['role-modo']);
	memberRoles.set(ALICE, ['role-modo']);
	assert.ok((await ranks.resolve(ALICE)).can('panel.access'));

	memberRoles.set(ALICE, []);
	assert.ok((await ranks.resolve(ALICE)).can('panel.access'), 'still cached');
	ranks.invalidate(ALICE);
	assert.equal((await ranks.resolve(ALICE)).can('panel.access'), false);
});

test('rejects unknown permissions and invalid levels', async () => {
	assert.throws(() => ranks.create(ranks.system, { name: 'X', level: 10, permissions: ['nope.nope'] }), ValidationError);
	assert.throws(() => ranks.create(ranks.system, { name: 'X', level: 101, permissions: [] }), ValidationError);
	assert.throws(() => ranks.create(ranks.system, { name: '', level: 1, permissions: [] }), ValidationError);
});

async function setupAdmin() {
	// Alice: Admin (level 50) with ranks.manage + members.assign + panel.access
	const admin = ranks.create(await owner(), {
		name: 'Admin', level: 50, permissions: ['panel.access', 'ranks.manage', 'members.assign', 'audit.view'],
	});
	await ranks.assignDirect(await owner(), ALICE, admin.id);
	return { admin, alice: await ranks.resolve(ALICE) };
}

test('cannot grant a permission you do not have', async () => {
	const { alice } = await setupAdmin();
	assert.throws(() => ranks.create(alice, { name: 'Sneaky', level: 10, permissions: ['versions.install'] }), ForbiddenError);
	const ok = ranks.create(alice, { name: 'Helper', level: 10, permissions: ['audit.view'] });
	assert.throws(() => ranks.update(alice, ok.id, { permissions: ['audit.view', 'console.control'] }), ForbiddenError);
});

test('cannot touch a rank of equal or higher level', async () => {
	const { admin, alice } = await setupAdmin();
	const boss = ranks.create(await owner(), { name: 'Boss', level: 80, permissions: [] });
	assert.throws(() => ranks.update(alice, boss.id, { name: 'Pwned' }), ForbiddenError);
	assert.throws(() => ranks.remove(alice, boss.id), ForbiddenError);
	assert.throws(() => ranks.update(alice, admin.id, { name: 'Same level' }), ForbiddenError);
	assert.throws(() => ranks.create(alice, { name: 'Equal', level: 50, permissions: [] }), ForbiddenError);
	const low = ranks.create(alice, { name: 'Low', level: 10, permissions: [] });
	assert.throws(() => ranks.update(alice, low.id, { level: 60 }), ForbiddenError);
});

test('cannot change your own ranks', async () => {
	const { alice } = await setupAdmin();
	const low = ranks.create(alice, { name: 'Low', level: 10, permissions: [] });
	await assert.rejects(ranks.assignDirect(alice, ALICE, low.id), ForbiddenError);
});

test('cannot change ranks of someone at or above your level', async () => {
	const { alice } = await setupAdmin();
	const low = ranks.create(alice, { name: 'Low', level: 10, permissions: [] });
	const peer = ranks.create(await owner(), { name: 'Peer', level: 50, permissions: [] });
	await ranks.assignDirect(await owner(), CAROL, peer.id);
	await assert.rejects(ranks.assignDirect(alice, CAROL, low.id), ForbiddenError);
	await ranks.assignDirect(alice, BOB, low.id);
	assert.deepEqual((await ranks.resolve(BOB)).ranks.map(r => r.name), ['Low']);
	await ranks.unassignDirect(alice, BOB, low.id);
	assert.deepEqual((await ranks.resolve(BOB)).ranks, []);
});

test('needs the matching permission', async () => {
	const helper = ranks.create(await owner(), { name: 'Helper', level: 30, permissions: ['panel.access'] });
	await ranks.assignDirect(await owner(), BOB, helper.id);
	const bob = await ranks.resolve(BOB);
	assert.throws(() => ranks.create(bob, { name: 'X', level: 1, permissions: [] }), ForbiddenError);
	await assert.rejects(ranks.assignDirect(bob, CAROL, helper.id), ForbiddenError);
});

test('changes are audited', async () => {
	const rank = ranks.create(await owner(), { name: 'Modo', level: 20, permissions: ['panel.access'] });
	ranks.update(await owner(), rank.id, { name: 'Modérateur' });
	ranks.remove(await owner(), rank.id);
	const actions = audit.query().map(e => e.action);
	assert.deepEqual(actions, ['ranks.delete', 'ranks.update', 'ranks.create']);
});

test('lists panel members with the origin of their ranks', async () => {
	const modo = ranks.create(await owner(), { name: 'Modo', level: 20, permissions: ['panel.access'] });
	await ranks.assignDirect(await owner(), ALICE, modo.id);
	const members = ranks.listDirectAssignments();
	assert.deepEqual(members.map(m => [m.discordId, m.rankId]), [[ALICE, modo.id]]);
});

test('@everyone cannot grant a rank', async () => {
	const rank = ranks.create(await owner(), { name: 'Modo', level: 20, permissions: ['panel.access'] });
	assert.throws(() => ranks.setRoleLinks(ranks.system, rank.id, [MAIN]), ValidationError);
});

test('linking or assigning a rank cannot hand out permissions you do not hold', async () => {
	const { alice } = await setupAdmin();
	const powerful = ranks.create(await owner(), { name: 'Technique', level: 10, permissions: ['versions.install'] });
	assert.throws(() => ranks.setRoleLinks(alice, powerful.id, ['role-membre']), ForbiddenError);
	await assert.rejects(ranks.assignDirect(alice, BOB, powerful.id), ForbiddenError);
	const harmless = ranks.create(alice, { name: 'Helper', level: 10, permissions: ['audit.view'] });
	ranks.setRoleLinks(alice, harmless.id, ['role-helper']);
	await ranks.assignDirect(alice, BOB, harmless.id);
});
