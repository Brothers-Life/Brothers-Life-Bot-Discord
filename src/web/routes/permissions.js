export function registerPermissionRoutes(app, { core }) {
	const { permissionSync, ranks } = core;
	const rankParam = { type: 'object', properties: { rankId: { type: 'integer' } }, required: ['rankId'] };

	app.get('/api/permissions', { config: { permission: 'permsync.view' } }, async () => ({
		catalogue: permissionSync.catalogue(),
		profiles: permissionSync.profiles(),
		ranks: ranks.list().map(({ id, name, level, color, roles }) => ({ id, name, level, color, linkedRoles: roles.length })),
	}));

	app.get('/api/permissions/preview', { config: { permission: 'permsync.view' } }, async () => permissionSync.preview());

	app.put('/api/permissions/:rankId', {
		config: { permission: 'permsync.manage' },
		schema: { params: rankParam, body: { type: 'object', required: ['permissions'], properties: { permissions: { anyOf: [{ type: 'null' }, { type: 'array', items: { type: 'string' }, maxItems: 60 }] } } } },
	}, async (request) => permissionSync.setProfile(request.actor, request.params.rankId, request.body.permissions));

	app.post('/api/permissions/apply', {
		config: { permission: 'permsync.manage', confirm: true },
		schema: { body: { type: 'object', properties: { rankId: { type: 'integer' }, confirm: { type: 'boolean' } } } },
	}, async (request) => permissionSync.apply(request.actor, request.body?.rankId ?? null));
}
