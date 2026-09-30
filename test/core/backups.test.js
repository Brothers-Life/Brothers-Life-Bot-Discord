import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';

const MEMBER = '300000000000000031';
const HELPER = '810000000000000005';

function mainGuild() {
	return {
		id: MAIN, name: 'Main', community: false, botRolePosition: 10,
		roles: [
			{ id: MAIN, name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: '1024', position: 0, managed: false, everyone: true },
			{ id: HELPER, name: 'Helper', color: 0x3498db, hoist: true, mentionable: false, permissions: '2048', position: 1, managed: false, everyone: false },
		],
		channels: [
			{ id: '820000000000000011', type: 'category', name: 'INFOS', position: 0, parentId: null, overwrites: [] },
			{ id: '820000000000000012', type: 'text', name: 'règlement', position: 1, parentId: '820000000000000011', topic: 'À lire', overwrites: [{ id: HELPER, type: 'role', allow: '2048', deny: '0' }] },
			{ id: '820000000000000013', type: 'text', name: 'général', position: 2, parentId: null, overwrites: [] },
		],
		settings: { verificationLevel: 2, systemChannelId: '820000000000000013', afkChannelId: null },
	};
}

async function setup() {
	const ctx = await withNetwork();
	ctx.executor.guildModels.set(MAIN, mainGuild());
	ctx.executor.memberRoles.set(`${MAIN}:${MEMBER}`, [HELPER]);
	return ctx;
}

test('backup of the main server, then a raid, then a full restore: channels, roles and members\' roles come back', async () => {
	const { core, owner, executor } = await setup();
	const backup = await core.backups.create(owner, MAIN, 'Avant la saison 2');
	assert.deepEqual([backup.roles, backup.channels, backup.members], [1, 3, 1]);
	assert.ok(backup.size > 0 && backup.size < 5000, 'compressed');

	// Raid: #règlement and the Helper role deleted, spam channels created, the member lost his role
	const g = executor.model(MAIN);
	g.channels = g.channels.filter(c => c.name !== 'règlement');
	g.channels.push({ id: '840000000000000001', type: 'text', name: 'raid-lol', position: 5, parentId: null, overwrites: [] });
	g.roles = g.roles.filter(r => r.id !== HELPER);
	executor.memberRoles.set(`${MAIN}:${MEMBER}`, []);

	assert.throws(() => core.backups.restore(owner, backup.id, { mode: 'restore', confirmName: 'mauvais' }), /nom exact/);
	core.backups.restore(owner, backup.id, { mode: 'restore', confirmName: 'main' });
	const job = await core.templates.settle();
	assert.equal(job.status, 'done');

	const after = executor.model(MAIN);
	assert.deepEqual(after.channels.map(c => c.name).sort(), ['INFOS', 'général', 'règlement'], 'spam removed, #règlement back');
	const helper = after.roles.find(r => r.name === 'Helper');
	assert.ok(helper, 'role recreated');
	const rules = after.channels.find(c => c.name === 'règlement');
	assert.equal(rules.parentId, '820000000000000011', 'back in its category');
	assert.deepEqual(rules.overwrites.map(o => o.id), [helper.id], 'permissions point to the new role');
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER}`), [helper.id], 'member got the role back');
	assert.equal(job.report.memberRoles, 1);
});

test('repair deletes nothing; nightly backups keep only the last ones; permissions', async () => {
	// 04:05 in Paris
	let clock = Date.UTC(2026, 9, 1, 2, 5);
	const ctx = await setup();
	const { core, owner, executor } = ctx;
	const { createBackups } = await import('../../src/core/backups.js');
	const backups = createBackups({ db: core.db, network: core.network, audit: core.audit, executor, settings: core.settings, templates: core.templates, logs: core.logs, logger: { warn: () => undefined }, now: () => clock });
	backups.setConfig(owner, { hour: 4, keep: 2 });
	for (let day = 0; day < 4; day++) {
		assert.equal(await backups.tick(), 1);
		assert.equal(await backups.tick(), 0, 'once a day');
		clock += 86_400_000;
	}
	assert.equal(backups.list(MAIN).filter(b => b.kind === 'auto').length, 2);
	clock += 3_600_000 * 5;
	assert.equal(await backups.tick(), 0, 'not the chosen hour');

	const manual = await backups.create(owner, MAIN);
	executor.model(MAIN).channels.push({ id: '840000000000000002', type: 'text', name: 'nouveau', position: 9, parentId: null, overwrites: [] });
	backups.restore(owner, manual.id, { mode: 'repair' });
	const job = await core.templates.settle();
	assert.equal(job.report.deleted, 0);
	assert.ok(executor.model(MAIN).channels.some(c => c.name === 'nouveau'));

	const viewer = { id: '1', can: p => p === 'backups.view' };
	await assert.rejects(backups.create(viewer, MAIN), ForbiddenError);
	assert.throws(() => backups.restore(viewer, manual.id), ForbiddenError);
});
