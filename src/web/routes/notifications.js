import { authenticate } from '../guard.js';

const RECHECK_MS = 30_000;

// Notification center of the panel: list, read state, preferences, live feed
export function registerNotificationRoutes(app, { core }) {
	const { notifications } = core;
	const panelOnly = { permission: null, apiKey: false };

	app.get('/api/notifications', {
		config: panelOnly,
		schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
	}, async request => notifications.list(request.actor, { limit: request.query.limit ?? 50 }));

	app.post('/api/notifications/read', {
		config: panelOnly,
		schema: {
			body: {
				type: 'object',
				properties: { ids: { type: 'array', maxItems: 200, items: { type: 'integer' } }, all: { type: 'boolean' } },
			},
		},
	}, async (request) => {
		if (request.body.all) return notifications.markAllRead(request.actor);
		return notifications.markRead(request.actor, request.body.ids ?? []);
	});

	app.get('/api/notifications/prefs', { config: panelOnly }, async request => notifications.prefs(request.actor));

	app.put('/api/notifications/prefs', {
		config: panelOnly,
		schema: { body: { type: 'object', required: ['disabled'], properties: { disabled: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 41 } } } } },
	}, async request => notifications.setPrefs(request.actor, request.body));

	// New notifications as they happen, already filtered for the person connected
	app.get('/api/notifications/live', { websocket: true, config: panelOnly }, (socket, request) => {
		let actor = request.actor;
		const unsubscribe = notifications.subscribe((notification) => {
			if (socket.readyState !== 1 || !notifications.visibleTo(actor, notification)) return;
			socket.send(JSON.stringify({ type: 'notification', notification: { ...notification, read: false } }));
		});
		// Rank changes and session expiry apply to an open socket too
		const recheck = setInterval(async () => {
			const fresh = await authenticate(request, core).catch(() => null);
			if (!fresh?.can('panel.access')) return socket.close(4003, 'Forbidden');
			actor = fresh;
		}, RECHECK_MS);
		recheck.unref?.();
		socket.on('close', () => {
			clearInterval(recheck);
			unsubscribe();
		});
		socket.on('message', () => undefined);
	});
}
