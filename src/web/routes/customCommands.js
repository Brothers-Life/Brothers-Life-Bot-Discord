import { resolveNames } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

// Custom commands built in the panel
export function registerCustomCommandRoutes(app, { core }) {
	const { customCommands, network, executor, ranks } = core;

	app.get('/api/custom-commands', { config: { permission: 'customcommands.view' } }, async () => {
		const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
		return {
			commands: customCommands.list(),
			// Roles, channels and ranks to pick in conditions, actions and access rules
			guilds: await Promise.all(guilds.map(async g => ({
				id: g.id, name: g.name,
				roles: (await executor.listRoles(g.id)).filter(r => r.id !== g.id).map(({ id, name, color, editable }) => ({ id, name, color, editable })),
				channels: await executor.listTextChannels(g.id),
			}))),
			ranks: ranks.list().map(({ id, name, level, color }) => ({ id, name, level, color })),
			counters: customCommands.counters(),
		};
	});
	app.get('/api/custom-commands/:id/runs', { config: { permission: 'customcommands.view' }, schema: { params: idParam } }, async (request) => {
		const runs = customCommands.runs(request.params.id, 100);
		const names = await resolveNames(executor, runs.map(r => r.userId));
		return runs.map(r => ({ ...r, user: names.get(r.userId) ?? null, guildName: network.find(r.guildId)?.name ?? null }));
	});
	app.post('/api/custom-commands', { config: { permission: 'customcommands.manage' }, schema: { body: { type: 'object' } } }, async (request, reply) => {
		reply.code(201);
		return customCommands.save(request.actor, { ...request.body, id: undefined });
	});
	app.put('/api/custom-commands/:id', { config: { permission: 'customcommands.manage' }, schema: { params: idParam, body: { type: 'object' } } }, async (request) => {
		return customCommands.save(request.actor, { ...request.body, id: request.params.id });
	});
	app.post('/api/custom-commands/:id/enabled', {
		config: { permission: 'customcommands.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } } },
	}, async (request) => customCommands.setEnabled(request.actor, request.params.id, request.body.enabled));
	app.delete('/api/custom-commands/:id', { config: { permission: 'customcommands.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		customCommands.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
