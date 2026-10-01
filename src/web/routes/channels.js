import { snowflake } from './helpers.js';

const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };
const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

// Automatic channels, newcomers verification, embed builder
export function registerChannelRoutes(app, { core }) {
	const { channelFeatures, verification, embedBuilder, network, executor } = core;
	const activeGuilds = () => network.list().filter(g => g.status === 'active' && g.botPresent);

	// --- Automatic channels -------------------------------------------------------------------
	app.get('/api/channel-features', { config: { permission: 'channelfeatures.view' } }, async () => ({
		kinds: channelFeatures.kinds,
		guilds: await Promise.all(activeGuilds().map(async g => ({ id: g.id, name: g.name, icon: g.icon ?? null, channels: await executor.listTextChannels(g.id), features: channelFeatures.list(g.id) }))),
	}));

	app.put('/api/channel-features', {
		config: { permission: 'channelfeatures.manage' },
		schema: { body: { type: 'object', required: ['guildId', 'channelId', 'kind'], properties: { guildId: snowflake, channelId: snowflake, kind: { type: 'string', maxLength: 20 }, config: { type: 'object' } } } },
	}, async (request) => channelFeatures.set(request.actor, request.body));

	app.delete('/api/channel-features/:channelId/:kind', {
		config: { permission: 'channelfeatures.manage' },
		schema: { params: { type: 'object', properties: { channelId: snowflake, kind: { type: 'string', maxLength: 20 } }, required: ['channelId', 'kind'] } },
	}, async (request) => {
		await channelFeatures.remove(request.actor, request.params.channelId, request.params.kind);
		return { ok: true };
	});

	app.post('/api/channel-features/:channelId/count', {
		config: { permission: 'channelfeatures.manage' },
		schema: { params: { type: 'object', properties: { channelId: snowflake }, required: ['channelId'] }, body: { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 0 } } } },
	}, async (request) => channelFeatures.setCount(request.actor, request.params.channelId, request.body.count));

	// --- Verification -------------------------------------------------------------------------
	app.get('/api/verification', { config: { permission: 'verification.view' } }, async () => ({
		guilds: await Promise.all(activeGuilds().map(async g => ({
			id: g.id, name: g.name, icon: g.icon ?? null,
			config: verification.config(g.id),
			pending: verification.pending(g.id),
			channels: await executor.listTextChannels(g.id),
			roles: (await executor.listRoles(g.id)).filter(r => r.id !== g.id).map(({ id, name, color, editable }) => ({ id, name, color, editable })),
		}))),
	}));

	app.put('/api/verification/:guildId', { config: { permission: 'verification.manage' }, schema: { params: guildParam, body: { type: 'object' } } }, async (request) => verification.setConfig(request.actor, request.params.guildId, request.body));
	app.post('/api/verification/:guildId/publish', { config: { permission: 'verification.manage' }, schema: { params: guildParam } }, async (request) => verification.publish(request.actor, request.params.guildId));

	// --- Embed builder ------------------------------------------------------------------------
	app.get('/api/embeds', { config: { permission: 'embeds.view' } }, async () => ({
		messages: embedBuilder.list(),
		guilds: await Promise.all(activeGuilds().map(async g => ({ id: g.id, name: g.name, channels: await executor.listTextChannels(g.id) }))),
	}));

	app.post('/api/embeds', {
		config: { permission: 'embeds.manage' },
		schema: { body: { type: 'object', required: ['payload'], properties: { id: { type: 'integer' }, name: { type: 'string', maxLength: 80 }, payload: { type: 'object' } } } },
	}, async (request) => embedBuilder.save(request.actor, request.body));

	app.post('/api/embeds/:id/post', {
		config: { permission: 'embeds.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['guildId', 'channelId'], properties: { guildId: snowflake, channelId: snowflake } } },
	}, async (request) => embedBuilder.post(request.actor, request.params.id, request.body));

	app.delete('/api/embeds/:id', {
		config: { permission: 'embeds.manage' },
		schema: { params: idParam, querystring: { type: 'object', properties: { keepMessage: { type: 'boolean' } } } },
	}, async (request) => {
		await embedBuilder.remove(request.actor, request.params.id, { deleteMessage: !request.query.keepMessage });
		return { ok: true };
	});
}
