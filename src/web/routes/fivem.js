import { snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const body = {
	type: 'object',
	properties: {
		name: { type: 'string', maxLength: 60 },
		address: { type: 'string', maxLength: 300 },
		joinCode: { type: ['string', 'null'], maxLength: 100 },
		config: { type: 'object' },
	},
};

// FiveM servers, their status messages and the bot status
export function registerFivemRoutes(app, { core }) {
	const { fivem, network, executor } = core;

	app.get('/api/fivem', { config: { permission: 'fivem.view' } }, async (request) => {
		const manage = request.actor.can('fivem.manage');
		const guilds = manage ? network.list().filter(g => g.status === 'active' && g.botPresent) : [];
		return {
			servers: fivem.list(),
			presence: fivem.presence(),
			guilds: await Promise.all(guilds.map(async g => ({ id: g.id, name: g.name, channels: await executor.listTextChannels(g.id) }))),
		};
	});
	app.post('/api/fivem', { config: { permission: 'fivem.manage' }, schema: { body: { ...body, required: ['name', 'address'] } } }, async (request, reply) => {
		reply.code(201);
		return fivem.save(request.actor, request.body);
	});
	app.put('/api/fivem/presence', {
		config: { permission: 'fivem.manage' },
		schema: { body: { type: 'object', properties: { enabled: { type: 'boolean' }, serverIds: { type: 'array', maxItems: 10 }, text: { type: 'string', maxLength: 120 }, offlineText: { type: 'string', maxLength: 120 } } } },
	}, async (request) => fivem.setPresence(request.actor, request.body));
	app.put('/api/fivem/:id', { config: { permission: 'fivem.manage' }, schema: { params: idParam, body } }, async (request) => fivem.save(request.actor, { ...request.body, id: request.params.id }));
	app.delete('/api/fivem/:id', { config: { permission: 'fivem.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await fivem.remove(request.actor, request.params.id);
		return { ok: true };
	});
	app.post('/api/fivem/:id/messages', {
		config: { permission: 'fivem.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['guildId', 'channelId'], properties: { guildId: snowflake, channelId: snowflake } } },
	}, async (request) => fivem.addStatusMessage(request.actor, request.params.id, request.body.guildId, request.body.channelId));
	app.delete('/api/fivem/messages/:id', { config: { permission: 'fivem.manage' }, schema: { params: idParam } }, async (request) => {
		await fivem.removeStatusMessage(request.actor, request.params.id);
		return { ok: true };
	});
}
