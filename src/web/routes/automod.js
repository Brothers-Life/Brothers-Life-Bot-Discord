import { NETWORK } from '../../core/automod/index.js';
import { NotFoundError } from '../../core/errors.js';

const target = { type: 'object', properties: { guildId: { type: 'string', pattern: '^(\\d{17,20}|\\*)$' } }, required: ['guildId'] };

export function registerAutomodRoutes(app, { core }) {
	const { automod, executor, network } = core;

	app.get('/api/automod', { config: { permission: 'automod.view' } }, async () => ({
		...automod.describe(),
		defaults: automod.defaults(),
	}));

	// Channels and roles of a server, for the exemptions
	app.get('/api/automod/:guildId/options', { config: { permission: 'automod.view' }, schema: { params: target } }, async (request) => {
		const { guildId } = request.params;
		if (guildId === NETWORK) return { channels: [], roles: [] };
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		const [channels, roles] = await Promise.all([executor.listTextChannels(guildId), executor.listRoles(guildId)]);
		return { channels, roles };
	});

	app.put('/api/automod/:guildId', {
		config: { permission: 'automod.manage' },
		schema: { params: target, body: { type: 'object' } },
	}, async (request) => automod.setConfig(request.actor, request.params.guildId, request.body));

	app.delete('/api/automod/:guildId', { config: { permission: 'automod.manage' }, schema: { params: target } }, async (request) => {
		automod.resetGuild(request.actor, request.params.guildId);
		return { ok: true };
	});
}
