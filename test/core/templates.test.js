import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { plan, remapDeep } from '../../src/core/templates/plan.js';

const TARGET = '900000000000000003';

// Model server: roles Patron > Employé, a category with a staff-only text channel and a voice channel
function modelGuild() {
	return {
		id: OTHER, name: 'Modèle Entreprise', community: false, botRolePosition: 10,
		roles: [
			{ id: OTHER, name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: '1024', position: 0, managed: false, everyone: true },
			{ id: '810000000000000001', name: 'Employé', color: 0x3498db, hoist: true, mentionable: false, permissions: '2048', position: 1, managed: false, everyone: false },
			{ id: '810000000000000002', name: 'Patron', color: 0xe67e22, hoist: true, mentionable: true, permissions: '8', position: 2, managed: false, everyone: false },
			{ id: '810000000000000003', name: 'Bot musique', color: 0, hoist: false, mentionable: false, permissions: '0', position: 3, managed: true, everyone: false },
		],
		channels: [
			{ id: '820000000000000001', type: 'category', name: 'ENTREPRISE', position: 0, parentId: null, overwrites: [] },
			{ id: '820000000000000002', type: 'text', name: 'direction', position: 1, parentId: '820000000000000001', topic: 'Réservé à la direction',
				overwrites: [{ id: OTHER, type: 'role', allow: '0', deny: '1024' }, { id: '810000000000000002', type: 'role', allow: '1024', deny: '0' }, { id: '300000000000000001', type: 'member', allow: '1024', deny: '0' }] },
			{ id: '820000000000000003', type: 'announcement', name: 'annonces', position: 2, parentId: '820000000000000001', overwrites: [] },
			{ id: '820000000000000004', type: 'voice', name: 'Réunion', position: 3, parentId: '820000000000000001', overwrites: [] },
		],
		settings: { verificationLevel: 2, defaultMessageNotifications: 1, explicitContentFilter: 2, afkChannelId: '820000000000000004', afkTimeout: 300, systemChannelId: '820000000000000002', systemChannelFlags: 0, rulesChannelId: null, publicUpdatesChannelId: null, preferredLocale: 'fr' },
	};
}

function targetGuild() {
	return {
		id: TARGET, name: 'Taxi Los Santos', community: false, botRolePosition: 5,
		roles: [
			{ id: TARGET, name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: '0', position: 0, managed: false, everyone: true },
			{ id: '830000000000000001', name: 'Patron', color: 0, hoist: false, mentionable: false, permissions: '0', position: 1, managed: false, everyone: false },
			{ id: '830000000000000002', name: 'Vieux rôle', color: 0, hoist: false, mentionable: false, permissions: '0', position: 2, managed: false, everyone: false },
			{ id: '830000000000000009', name: 'Admin', color: 0, hoist: false, mentionable: false, permissions: '8', position: 9, managed: false, everyone: false },
		],
		channels: [{ id: '840000000000000001', type: 'text', name: 'général', position: 0, parentId: null, overwrites: [] }],
		settings: { verificationLevel: 0, afkChannelId: null, systemChannelId: '840000000000000001' },
	};
}

async function setup() {
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	core.network.upsertSeen({ id: TARGET, name: 'Taxi Los Santos' });
	for (const id of [OTHER, TARGET]) core.network.activate(owner, id);
	executor.guildModels.set(OTHER, modelGuild());
	executor.guildModels.set(TARGET, targetGuild());
	executor.channels.set('820000000000000002', { guildId: OTHER, name: 'direction' });
	return ctx;
}

