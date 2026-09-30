import crypto from 'node:crypto';
import { listPermissions } from '../../core/permissions.js';
import { NotFoundError, ForbiddenError } from '../../core/errors.js';
import { MIRROR } from '../../core/logRouting.js';

const SNOWFLAKE = { type: 'string', pattern: '^\\d{17,20}$' };
const idParam = { type: 'object', properties: { id: SNOWFLAKE }, required: ['id'] };
const confirmBody = { type: 'object', properties: { confirm: { type: 'boolean' } } };

// Routes of the socle: identity, overview, network, ranks, panel members, log routing, audit, sessions
export function registerPanelRoutes(app, { core, runtime }) {
	const { network, ranks, logs, audit, sessions, executor } = core;

	// --- Identity & overview ---------------------------------------------------------------
	app.get('/api/me', { config: { permission: null } }, async (request) => {
		const { actor, session } = request;
		return {
			user: { id: actor.id, username: session.username, avatar: session.avatar },
			isOwner: actor.isOwner,
			level: Number.isFinite(actor.level) ? actor.level : null,
			permissions: actor.permissions,
			ranks: actor.ranks,
			sessionExpiresAt: session.expiresAt,
		};
	});

	app.get('/api/overview', { config: { permission: null } }, async (request) => {
		const guilds = network.list();
		return {
			bot: executor.status(),
			app: runtime.info(),
			network: {
				main: network.getMain(),
				active: guilds.filter(g => g.status === 'active').length,
				pending: guilds.filter(g => g.status === 'pending' && g.botPresent).length,
				removed: guilds.filter(g => g.status === 'removed').length,
			},
			ranks: ranks.list().length,
			recent: request.actor.can('audit.view') ? audit.query({ limit: 8 }) : null,
		};
	});

	// --- Network -----------------------------------------------------------------------------
	app.get('/api/network', { config: { permission: 'network.view' } }, async () => {
		return network.list().map(g => ({ ...g, icon: executor.guildIcon(g.id) ?? g.icon }));
	});

	app.post('/api/network/:id/activate', { config: { permission: 'network.manage' }, schema: { params: idParam } }, async (request) => {
		return network.activate(request.actor, request.params.id);
	});

	app.post('/api/network/:id/remove', { config: { permission: 'network.manage', confirm: true }, schema: { params: idParam, body: confirmBody } }, async (request) => {
		return network.remove(request.actor, request.params.id);
	});

	app.post('/api/network/:id/main', { config: { permission: 'network.manage', confirm: true }, schema: { params: idParam, body: confirmBody } }, async (request) => {
		return network.setMain(request.actor, request.params.id);
	});

	app.get('/api/network/:id/channels', { config: { permission: 'logs.manage' }, schema: { params: idParam } }, async (request) => {
		if (!network.find(request.params.id)) throw new NotFoundError('Server not found.');
		return executor.listTextChannels(request.params.id);
	});

	// --- Ranks -------------------------------------------------------------------------------
	const rankBody = {
		type: 'object',
		properties: {
			name: { type: 'string', minLength: 1, maxLength: 50 },
			level: { type: 'integer', minimum: 0, maximum: 100 },
			color: { type: ['string', 'null'] },
			permissions: { type: 'array', items: { type: 'string' }, maxItems: 200 },
		},
		additionalProperties: false,
	};
	const rankIdParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

	app.get('/api/ranks', { config: { permission: 'ranks.view' } }, async () => {
		const mainId = network.getMainId();
		return {
			ranks: ranks.list(),
			permissions: listPermissions(),
			mainGuildId: mainId,
			roles: mainId ? await executor.listRoles(mainId) : [],
		};
	});

	app.post('/api/ranks', { config: { permission: 'ranks.manage' }, schema: { body: { ...rankBody, required: ['name', 'level'] } } }, async (request, reply) => {
		reply.code(201);
		return ranks.create(request.actor, request.body);
	});

	app.patch('/api/ranks/:id', { config: { permission: 'ranks.manage' }, schema: { params: rankIdParam, body: rankBody } }, async (request) => {
		return ranks.update(request.actor, request.params.id, request.body);
	});

	app.delete('/api/ranks/:id', { config: { permission: 'ranks.manage', confirm: true }, schema: { params: rankIdParam } }, async (request) => {
		ranks.remove(request.actor, request.params.id);
		return { ok: true };
	});

	app.put('/api/ranks/:id/roles', {
		config: { permission: 'ranks.manage' },
		schema: { params: rankIdParam, body: { type: 'object', properties: { roleIds: { type: 'array', items: SNOWFLAKE, maxItems: 50 } }, required: ['roleIds'] } },
	}, async (request) => {
		return ranks.setRoleLinks(request.actor, request.params.id, request.body.roleIds);
	});

	// --- Panel members: who has which rank, and how ------------------------------------------
	app.get('/api/members', { config: { permission: 'ranks.view' } }, async () => {
		const mainId = network.getMainId();
		const allRanks = ranks.list();
		const members = new Map();
		const entry = (id, user) => {
			if (!members.has(id)) members.set(id, { id, username: user?.username ?? null, globalName: user?.globalName ?? null, avatar: user?.avatar ?? null, ranks: [] });
			return members.get(id);
		};

		if (mainId) {
			const links = allRanks.flatMap(r => r.roles.filter(l => l.guildId === mainId).map(l => ({ rank: r, roleId: l.roleId })));
			const withRoles = await executor.listMembersWithAnyRole(mainId, [...new Set(links.map(l => l.roleId))]);
			for (const member of withRoles) {
				for (const link of links.filter(l => member.roleIds.includes(l.roleId))) {
					entry(member.id, member).ranks.push({ id: link.rank.id, name: link.rank.name, level: link.rank.level, color: link.rank.color, via: 'role', roleId: link.roleId });
				}
			}
		}

		for (const assignment of ranks.listDirectAssignments()) {
			const rank = allRanks.find(r => r.id === assignment.rankId);
			if (!rank) continue;
			const member = members.get(assignment.discordId) ?? entry(assignment.discordId, await executor.getUser(assignment.discordId));
			member.ranks.push({ id: rank.id, name: rank.name, level: rank.level, color: rank.color, via: 'direct', addedBy: assignment.addedBy, addedAt: assignment.addedAt });
		}

		return [...members.values()]
			.map(m => ({ ...m, level: Math.max(0, ...m.ranks.map(r => r.level)) }))
			.sort((a, b) => b.level - a.level);
	});

	const memberParams = { type: 'object', properties: { userId: SNOWFLAKE, rankId: { type: 'integer' } }, required: ['userId'] };

	app.post('/api/members/:userId/ranks', {
		config: { permission: 'members.assign' },
		schema: { params: memberParams, body: { type: 'object', properties: { rankId: { type: 'integer' } }, required: ['rankId'] } },
	}, async (request) => {
		await ranks.assignDirect(request.actor, request.params.userId, request.body.rankId);
		return { ok: true };
	});

	app.delete('/api/members/:userId/ranks/:rankId', { config: { permission: 'members.assign' }, schema: { params: memberParams } }, async (request) => {
		await ranks.unassignDirect(request.actor, request.params.userId, request.params.rankId);
		return { ok: true };
	});

	app.get('/api/users/:id', { config: { permission: 'ranks.view' }, schema: { params: idParam } }, async (request) => {
		const user = await executor.getUser(request.params.id);
		if (!user) throw new NotFoundError('Unknown Discord user.');
		return user;
	});

	// --- Log routing -------------------------------------------------------------------------
	app.get('/api/logs', { config: { permission: 'logs.manage' } }, async () => {
		const guilds = network.list().filter(g => g.botPresent && g.status !== 'removed');
		return {
			categories: logs.categories(),
			mainGuildId: network.getMainId(),
			guilds: guilds.map(g => ({ id: g.id, name: g.name, isMain: g.isMain, status: g.status, routes: logs.routes(g.id) })),
			mirror: logs.routes(MIRROR),
		};
	});

	app.put('/api/logs/:guildId/:category', {
		config: { permission: 'logs.manage' },
		schema: {
			params: { type: 'object', properties: { guildId: { type: 'string', pattern: '^(\\d{17,20}|\\*)$' }, category: { type: 'string' } }, required: ['guildId', 'category'] },
			body: { type: 'object', properties: { channelId: { anyOf: [SNOWFLAKE, { type: 'null' }] }, enabled: { type: 'boolean' } }, required: ['channelId'] },
		},
	}, async (request) => {
		const { guildId, category } = request.params;
		return logs.setRoute(request.actor, guildId, category, request.body.channelId, request.body.enabled ?? true);
	});

	// --- Audit -------------------------------------------------------------------------------
	app.get('/api/audit', {
		config: { permission: 'audit.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					actorId: { type: 'string' }, action: { type: 'string' }, guildId: { type: 'string' },
					from: { type: 'integer' }, to: { type: 'integer' }, before: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 200 },
				},
			},
		},
	}, async (request) => {
		return audit.query(request.query);
	});

	// --- Sessions ----------------------------------------------------------------------------
	app.get('/api/sessions', { config: { permission: null }, schema: { querystring: { type: 'object', properties: { all: { type: 'boolean' } } } } }, async (request) => {
		const all = request.query.all && request.actor.can('sessions.manage');
		return sessions.list(all ? undefined : request.actor.id).map(s => ({ ...s, id: undefined, key: sessionKey(s.id), current: s.id === request.session.id }));
	});

	app.delete('/api/sessions/:key', { config: { permission: null } }, async (request) => {
		const target = sessions.list().find(s => sessionKey(s.id) === request.params.key);
		if (!target) throw new NotFoundError('Session not found.');
		if (target.discordId !== request.actor.id) {
			if (!request.actor.can('sessions.manage')) throw new ForbiddenError('Missing permission: sessions.manage');
			const owner = await ranks.resolve(target.discordId);
			if (!request.actor.isOwner && owner.level >= request.actor.level) throw new ForbiddenError('You cannot revoke sessions of someone at or above your level.');
		}
		sessions.revoke(target.id);
		audit.record({ actorId: request.actor.id, source: 'panel', action: 'panel.session_revoked', target: target.discordId, details: { username: target.username } });
		return { ok: true };
	});

}

// Session ids are secrets: the API only exposes a derived key
function sessionKey(id) {
	return crypto.createHash('sha256').update(id).digest('base64url').slice(0, 16);
}
