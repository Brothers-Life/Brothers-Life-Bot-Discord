import { snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

// Server templates: model Discords photographed, then rebuilt (reset) or repaired on other servers
export function registerTemplateRoutes(app, { core }) {
	const { templates, network } = core;

	app.get('/api/templates', { config: { permission: 'templates.view' } }, async () => ({
		templates: templates.list(),
		targets: templates.targets(),
		job: templates.job(),
		// Servers that can serve as a model (not the main one)
		sources: network.list().filter(g => g.status === 'active' && g.botPresent && !g.isMain).map(({ id, name }) => ({ id, name })),
	}));
	app.get('/api/templates/job', { config: { permission: 'templates.view' } }, async () => ({ job: templates.job() }));
	app.get('/api/templates/:id', { config: { permission: 'templates.view' }, schema: { params: idParam } }, async (request) => templates.get(request.params.id));
	app.post('/api/templates', {
		config: { permission: 'templates.manage' },
		schema: { body: { type: 'object', required: ['name', 'sourceGuildId'], properties: { name: { type: 'string', maxLength: 60 }, description: { type: 'string', maxLength: 300 }, sourceGuildId: snowflake } } },
	}, async (request, reply) => {
		reply.code(201);
		return templates.create(request.actor, request.body);
	});
	app.post('/api/templates/:id/capture', { config: { permission: 'templates.manage' }, schema: { params: idParam } }, async (request) => templates.capture(request.actor, request.params.id));
	app.put('/api/templates/:id', {
		config: { permission: 'templates.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 60 }, description: { type: ['string', 'null'], maxLength: 300 } } } },
	}, async (request) => templates.rename(request.actor, request.params.id, request.body));
	app.delete('/api/templates/:id', { config: { permission: 'templates.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		templates.remove(request.actor, request.params.id);
		return { ok: true };
	});
	app.post('/api/templates/:id/apply', {
		config: { permission: 'templates.apply', confirm: true },
		schema: {
			params: idParam,
			body: { type: 'object', required: ['guildId', 'mode'], properties: { guildId: snowflake, mode: { type: 'string', enum: ['reset', 'repair'] }, confirm: { type: 'boolean' }, confirmName: { type: 'string', maxLength: 100 } } },
		},
	}, async (request, reply) => {
		reply.code(202);
		return templates.apply(request.actor, request.params.id, request.body);
	});
}