test('plan: roles kept by name, managed and above-the-bot roles untouched, community-only types downgraded', () => {
	const template = { guild: modelGuild() };
	template.guild.roles = template.guild.roles.filter(r => !r.managed);
	const { ops, warnings } = plan(template, targetGuild(), { roles: {}, channels: {} }, 'reset');
	const byOp = name => ops.filter(o => o.op === name);
	assert.deepEqual(byOp('editRole').map(o => o.name), ['Patron', '@everyone']);
	assert.deepEqual(byOp('createRole').map(o => o.name), ['Employé']);
	assert.deepEqual(byOp('deleteRole').map(o => o.name), ['Vieux rôle'], 'Admin is above the bot: kept');
	assert.equal(byOp('createChannel')[0].data.type, 'category');
	assert.equal(byOp('createChannel').find(o => o.name === 'annonces').data.type, 'text');
	assert.match(warnings.join(), /annonces.*Communauté/);
	// New channels before the settings, old ones deleted after
	const idx = name => ops.findIndex(o => o.op === name);
	assert.ok(idx('createChannel') < idx('settings') && idx('settings') < idx('deleteChannel'));

	const repair = plan(template, targetGuild(), { roles: {}, channels: {} }, 'repair').ops;
	assert.equal(repair.filter(o => o.op.startsWith('delete')).length, 0, 'repair never deletes');
	assert.deepEqual(remapDeep({ a: ['1', '2'], b: '{"x":"1"}' }, new Map([['1', '9']])), { a: ['9', '2'], b: '{"x":"9"}' });
});

test('several templates; reset rebuilds the target with its panel configuration; guards', async () => {
	const { core, owner, executor } = await setup();
	const tickets = core.tickets;
	// Panel configuration of the model: a ticket type in its category, logs in #direction
	await tickets.saveCategory(owner, OTHER, { name: 'Recrutement', parentChannelId: '820000000000000001', roleIds: ['810000000000000002'] });
	core.db.prepare('INSERT OR REPLACE INTO log_routes (guild_id, category, channel_id, enabled) VALUES (?, ?, ?, 1)').run(OTHER, 'tickets', '820000000000000002');

	const entreprise = await core.templates.create(owner, { name: 'Entreprise', sourceGuildId: OTHER });
	assert.deepEqual(entreprise.summary, { roles: 2, categories: 1, channels: 3, ticketTypes: 1, logRoutes: 1, automod: false });
	await assert.rejects(core.templates.create(owner, { name: 'X', sourceGuildId: MAIN }), /principal/);
	executor.guildModels.set(MAIN, modelGuild());
	const gang = await core.templates.create(owner, { name: 'Gang', sourceGuildId: OTHER });
	assert.equal(core.templates.list().length, 2);
	assert.deepEqual(core.templates.targets().map(t => t.id), [TARGET], 'neither the main server nor a model source');

	assert.throws(() => core.templates.apply(owner, entreprise.id, { guildId: TARGET, mode: 'reset', confirmName: 'mauvais' }), /nom exact/);
	assert.throws(() => core.templates.apply(owner, entreprise.id, { guildId: OTHER, mode: 'repair' }), ForbiddenError);
	assert.throws(() => core.templates.apply(owner, entreprise.id, { guildId: MAIN, mode: 'repair' }), ForbiddenError);

	core.templates.apply(owner, entreprise.id, { guildId: TARGET, mode: 'reset', confirmName: 'taxi los santos' });
	assert.throws(() => core.templates.apply(owner, gang.id, { guildId: TARGET, mode: 'repair' }), /déjà en cours/);
	const job = await core.templates.settle();
	assert.equal(job.status, 'done');
	assert.equal(job.done, job.total);

	const t = executor.model(TARGET);
	assert.deepEqual(t.roles.filter(r => !r.everyone).map(r => r.name).sort(), ['Admin', 'Employé', 'Patron']);
	assert.equal(t.roles.find(r => r.name === 'Patron').id, '830000000000000001', 'existing role kept (members keep it)');
	assert.equal(t.roles.find(r => r.everyone).permissions, '1024');
	assert.deepEqual(t.channels.map(c => c.name).sort(), ['ENTREPRISE', 'Réunion', 'annonces', 'direction']);
	const direction = t.channels.find(c => c.name === 'direction');
	assert.equal(direction.parentId, t.channels.find(c => c.name === 'ENTREPRISE').id);
	assert.deepEqual(direction.overwrites.map(o => o.id).sort(), ['830000000000000001', TARGET].sort(), 'role overwrites remapped, member ones dropped');
	assert.equal(t.settings.afkChannelId, t.channels.find(c => c.name === 'Réunion').id);
	assert.equal(t.settings.verificationLevel, 2);

	// Panel: ticket type remapped to the new category and role, log route to the new #direction
	const [copied] = core.db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ?').all(TARGET);
	assert.equal(copied.name, 'Recrutement');
	assert.equal(copied.parent_channel_id, t.channels.find(c => c.name === 'ENTREPRISE').id);
	assert.deepEqual(JSON.parse(copied.role_ids), ['830000000000000001']);
	assert.equal(core.db.prepare('SELECT channel_id FROM log_routes WHERE guild_id = ? AND category = ?').get(TARGET, 'tickets').channel_id, direction.id);
	assert.equal(core.templates.targets()[0].application.templateId, entreprise.id);
});

