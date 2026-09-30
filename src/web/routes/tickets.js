import { NotFoundError } from '../../core/errors.js';
import { resolveNames, snowflake } from './helpers.js';

const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };
const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

export function registerTicketRoutes(app, { core }) {
	const { tickets, executor, network, ranks } = core;

	async function withNames(list) {
		const names = await resolveNames(executor, list.flatMap(t => [t.openerId, t.claimedBy, t.closedBy]));
		const guilds = new Map(network.list().map(g => [g.id, g.name]));
		return list.map(t => ({
			...t,
			guildName: guilds.get(t.guildId) ?? t.guildId,
			opener: names.get(t.openerId) ?? { name: t.openerName, avatar: null },
			claimer: t.claimedBy ? names.get(t.claimedBy) ?? null : null,
		}));
	}

	app.get('/api/tickets', {
		config: { permission: 'tickets.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					guildId: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed'] }, openerId: { type: 'string' },
					before: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 200 },
				},
			},
		},
	}, async (request) => withNames(tickets.list(request.query)));

	app.get('/api/tickets/:id', { config: { permission: 'tickets.view' }, schema: { params: idParam } }, async (request) => {
		return (await withNames([tickets.get(request.params.id, { withTranscript: true })]))[0];
	});

	app.post('/api/tickets/:id/close', {
		config: { permission: 'tickets.handle', confirm: true },
		schema: { params: idParam, body: { type: 'object', properties: { reason: { type: 'string', maxLength: 200 }, confirm: { type: 'boolean' } } } },
	}, async (request) => tickets.close(request.actor.id, request.params.id, request.body?.reason ?? '', 'panel'));

	// --- Configuration of a server ------------------------------------------------------------
	app.get('/api/tickets/config/:guildId', { config: { permission: 'tickets.view' }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		const [channels, categoryChannels, roles] = await Promise.all([
			executor.listTextChannels(guildId),
			executor.listCategoryChannels(guildId),
			executor.listRoles(guildId),
		]);
		return {
			...tickets.describe(guildId),
			channels,
			categoryChannels,
			roles,
			ranks: ranks.list().map(({ id, name, level, color }) => ({ id, name, level, color })),
		};
	});

	app.put('/api/tickets/config/:guildId/settings', {
		config: { permission: 'tickets.manage' },
		schema: {
			params: guildParam,
			body: {
				type: 'object',
				properties: {
					panelChannelId: { anyOf: [snowflake, { type: 'null' }] },
					panelTitle: { type: 'string', maxLength: 100 },
					panelText: { type: 'string', maxLength: 1000 },
					maxOpen: { type: 'integer' },
				},
				additionalProperties: false,
			},
		},
	}, async (request) => tickets.saveSettings(request.actor, request.params.guildId, request.body));

	app.put('/api/tickets/config/:guildId/categories', {
		config: { permission: 'tickets.manage' },
		schema: {
			params: guildParam,
			body: {
				type: 'object',
				required: ['name'],
				properties: {
					id: { type: 'integer' },
					name: { type: 'string', maxLength: 50 },
					emoji: { type: ['string', 'null'], maxLength: 64 },
					description: { type: ['string', 'null'], maxLength: 100 },
					parentChannelId: { anyOf: [snowflake, { type: 'null' }] },
					rankIds: { type: 'array', items: { type: 'integer' }, maxItems: 50 },
					roleIds: { type: 'array', items: snowflake, maxItems: 50 },
					position: { type: 'integer' },
				},
				additionalProperties: false,
			},
		},
	}, async (request) => tickets.saveCategory(request.actor, request.params.guildId, request.body));

	app.delete('/api/tickets/config/:guildId/categories/:id', {
		config: { permission: 'tickets.manage', confirm: true },
		schema: { params: { type: 'object', properties: { guildId: snowflake, id: { type: 'integer' } }, required: ['guildId', 'id'] } },
	}, async (request) => {
		tickets.deleteCategory(request.actor, request.params.guildId, request.params.id);
		return { ok: true };
	});

	app.post('/api/tickets/config/:guildId/publish', { config: { permission: 'tickets.manage' }, schema: { params: guildParam } }, async (request) => {
		return tickets.publishPanel(request.actor, request.params.guildId);
	});
}
