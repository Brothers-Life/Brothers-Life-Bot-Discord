import { NotFoundError } from '../../core/errors.js';
import { snowflake } from './helpers.js';

const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };

export function registerAntiraidRoutes(app, { core }) {
	const { antiraid, executor, network, moderation } = core;

	app.get('/api/antiraid/:guildId', { config: { permission: 'antiraid.view' }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		return {
			config: antiraid.get(guildId),
			state: antiraid.state(guildId),
			lockedDown: moderation.isLockedDown(guildId),
			roles: await executor.listRoles(guildId),
		};
	});

	app.put('/api/antiraid/:guildId', {
		config: { permission: 'antiraid.manage' },
		schema: { params: guildParam, body: { type: 'object' } },
	}, async (request) => antiraid.save(request.actor, request.params.guildId, request.body));

	app.post('/api/antiraid/:guildId/raid', {
		config: { permission: 'antiraid.manage', confirm: true },
		schema: { params: guildParam, body: { type: 'object', required: ['on'], properties: { on: { type: 'boolean' }, confirm: { type: 'boolean' } } } },
	}, async (request) => {
		await antiraid.setRaid(request.actor, request.params.guildId, request.body.on);
		return antiraid.state(request.params.guildId);
	});

	// Locks every text channel of the server (same as /lockdown)
	app.post('/api/antiraid/:guildId/lockdown', {
		config: { permission: 'commands.lockdown', confirm: true },
		schema: { params: guildParam, body: { type: 'object', required: ['on'], properties: { on: { type: 'boolean' }, confirm: { type: 'boolean' } } } },
	}, async (request) => ({ channels: await moderation.lockdown(request.actor, request.params.guildId, request.body.on, 'Depuis le panel') }));
}
