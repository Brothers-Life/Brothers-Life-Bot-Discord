import { networkTargets, snowflake } from './helpers.js';
import { DEFAULT_BOARD_PAYLOAD, DEFAULT_CATEGORY_HEADER, DEFAULT_LINE } from '../../core/serverLinks.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };
const serverBody = {
	type: 'object',
	properties: {
		listed: { type: 'boolean' },
		label: { type: 'string', maxLength: 80 },
		description: { type: 'string', maxLength: 300 },
		emoji: { type: 'string', maxLength: 64 },
		categoryId: { anyOf: [{ type: 'null' }, { type: 'integer' }] },
		inviteMode: { type: 'string', enum: ['auto', 'manual'] },
		inviteChannelId: { anyOf: [{ type: 'null' }, snowflake] },
		inviteUrl: { type: 'string', maxLength: 200 },
	},
};
const boardProperties = {
	name: { type: 'string', maxLength: 100 },
	guildId: snowflake,
	channelId: snowflake,
	enabled: { type: 'boolean' },
	payload: { type: 'object' },
	line: { type: 'string', maxLength: 400 },
	compact: { type: 'boolean' },
	layout: { type: 'string', enum: ['list', 'cards', 'categories'] },
	logos: { type: 'boolean' },
	categoryImage: { type: 'string', enum: ['tiles', 'slices', 'rows', 'picture', 'none'] },
	serverImage: { type: 'string', enum: ['thumbnail', 'banner', 'none'] },
	imageColumns: { type: 'integer', minimum: 2, maximum: 6 },
	imageNames: { type: 'boolean' },
	imageStats: { type: 'boolean' },
	categoryIds: { type: 'array', maxItems: 25, items: { type: 'integer' } },
	groupByCategory: { type: 'boolean' },
	categoryHeader: { type: 'string', maxLength: 200 },
	scope: { type: 'string', enum: ['all', 'selected'] },
	guildIds: { type: 'array', maxItems: 50, items: snowflake },
	includeSelf: { type: 'boolean' },
	buttons: { type: 'boolean' },
	repost: { type: 'boolean' },
};
const categoryBody = {
	type: 'object',
	required: ['name'],
	properties: {
		name: { type: 'string', maxLength: 60 },
		emoji: { type: 'string', maxLength: 64 },
		color: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 7 }] },
		imageUrl: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 500 }] },
	},
};
const boardBody = { type: 'object', required: ['name', 'guildId', 'channelId'], properties: boardProperties };

// Links between the servers of the network: invitations of each server and the messages listing them
export function registerServerLinkRoutes(app, { core }) {
	const { serverLinks } = core;

	app.get('/api/server-links', { config: { permission: 'serverlinks.view' } }, async () => ({
		servers: await serverLinks.servers(),
		boards: await serverLinks.boards(),
		targets: await networkTargets(core),
		categories: await serverLinks.categories(),
		defaults: { line: DEFAULT_LINE, payload: DEFAULT_BOARD_PAYLOAD, categoryHeader: DEFAULT_CATEGORY_HEADER },
	}));
	app.post('/api/server-links/categories', { config: { permission: 'serverlinks.manage' }, schema: { body: categoryBody } }, async (request, reply) => {
		reply.code(201);
		return await serverLinks.createCategory(request.actor, request.body);
	});
	app.put('/api/server-links/categories/order', { config: { permission: 'serverlinks.manage' }, schema: { body: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', maxItems: 25, items: { type: 'integer' } } } } } }, async (request) => {
		return await serverLinks.reorderCategories(request.actor, request.body.ids);
	});
	app.put('/api/server-links/categories/:id', { config: { permission: 'serverlinks.manage' }, schema: { params: idParam, body: categoryBody } }, async (request) => {
		return await serverLinks.updateCategory(request.actor, request.params.id, request.body);
	});
	app.delete('/api/server-links/categories/:id', { config: { permission: 'serverlinks.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await serverLinks.removeCategory(request.actor, request.params.id);
		return { ok: true };
	});
	app.put('/api/server-links/servers/:guildId', { config: { permission: 'serverlinks.manage' }, schema: { params: guildParam, body: serverBody } }, async (request) => {
		return await serverLinks.saveServer(request.actor, request.params.guildId, request.body);
	});
	app.post('/api/server-links/servers/:guildId/invite', { config: { permission: 'serverlinks.manage' }, schema: { params: guildParam } }, async (request) => {
		return await serverLinks.renewInvite(request.actor, request.params.guildId);
	});
	app.put('/api/server-links/order', { config: { permission: 'serverlinks.manage' }, schema: { body: { type: 'object', required: ['guildIds'], properties: { guildIds: { type: 'array', maxItems: 100, items: snowflake } } } } }, async (request) => {
		return await serverLinks.reorder(request.actor, request.body.guildIds);
	});
	const layoutBody = {
		type: 'object',
		required: ['groups'],
		properties: {
			groups: {
				type: 'array',
				maxItems: 30,
				items: { type: 'object', required: ['items'], properties: { id: { anyOf: [{ type: 'null' }, { type: 'integer' }] }, items: { type: 'array', maxItems: 200, items: snowflake } } },
			},
		},
	};
	app.put('/api/server-links/layout', { config: { permission: 'serverlinks.manage' }, schema: { body: layoutBody } }, async (request) => {
		return await serverLinks.arrange(request.actor, request.body.groups);
	});
	const imageBody = {
		type: 'object',
		required: ['tiles'],
		properties: {
			tiles: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object' } },
			options: { type: 'object' },
		},
	};
	// A drawn image of the preview, as a data URL the panel shows as is
	app.post('/api/server-links/image', { config: { permission: 'serverlinks.manage' }, schema: { body: imageBody } }, async (request) => {
		const buffer = await serverLinks.image(request.actor, request.body.tiles, request.body.options ?? {});
		return { image: `data:image/png;base64,${Buffer.from(buffer).toString('base64')}` };
	});
	app.post('/api/server-links/preview', { config: { permission: 'serverlinks.manage' }, schema: { body: { type: 'object', required: ['guildId'], properties: boardProperties } } }, async (request) => {
		return await serverLinks.preview(request.actor, request.body);
	});
	app.post('/api/server-links/boards', { config: { permission: 'serverlinks.manage' }, schema: { body: boardBody } }, async (request, reply) => {
		reply.code(201);
		return await serverLinks.create(request.actor, request.body);
	});
	app.put('/api/server-links/boards/:id', { config: { permission: 'serverlinks.manage' }, schema: { params: idParam, body: boardBody } }, async (request) => {
		return await serverLinks.update(request.actor, request.params.id, request.body);
	});
	app.post('/api/server-links/boards/:id/publish', { config: { permission: 'serverlinks.manage' }, schema: { params: idParam } }, async (request) => {
		return await serverLinks.publish(request.actor, request.params.id);
	});
	app.delete('/api/server-links/boards/:id', { config: { permission: 'serverlinks.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await serverLinks.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
