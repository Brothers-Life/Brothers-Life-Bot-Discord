import { snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

// Server backups: list, manual backup, settings, download, restore
export function registerBackupRoutes(app, { core }) {
	const { backups, templates, network } = core;

	app.get('/api/backups', { config: { permission: 'backups.view' } }, async () => ({
		backups: await backups.list(),
		config: await backups.config(),
		job: await templates.job(),
		guilds: (await network.list()).filter(g => g.status === 'active' && g.botPresent).map(({ id, name, icon, isMain }) => ({ id, name, icon: icon ?? null, isMain })),
	}));
	app.get('/api/backups/job', { config: { permission: 'backups.view' } }, async () => ({ job: await templates.job() }));
	app.post('/api/backups', {
		config: { permission: 'backups.manage' },
		schema: { body: { type: 'object', required: ['guildId'], properties: { guildId: snowflake, name: { type: 'string', maxLength: 80 } } } },
	}, async (request, reply) => {
		reply.code(201);
		return await backups.create(request.actor, request.body.guildId, request.body.name ?? '');
	});
	app.put('/api/backups/config', {
		config: { permission: 'backups.manage' },
		schema: { body: { type: 'object', properties: { enabled: { type: 'boolean' }, guildIds: { type: 'array', maxItems: 100 }, hour: { type: 'integer' }, keep: { type: 'integer' } } } },
	}, async (request) => backups.setConfig(request.actor, request.body));
	app.get('/api/backups/:id/download', { config: { permission: 'backups.manage' }, schema: { params: idParam } }, async (request, reply) => {
		const backup = await backups.get(request.params.id);
		const content = await backups.content(request.actor, request.params.id);
		return reply.type('application/json; charset=utf-8')
			.header('Content-Disposition', `attachment; filename="sauvegarde-${backup.guildId}-${backup.id}.json"`)
			.send(JSON.stringify(content, null, 2));
	});
	app.post('/api/backups/:id/restore', {
		config: { permission: 'backups.restore', confirm: true },
		schema: {
			params: idParam,
			body: { type: 'object', properties: { mode: { type: 'string', enum: ['repair', 'restore'] }, panel: { type: 'boolean' }, memberRoles: { type: 'boolean' }, confirm: { type: 'boolean' }, confirmName: { type: 'string', maxLength: 100 } } },
		},
	}, async (request, reply) => {
		reply.code(202);
		return await backups.restore(request.actor, request.params.id, request.body);
	});
	app.delete('/api/backups/:id', { config: { permission: 'backups.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await backups.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
