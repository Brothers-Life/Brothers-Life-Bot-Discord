import { sendError } from '../errors.js';

// Requests per minute and per IP on the public endpoint (the content itself is cached 30 s)
export const PUBLIC_RATE_LIMIT = 60;

// Public page: the endpoint anyone can read (when the page is on) and its settings in the panel
export function registerPublicPageRoutes(app, { core }) {
	const { publicPage, fivem, ranks, network } = core;

	app.get('/api/public-page', {
		config: { public: true, rateLimit: { max: PUBLIC_RATE_LIMIT, timeWindow: '1 minute' } },
	}, async (request, reply) => {
		const view = await publicPage.view();
		if (!view) return sendError(reply, 404, 'NOT_FOUND', 'Page introuvable.');
		return view;
	});

	app.get('/api/public-page/config', { config: { permission: 'public.manage' } }, async () => ({
		config: publicPage.config(),
		options: {
			servers: fivem.list().map(s => ({ id: s.id, name: s.name })),
			ranks: ranks.list().map(({ id, name, color, level }) => ({ id, name, color, level })),
			guilds: network.list().filter(g => g.status === 'active' && g.botPresent).map(g => ({ id: g.id, name: g.name, icon: g.icon, isMain: g.isMain })),
			maintenanceAvailable: typeof core.fivemEvents?.publicState === 'function',
		},
	}));

	app.put('/api/public-page/config', {
		config: { permission: 'public.manage' },
		schema: { body: { type: 'object' } },
	}, async request => publicPage.save(request.actor, request.body));
}