test('repair: recreates what is missing, deletes nothing, reuses the correspondence', async () => {
	const { core, owner, executor } = await setup();
	const template = await core.templates.create(owner, { name: 'Entreprise', sourceGuildId: OTHER });
	core.templates.apply(owner, template.id, { guildId: TARGET, mode: 'reset', confirmName: 'Taxi Los Santos' });
	await core.templates.settle();
	const t = executor.model(TARGET);
	const direction = t.channels.find(c => c.name === 'direction');
	// Someone renamed #direction, deleted #annonces and added a channel
	direction.name = 'bureau';
	t.channels = t.channels.filter(c => c.name !== 'annonces');
	t.channels.push({ id: '840000000000000099', type: 'text', name: 'perso', position: 9, parentId: null, overwrites: [] });

	core.templates.apply(owner, template.id, { guildId: TARGET, mode: 'repair' });
	const job = await core.templates.settle();
	assert.equal(job.report.deleted, 0);
	const after = executor.model(TARGET);
	assert.equal(after.channels.find(c => c.id === direction.id).name, 'direction', 'renamed back through the correspondence');
	assert.ok(after.channels.some(c => c.name === 'annonces'));
	assert.ok(after.channels.some(c => c.name === 'perso'), 'extra channel kept');
});

test('a failing role becomes a warning, the job goes on; permissions', async () => {
	const { core, owner, executor } = await setup();
	executor.failOn.add('role:Employé');
	const template = await core.templates.create(owner, { name: 'Entreprise', sourceGuildId: OTHER });
	core.templates.apply(owner, template.id, { guildId: TARGET, mode: 'reset', confirmName: 'Taxi Los Santos' });
	const job = await core.templates.settle();
	assert.equal(job.status, 'done');
	assert.match(job.warnings.join('\n'), /Employé.*Missing Permissions/);
	assert.ok(executor.model(TARGET).channels.some(c => c.name === 'direction'));
	const nobody = { id: '1', can: () => false };
	await assert.rejects(core.templates.create(nobody, { name: 'x', sourceGuildId: OTHER }), /templates.manage/);
	assert.throws(() => core.templates.apply(nobody, template.id, { guildId: TARGET, mode: 'repair' }), /templates.apply/);
});

test('a job cut by a restart is reported as interrupted', async () => {
	const { core, owner } = await setup();
	const template = await core.templates.create(owner, { name: 'Entreprise', sourceGuildId: OTHER });
	core.settings.set('templates.running', { guildId: TARGET, templateId: template.id, mode: 'reset', by: owner.id, startedAt: Date.now() });
	const { createTemplates } = await import('../../src/core/templates/index.js');
	const restarted = createTemplates({ ...core, logger: { error: () => undefined } });
	const [target] = restarted.targets();
	assert.equal(target.application.status, 'failed');
	assert.match(target.application.report.warnings[0], /Interrompue/);
	assert.equal(core.settings.get('templates.running', null), null);
});
