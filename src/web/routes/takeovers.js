import { NotFoundError } from '../../core/errors.js';
import { resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };
const groupParams = { type: 'object', properties: { guildId: snowflake, id: { type: 'integer' } }, required: ['guildId', 'id'] };
const orderBody = {
	type: 'object',
	required: ['category', 'groups'],
	properties: {
		category: { type: 'string' },
		groups: {
			type: 'array',
			maxItems: 50,
			items: {
				type: 'object',
				required: ['id', 'items'],
				properties: {
					id: { anyOf: [{ type: 'null' }, { type: 'integer' }] },
					items: { type: 'array', maxItems: 500, items: { type: 'integer' } },
				},
			},
		},
	},
};

// Takeovers of businesses and illegal groups
export function registerTakeoverRoutes(app, { core }) {
	const { takeovers, executor, network } = core;
	const linkableGuilds = async guildId => Promise.all((await network.list())
		.filter(g => g.status === 'active' && g.botPresent && g.id !== guildId)
		.map(async g => ({ id: g.id, name: g.name, icon: g.icon ?? null, channels: await executor.listTextChannels(g.id) })));

	app.get('/api/takeovers/:guildId', { config: { permission: 'takeovers.view' }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		if (!await network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		const [overview, channels, linkable] = await Promise.all([
			takeovers.overview(request.actor, guildId), executor.listTextChannels(guildId), request.actor.can('takeovers.manage') ? linkableGuilds(guildId) : [],
		]);
		const names = await resolveNames(executor, overview.takeovers.flatMap(t => t.entries.map(e => e.userId)));
		return {
			...overview,
			takeovers: overview.takeovers.map(t => ({ ...t, entries: t.entries.map(e => ({ ...e, name: names.get(e.userId)?.name ?? e.userName ?? e.userId, avatar: names.get(e.userId)?.avatar ?? null })) })),
			channels,
			linkable,
		};
	});
	app.put('/api/takeovers/:guildId/config', { config: { permission: 'takeovers.manage' }, schema: { params: guildParam, body: { type: 'object' } } }, async (request) => {
		return await takeovers.saveConfig(request.actor, request.params.guildId, request.body);
	});
	app.post('/api/takeovers/:guildId/panel', {
		config: { permission: 'takeovers.manage' },
		schema: { params: guildParam, body: { type: 'object', required: ['category'], properties: { category: { type: 'string' } } } },
	}, async (request) => ({ messageId: await takeovers.publishPanel(request.actor, request.params.guildId, request.body.category) }));
	app.put('/api/takeovers/:guildId/items', { config: { permission: 'takeovers.manage' }, schema: { params: guildParam, body: { type: 'object' } } }, async (request) => {
		return await takeovers.save(request.actor, request.params.guildId, request.body);
	});
	app.put('/api/takeovers/:guildId/groups', { config: { permission: 'takeovers.manage' }, schema: { params: guildParam, body: { type: 'object' } } }, async (request) => {
		return await takeovers.saveGroup(request.actor, request.params.guildId, request.body);
	});
	app.delete('/api/takeovers/:guildId/groups/:id', { config: { permission: 'takeovers.manage', confirm: true }, schema: { params: groupParams } }, async (request) => {
		await takeovers.removeGroup(request.actor, request.params.id, request.params.guildId);
		return { ok: true };
	});
	app.put('/api/takeovers/:guildId/order', { config: { permission: 'takeovers.manage' }, schema: { params: guildParam, body: orderBody } }, async (request) => {
		await takeovers.reorder(request.actor, request.params.guildId, request.body.category, request.body.groups);
		return { ok: true };
	});
	app.post('/api/takeovers/items/:id/open', {
		config: { permission: 'takeovers.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['open'], properties: { open: { type: 'boolean' } } } },
	}, async (request) => takeovers.setOpen(request.actor, request.params.id, request.body.open));
	app.post('/api/takeovers/items/:id/convoke', { config: { permission: 'takeovers.manage' }, schema: { params: idParam } }, async (request) => takeovers.convoke(request.actor, request.params.id));
	app.post('/api/takeovers/items/:id/finish', {
		config: { permission: 'takeovers.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['userId'], properties: { userId: snowflake } } },
	}, async (request) => takeovers.finish(request.actor, request.params.id, request.body.userId));
	app.delete('/api/takeovers/items/:id', { config: { permission: 'takeovers.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await takeovers.remove(request.actor, request.params.id);
		return { ok: true };
	});
	app.delete('/api/takeovers/entries/:id', { config: { permission: 'takeovers.manage' }, schema: { params: idParam } }, async (request) => {
		await takeovers.removeEntry(request.actor, request.params.id);
		return { ok: true };
	});
}
