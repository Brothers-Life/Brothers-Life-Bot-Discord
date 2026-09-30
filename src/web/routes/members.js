import { snowflake } from './helpers.js';

const personParams = { type: 'object', properties: { userId: snowflake, guildId: snowflake }, required: ['userId'] };

export function registerMemberRoutes(app, { core }) {
	const { members, staffSync, ranks, executor } = core;

	app.get('/api/people/:userId', { config: { permission: 'members.view' }, schema: { params: personParams } }, async (request) => {
		return members.lookup(request.params.userId);
	});

	app.post('/api/people/:userId/guilds/:guildId/roles', {
		config: { permission: 'members.manage' },
		schema: { params: personParams, body: { type: 'object', required: ['roleId', 'add'], properties: { roleId: snowflake, add: { type: 'boolean' } } } },
	}, async (request) => {
		const { userId, guildId } = request.params;
		if (request.body.add) await members.addRole(request.actor, guildId, userId, request.body.roleId);
		else await members.removeRole(request.actor, guildId, userId, request.body.roleId);
		return { ok: true };
	});

	app.put('/api/people/:userId/guilds/:guildId/nickname', {
		config: { permission: 'members.manage' },
		schema: { params: personParams, body: { type: 'object', required: ['nickname'], properties: { nickname: { type: ['string', 'null'], maxLength: 32 } } } },
	}, async (request) => {
		await members.setNickname(request.actor, request.params.guildId, request.params.userId, request.body.nickname);
		return { ok: true };
	});

	// Staff roles: which role each rank gives on each server
	app.get('/api/staff-roles', { config: { permission: 'ranks.view' } }, async () => {
		const guilds = staffSync.overview();
		return {
			ranks: ranks.list().map(({ id, name, level, color }) => ({ id, name, level, color })),
			guilds: await Promise.all(guilds.map(async g => ({ ...g, roles: await executor.listRoles(g.id) }))),
		};
	});

	app.put('/api/staff-roles/:rankId/:guildId', {
		config: { permission: 'ranks.manage' },
		schema: {
			params: { type: 'object', properties: { rankId: { type: 'integer' }, guildId: snowflake }, required: ['rankId', 'guildId'] },
			body: { type: 'object', required: ['roleIds'], properties: { roleIds: { type: 'array', items: snowflake, maxItems: 20 } } },
		},
	}, async (request) => {
		await staffSync.setLinks(request.actor, request.params.rankId, request.params.guildId, request.body.roleIds);
		return { ok: true };
	});

	app.post('/api/staff-roles/sync', { config: { permission: 'ranks.manage' } }, async () => staffSync.syncAll());
}
