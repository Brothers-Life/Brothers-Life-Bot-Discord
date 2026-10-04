const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const body = {
	type: 'object',
	properties: {
		kind: { type: 'string', enum: ['rss', 'tiktok'] },
		url: { type: 'string', maxLength: 500 },
		displayName: { type: 'string', maxLength: 100 },
		targets: { type: 'array', maxItems: 50 },
		payload: { type: 'object' },
		config: { type: 'object' },
		enabled: { type: 'boolean' },
	},
};

// RSS / Atom feeds and TikTok (through an RSS bridge), on the "Streams et vidéos" page
export function registerFeedRoutes(app, { core }) {
	const { feeds } = core;

	app.get('/api/feeds', { config: { permission: 'notifications.view' } }, async () => ({
		subscriptions: feeds.list(),
		history: feeds.history(100),
		variables: feeds.variables(),
	}));
	app.post('/api/feeds/preview', {
		config: { permission: 'notifications.manage' },
		schema: { body: { type: 'object', properties: { url: { type: 'string', maxLength: 500 } }, required: ['url'] } },
	}, async (request) => feeds.preview(request.actor, request.body.url));
	app.post('/api/feeds', { config: { permission: 'notifications.manage' }, schema: { body: { ...body, required: ['kind', 'url'] } } }, async (request, reply) => {
		reply.code(201);
		return feeds.save(request.actor, request.body);
	});
	app.put('/api/feeds/:id', { config: { permission: 'notifications.manage' }, schema: { params: idParam, body } }, async (request) => {
		return feeds.save(request.actor, { ...request.body, id: request.params.id });
	});
	app.delete('/api/feeds/:id', { config: { permission: 'notifications.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await feeds.remove(request.actor, request.params.id);
		return { ok: true };
	});
	app.post('/api/feeds/:id/test', { config: { permission: 'notifications.manage' }, schema: { params: idParam } }, async (request) => feeds.test(request.actor, request.params.id));
}
