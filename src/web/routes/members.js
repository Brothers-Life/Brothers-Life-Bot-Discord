import { resolveNames, snowflake } from './helpers.js';

const personParams = { type: 'object', properties: { userId: snowflake, guildId: snowflake }, required: ['userId'] };

export function registerMemberRoutes(app, { core }) {
	const { members, staffSync, ranks, executor } = core;

	// Autocomplete of the "member" fields of the panel (any panel user: the staff needs it everywhere)
	app.get('/api/people/search', {
		config: { permission: null },
		schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 100 } } } },
	}, async (request) => members.search(request.query.q));

	// The whole network, page by page (the panel loads the next page while scrolling)
	app.get('/api/people', {
		config: { permission: 'members.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					q: { type: 'string', maxLength: 100 },
					guildId: snowflake,
					bots: { type: 'boolean' },
					filter: { type: 'string', enum: ['boosters', 'voice', 'new', 'timedout'] },
					offset: { type: 'integer', minimum: 0 },
					limit: { type: 'integer', minimum: 1, maximum: 100 },
				},
			},
		},
	}, async (request) => members.directory(request.query));

	app.get('/api/people/:userId', { config: { permission: 'members.view' }, schema: { params: personParams } }, async (request) => {
		return members.lookup(request.params.userId);
	});

	// Activity, invitations, tickets, applications, name history, recent events
	app.get('/api/people/:userId/insights', { config: { permission: 'members.view' }, schema: { params: personParams } }, async (request) => {
		const data = await core.memberInsights.of(request.params.userId);
		const people = await resolveNames(executor, [...data.invites.invitedBy.map(i => i.inviterId), ...data.timeline.map(e => e.actorId)]);
		const guildIds = [...new Set(data.activity.topChannels.map(c => c.guildId))];
		const channels = new Map();
		for (const id of guildIds) {
			const [text, voice] = await Promise.all([executor.listTextChannels(id).catch(() => []), executor.listVoiceChannels(id).catch(() => [])]);
			for (const c of [...text, ...voice]) channels.set(c.id, c.name);
		}
		const guildName = (id) => core.network.find(id)?.name ?? id;
		return {
			...data,
			activity: {
				...data.activity,
				byGuild: data.activity.byGuild.map(g => ({ ...g, guildName: guildName(g.guildId) })),
				topChannels: data.activity.topChannels.map(c => ({ ...c, name: channels.get(c.channelId) ?? null, guildName: guildName(c.guildId) })),
			},
			invites: { ...data.invites, invitedBy: data.invites.invitedBy.map(i => ({ ...i, guildName: guildName(i.guildId), inviter: people.get(i.inviterId) ?? null })) },
			tickets: { ...data.tickets, last: data.tickets.last.map(t => ({ ...t, guildName: guildName(t.guildId) })) },
			names: data.names.map(n => ({ ...n, guildName: guildName(n.guildId) })),
			timeline: data.timeline.map(e => ({ ...e, guildName: guildName(e.guildId), actor: e.actorId ? people.get(e.actorId) ?? null : null })),
		};
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

	app.post('/api/staff-roles/link-by-name', { config: { permission: 'ranks.manage' } }, async (request) => {
		return core.roleImport.linkByName(request.actor);
	});

	app.get('/api/ranks/import', { config: { permission: 'ranks.view' } }, async () => core.roleImport.candidates());

	app.post('/api/ranks/import', {
		config: { permission: 'ranks.manage' },
		schema: { body: { type: 'object', required: ['roleIds'], properties: { roleIds: { type: 'array', items: snowflake, minItems: 1, maxItems: 100 } } } },
	}, async (request) => core.roleImport.importMainRoles(request.actor, request.body.roleIds));

	app.post('/api/staff-roles/sync', { config: { permission: 'ranks.manage' } }, async () => staffSync.syncAll());
}
