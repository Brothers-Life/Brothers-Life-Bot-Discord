import crypto from 'node:crypto';
import { listPermissions } from '../../core/permissions.js';
import { NotFoundError, ForbiddenError } from '../../core/errors.js';
import { MIRROR } from '../../core/logRouting.js';
import { listStaff } from '../../core/staffActivity.js';

const SNOWFLAKE = { type: 'string', pattern: '^\\d{17,20}$' };
const idParam = { type: 'object', properties: { id: SNOWFLAKE }, required: ['id'] };
const confirmBody = { type: 'object', properties: { confirm: { type: 'boolean' } } };

// Administrator: the bot moderates, logs, manages staff roles, tickets and role permissions on every server
export const BOT_PERMISSIONS = '8';

// Routes of the socle: identity, overview, network, ranks, panel members, log routing, audit, sessions
export function registerPanelRoutes(app, { core, runtime }) {
	const { network, ranks, logs, audit, sessions, executor } = core;

	// Audit entries only store IDs: add the Discord name of each author for display
	async function withActorNames(entries) {
		const ids = [...new Set(entries.map(e => e.actorId).filter(id => /^\d{17,20}$/.test(id)))];
		const users = new Map(await Promise.all(ids.map(async id => [id, await executor.getUser(id)])));
		return entries.map(e => ({ ...e, actorName: users.get(e.actorId)?.globalName ?? users.get(e.actorId)?.username ?? null }));
	}

	// --- Identity & overview ---------------------------------------------------------------
	app.get('/api/me', { config: { permission: null } }, async (request) => {
		const { actor, session } = request;
		const user = session ? { username: session.username, avatar: session.avatar } : await executor.getUser(actor.id).catch(() => null);
		return {
			user: { id: actor.id, username: user?.username ?? user?.globalName ?? null, avatar: user?.avatar ?? null },
			isOwner: actor.isOwner,
			level: Number.isFinite(actor.level) ? actor.level : null,
			permissions: actor.permissions,
			ranks: actor.ranks,
			sessionExpiresAt: session?.expiresAt ?? null,
			apiKey: actor.apiKey ?? null,
		};
	});

	// Shared template variables, for the « Variables » button of the message editors
	app.get('/api/variables', {
		config: { permission: null },
		schema: { querystring: { type: 'object', properties: { scope: { type: 'string', enum: ['member', 'server'] } } } },
	}, async request => ({ groups: core.variables.catalog(request.query.scope ?? 'member', request.actor) }));

	// Custom emojis of the network servers, for the emoji picker
	app.get('/api/emojis', { config: { permission: null } }, async () => ({
		guilds: await Promise.all(network.list().filter(g => g.status === 'active' && g.botPresent).map(async g => ({
			id: g.id, name: g.name, icon: g.icon ?? null, isMain: g.isMain,
			emojis: await executor.listEmojis(g.id).catch(() => []),
			stickers: await executor.listStickers(g.id).catch(() => []),
		}))),
	}));

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
			recent: request.actor.can('audit.view') ? await withActorNames(audit.query({ limit: 8 })) : null,
		};
	});

	// --- Network -----------------------------------------------------------------------------
	// Every page with a server picker (tickets, suggestions, stats...) reads this list: open to any panel user,
	// the dates of the network history stay behind network.view
	app.get('/api/network', { config: { permission: null } }, async (request) => {
		const full = request.actor.can('network.view');
		return network.list().map((g) => {
			const guild = { ...g, icon: executor.guildIcon(g.id) ?? g.icon };
			if (full) return guild;
			const { id, name, icon, status, isMain, botPresent } = guild;
			return { id, name, icon, status, isMain, botPresent };
		});
	});

	// Invite link with exactly the permissions the bot needs (moderation, logs, staff roles, tickets)
	app.get('/api/network/invite', { config: { permission: 'network.manage' } }, async () => {
		const url = new URL('https://discord.com/oauth2/authorize');
		url.search = new URLSearchParams({
			client_id: core.config.APP_ID,
			permissions: BOT_PERMISSIONS,
			integration_type: '0',
			scope: 'bot applications.commands',
		}).toString();
		return { url: url.toString(), configured: Boolean(core.config.APP_ID) };
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
		if (!network.find(request.params.id)) throw new NotFoundError('Serveur introuvable.');
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
			inherit: { type: 'boolean' },
			syncRoles: { type: 'boolean' },
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

	app.post('/api/ranks/:id/duplicate', {
		config: { permission: 'ranks.manage' },
		schema: { params: rankIdParam, body: { type: 'object', properties: { name: { type: 'string', maxLength: 50 }, level: { type: 'integer', minimum: 0, maximum: 100 } } } },
	}, async (request, reply) => {
		reply.code(201);
		return ranks.duplicate(request.actor, request.params.id, request.body ?? {});
	});

	// The rank's role copied (created if needed) and linked on every other server
	app.post('/api/ranks/:id/copy-role', { config: { permission: 'ranks.manage' }, schema: { params: rankIdParam } }, async (request) => {
		const result = await core.staffSync.copyRoleToNetwork(request.actor, request.params.id);
		core.staffSync.syncAll().catch(() => null);
		return result;
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
	app.get('/api/members', { config: { permission: 'ranks.view' } }, async () => listStaff({ ranks, network, executor }));

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
		if (!user) throw new NotFoundError('Utilisateur Discord inconnu.');
		return user;
	});

	// --- Log routing -------------------------------------------------------------------------
	app.get('/api/logs', { config: { permission: 'logs.manage' } }, async () => {
		const guilds = network.list().filter(g => g.botPresent && g.status !== 'removed');
		return {
			categories: logs.categories(),
			packs: logs.packs(),
			mainGuildId: network.getMainId(),
			guilds: guilds.map(g => ({ id: g.id, name: g.name, isMain: g.isMain, status: g.status, routes: logs.routes(g.id) })),
			mirror: logs.routes(MIRROR),
		};
	});

	app.put('/api/logs/:guildId/:category', {
		config: { permission: 'logs.manage' },
		schema: {
			params: { type: 'object', properties: { guildId: { type: 'string', pattern: '^(\\d{17,20}|\\*)$' }, category: { type: 'string', maxLength: 80 } }, required: ['guildId', 'category'] },
			// channelId "0" turns one type ("category:type") off
			body: { type: 'object', properties: { channelId: { anyOf: [{ type: 'null' }, SNOWFLAKE, { type: 'string', const: '0' }] }, enabled: { type: 'boolean' } }, required: ['channelId'] },
		},
	}, async (request) => {
		const { guildId, category } = request.params;
		return logs.setRoute(request.actor, guildId, category, request.body.channelId, request.body.enabled ?? true);
	});

	// Ready-made layout: private "Logs" category and its channels, readable by the ranks that see logs
	app.post('/api/logs/:guildId/pack', {
		config: { permission: 'logs.manage' },
		schema: {
			params: { type: 'object', properties: { guildId: SNOWFLAKE }, required: ['guildId'] },
			body: { type: 'object', required: ['pack'], properties: { pack: { type: 'string', maxLength: 30 }, categoryName: { type: 'string', maxLength: 100 } } },
		},
	}, async (request) => {
		const { guildId } = request.params;
		const readers = new Set(ranks.list().filter(r => ['logs.manage', 'events.view', 'audit.view'].some(p => r.effectivePermissions.includes(p))).map(r => r.id));
		const staffRoleIds = [...new Set([...core.staffSync.linksOf(guildId)].filter(([rankId]) => readers.has(rankId)).flatMap(([, roleIds]) => roleIds))];
		return logs.applyPack(request.actor, guildId, request.body.pack, { categoryName: request.body.categoryName, staffRoleIds });
	});

	app.post('/api/logs/:guildId/all', {
		config: { permission: 'logs.manage' },
		schema: {
			params: { type: 'object', properties: { guildId: { type: 'string', pattern: '^(\\d{17,20}|\\*)$' } }, required: ['guildId'] },
			body: { type: 'object', required: ['channelId'], properties: { channelId: SNOWFLAKE } },
		},
	}, async (request) => logs.routeAll(request.actor, request.params.guildId, request.body.channelId));

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
		return withActorNames(audit.query(request.query));
	});

	// --- Sessions ----------------------------------------------------------------------------
	app.get('/api/sessions', { config: { permission: null, apiKey: false }, schema: { querystring: { type: 'object', properties: { all: { type: 'boolean' } } } } }, async (request) => {
		const all = request.query.all && request.actor.can('sessions.manage');
		return sessions.list(all ? undefined : request.actor.id).map(s => ({ ...s, id: undefined, key: sessionKey(s.id), current: s.id === request.session.id }));
	});

	app.delete('/api/sessions/:key', { config: { permission: null, apiKey: false } }, async (request) => {
		const target = sessions.list().find(s => sessionKey(s.id) === request.params.key);
		if (!target) throw new NotFoundError('Session introuvable.');
		if (target.discordId !== request.actor.id) {
			if (!request.actor.can('sessions.manage')) throw new ForbiddenError('Permission manquante : sessions.manage');
			const owner = await ranks.resolve(target.discordId);
			if (!request.actor.isOwner && owner.level >= request.actor.level) throw new ForbiddenError('Tu ne peux pas révoquer les sessions de quelqu’un de niveau égal ou supérieur au tien.');
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
