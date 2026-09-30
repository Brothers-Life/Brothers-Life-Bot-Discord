import { resolveNames } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

// RP events: planning, sign-ups, messages in Discord
export function registerRpEventRoutes(app, { core }) {
	const { rpEvents, network, executor } = core;

	app.get('/api/rp-events', { config: { permission: 'rpevents.view' } }, async () => {
		const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
		return {
			events: rpEvents.list(),
			// Where to announce, whom to ping, which "participant" role to give
			guilds: await Promise.all(guilds.map(async g => ({
				id: g.id, name: g.name, isMain: g.isMain,
				channels: await executor.listTextChannels(g.id),
				roles: (await executor.listRoles(g.id)).filter(r => r.id !== g.id).map(({ id, name, color, editable }) => ({ id, name, color, editable })),
			}))),
		};
	});
	app.get('/api/rp-events/:id/participants', { config: { permission: 'rpevents.view' }, schema: { params: idParam } }, async (request) => {
		const event = rpEvents.get(request.params.id);
		const names = await resolveNames(executor, event.rsvps.map(r => r.userId));
		return event.rsvps.map(r => ({ ...r, user: names.get(r.userId) ?? null }));
	});
	app.post('/api/rp-events', { config: { permission: 'rpevents.manage' }, schema: { body: { type: 'object' } } }, async (request, reply) => {
		reply.code(201);
		return rpEvents.save(request.actor, { ...request.body, id: undefined });
	});
	app.put('/api/rp-events/:id', { config: { permission: 'rpevents.manage' }, schema: { params: idParam, body: { type: 'object' } } }, async (request) => {
		return rpEvents.save(request.actor, { ...request.body, id: request.params.id });
	});
	app.post('/api/rp-events/:id/cancel', {
		config: { permission: 'rpevents.manage', confirm: true },
		schema: { params: idParam, body: { type: 'object', properties: { reason: { type: 'string', maxLength: 300 }, confirm: { type: 'boolean' } } } },
	}, async (request) => rpEvents.cancel(request.actor, request.params.id, request.body.reason ?? ''));
	app.delete('/api/rp-events/:id', { config: { permission: 'rpevents.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await rpEvents.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
