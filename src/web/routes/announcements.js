import { resolveNames } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const body = {
	type: 'object',
	properties: {
		name: { type: 'string', maxLength: 100 },
		payload: { type: 'object' },
		targets: { type: 'array', maxItems: 50 },
	},
};

export function registerAnnouncementRoutes(app, { core }) {
	const { announcements, executor, network } = core;

	async function withNames(list) {
		const names = await resolveNames(executor, list.map(a => a.createdBy));
		return list.map(a => ({ ...a, author: names.get(a.createdBy) ?? null }));
	}

	app.get('/api/announcements', { config: { permission: 'announcements.view' } }, async () => withNames(announcements.list()));

	// Servers of the network with their channels and roles, to pick where to post and whom to ping
	app.get('/api/announcements/targets', { config: { permission: 'announcements.view' } }, async () => {
		const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
		return Promise.all(guilds.map(async g => ({
			id: g.id,
			name: g.name,
			isMain: g.isMain,
			channels: await executor.listTextChannels(g.id),
			roles: (await executor.listRoles(g.id)).map(({ id, name, color }) => ({ id, name, color })),
		})));
	});

	app.get('/api/announcements/:id', { config: { permission: 'announcements.view' }, schema: { params: idParam } }, async (request) => {
		return (await withNames([announcements.get(request.params.id)]))[0];
	});

	app.post('/api/announcements', { config: { permission: 'announcements.manage' }, schema: { body: { ...body, required: ['name', 'payload'] } } }, async (request, reply) => {
		reply.code(201);
		return announcements.create(request.actor, request.body);
	});

	app.put('/api/announcements/:id', { config: { permission: 'announcements.manage' }, schema: { params: idParam, body } }, async (request) => {
		return announcements.update(request.actor, request.params.id, request.body);
	});

	app.post('/api/announcements/:id/send', {
		config: { permission: 'announcements.manage', confirm: true },
		schema: { params: idParam, body: { type: 'object', properties: { confirm: { type: 'boolean' } } } },
	}, async (request) => announcements.send(request.actor, request.params.id));

	app.post('/api/announcements/:id/schedule', {
		config: { permission: 'announcements.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['at'], properties: { at: { type: 'integer' } } } },
	}, async (request) => announcements.schedule(request.actor, request.params.id, request.body.at));

	app.post('/api/announcements/:id/unschedule', { config: { permission: 'announcements.manage' }, schema: { params: idParam } }, async (request) => {
		return announcements.unschedule(request.actor, request.params.id);
	});

	app.post('/api/announcements/:id/duplicate', { config: { permission: 'announcements.manage' }, schema: { params: idParam } }, async (request) => {
		return announcements.duplicate(request.actor, request.params.id);
	});

	app.delete('/api/announcements/:id', {
		config: { permission: 'announcements.manage', confirm: true },
		schema: { params: idParam },
	}, async (request) => ({ announcement: await announcements.remove(request.actor, request.params.id) }));
}
