const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const body = {
	type: 'object',
	properties: {
		platform: { type: 'string', enum: ['twitch', 'youtube', 'kick'] },
		channel: { type: 'string', maxLength: 200 },
		displayName: { type: 'string', maxLength: 100 },
		targets: { type: 'array', maxItems: 50 },
		payloads: { type: 'object' },
		config: { type: 'object' },
		enabled: { type: 'boolean' },
	},
};

// Stream and video notifications
export function registerStreamRoutes(app, { core }) {
	const { streams, network, executor } = core;

	app.get('/api/streams', { config: { permission: 'notifications.view' } }, async () => {
		const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
		return {
			subscriptions: streams.list(),
			history: streams.history(100),
			credentials: streams.credentials(),
			// Where to post and whom to ping, as for announcements
			guilds: await Promise.all(guilds.map(async g => ({
				id: g.id, name: g.name, isMain: g.isMain,
				channels: await executor.listTextChannels(g.id),
				roles: (await executor.listRoles(g.id)).map(({ id, name, color }) => ({ id, name, color })),
			}))),
		};
	});
	app.post('/api/streams', { config: { permission: 'notifications.manage' }, schema: { body: { ...body, required: ['platform', 'channel'] } } }, async (request, reply) => {
		reply.code(201);
		return streams.save(request.actor, request.body);
	});
	app.put('/api/streams/:id', { config: { permission: 'notifications.manage' }, schema: { params: idParam, body } }, async (request) => {
		return streams.save(request.actor, { ...request.body, id: request.params.id });
	});
	app.delete('/api/streams/:id', { config: { permission: 'notifications.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await streams.remove(request.actor, request.params.id);
		return { ok: true };
	});
	app.post('/api/streams/:id/test', { config: { permission: 'notifications.manage' }, schema: { params: idParam } }, async (request) => streams.test(request.actor, request.params.id));
	app.put('/api/streams/credentials', {
		config: { permission: 'notifications.manage' },
		schema: { body: { type: 'object', properties: { twitch: { type: ['object', 'null'] }, kick: { type: ['object', 'null'] }, youtubeApiKey: { type: ['string', 'null'], maxLength: 200 } } } },
	}, async (request) => streams.setCredentials(request.actor, request.body));
}
