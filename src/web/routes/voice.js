import { NotFoundError } from '../../core/errors.js';
import { ROOM_OPTIONS } from '../../core/voiceRooms.js';
import { resolveNames, snowflake } from './helpers.js';

const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };
const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

export function registerVoiceRoutes(app, { core }) {
	const { voiceRooms, executor, network } = core;

	app.get('/api/voice/:guildId', { config: { permission: 'voice.view' }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		const rooms = voiceRooms.rooms(guildId);
		const [voiceChannels, categories, roles, names] = await Promise.all([
			executor.listVoiceChannels(guildId), executor.listCategoryChannels(guildId), executor.listRoles(guildId), resolveNames(executor, rooms.map(r => r.ownerId)),
		]);
		const withMembers = await Promise.all(rooms.map(async r => ({
			...r,
			owner: names.get(r.ownerId) ?? { name: r.ownerId, avatar: null },
			members: (await executor.voiceChannelMembers(r.channelId).catch(() => null))?.length ?? 0,
		})));
		return { hubs: voiceRooms.hubs(guildId), rooms: withMembers, voiceChannels, categories, roles, options: ROOM_OPTIONS };
	});

	app.post('/api/voice/:guildId/hubs', {
		config: { permission: 'voice.manage' },
		schema: {
			params: guildParam,
			body: {
				type: 'object',
				properties: { channelId: { anyOf: [{ type: 'null' }, snowflake] }, categoryId: { anyOf: [{ type: 'null' }, snowflake] }, name: { type: 'string', maxLength: 100 }, config: { type: 'object' } },
				additionalProperties: false,
			},
		},
	}, async (request, reply) => {
		const hub = await voiceRooms.createHub(request.actor, request.params.guildId, request.body);
		reply.code(201);
		return hub;
	});

	app.put('/api/voice/hubs/:id', { config: { permission: 'voice.manage' }, schema: { params: idParam, body: { type: 'object' } } }, async (request) => {
		return voiceRooms.updateHub(request.actor, request.params.id, request.body);
	});

	app.delete('/api/voice/hubs/:id', {
		config: { permission: 'voice.manage', confirm: true },
		schema: { params: idParam, body: { type: 'object', properties: { confirm: { type: 'boolean' }, deleteChannel: { type: 'boolean' } } } },
	}, async (request) => {
		await voiceRooms.deleteHub(request.actor, request.params.id, { deleteChannel: Boolean(request.body?.deleteChannel) });
		return { ok: true };
	});

	app.delete('/api/voice/rooms/:channelId', {
		config: { permission: 'voice.manage', confirm: true },
		schema: { params: { type: 'object', properties: { channelId: snowflake }, required: ['channelId'] }, body: { type: 'object', properties: { confirm: { type: 'boolean' } } } },
	}, async (request) => {
		await voiceRooms.closeRoom(request.actor, request.params.channelId);
		return { ok: true };
	});
}
