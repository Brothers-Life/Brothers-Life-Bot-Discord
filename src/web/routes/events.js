import { resolveNames } from './helpers.js';

export function registerEventRoutes(app, { core }) {
	const { events, executor, network } = core;

	app.get('/api/events', {
		config: { permission: 'events.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					guildId: { type: 'string' },
					category: { type: 'string' },
					userId: { type: 'string' },
					q: { type: 'string', maxLength: 100 },
					from: { type: 'integer' },
					to: { type: 'integer' },
					before: { type: 'integer' },
					limit: { type: 'integer', minimum: 1, maximum: 200 },
				},
			},
		},
	}, async (request) => {
		const list = events.query(request.query);
		const names = await resolveNames(executor, list.flatMap(e => [e.userId, e.actorId]));
		const guilds = new Map(network.list().map(g => [g.id, g.name]));
		return list.map(e => ({
			...e,
			guildName: guilds.get(e.guildId) ?? e.guildId,
			user: e.userId ? names.get(e.userId) ?? null : null,
			actor: e.actorId ? names.get(e.actorId) ?? null : null,
		}));
	});

	app.get('/api/events/settings', { config: { permission: 'events.view' } }, async () => ({
		retentionDays: events.retentionDays(),
		categories: events.categories(),
	}));

	app.put('/api/events/settings', {
		config: { permission: 'logs.manage' },
		schema: { body: { type: 'object', required: ['retentionDays'], properties: { retentionDays: { type: 'integer' } } } },
	}, async (request) => {
		events.setRetention(request.actor, request.body.retentionDays);
		return { retentionDays: events.retentionDays() };
	});
}
