import { resolveNames } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] };

export function registerAntinukeRoutes(app, { core }) {
	const { antinuke, executor, network, ranks } = core;

	app.get('/api/antinuke', { config: { permission: 'antinuke.view' } }, async () => {
		const config = antinuke.get();
		const incidents = antinuke.incidents(50);
		const live = antinuke.live();
		const people = await resolveNames(executor, [...config.whitelistUserIds, ...incidents.flatMap(i => [i.userId, i.resolvedBy]), ...live.map(l => l.userId)]);
		const roleNames = new Map();
		for (const guildId of new Set(incidents.flatMap(i => [...Object.keys(i.removedRoles), ...i.failures.map(f => f.guildId)]))) {
			for (const role of await executor.listRoles(guildId)) roleNames.set(`${guildId}:${role.id}`, { name: role.name, color: role.color });
		}
		return {
			config,
			actions: Object.entries(antinuke.actions).map(([key, a]) => ({ key, label: a.label, limit: a.limit, windowSeconds: a.windowSeconds })),
			ranks: ranks.list().map(({ id, name, color, level }) => ({ id, name, color, level })),
			guilds: network.list().filter(g => g.status === 'active').map(({ id, name, icon }) => ({ id, name, icon })),
			people: Object.fromEntries(people),
			live,
			incidents: incidents.map(i => ({
				...i,
				removedRoles: Object.entries(i.removedRoles).map(([guildId, roleIds]) => ({
					guildId,
					roles: roleIds.map(id => ({ id, name: roleNames.get(`${guildId}:${id}`)?.name ?? id, color: roleNames.get(`${guildId}:${id}`)?.color ?? null })),
				})),
			})),
		};
	});

	app.put('/api/antinuke', {
		config: { permission: 'antinuke.manage' },
		schema: { body: { type: 'object' } },
	}, async (request) => antinuke.save(request.actor, request.body));

	app.post('/api/antinuke/incidents/:id/restore', {
		config: { permission: 'antinuke.manage', confirm: true },
		schema: { params: idParam, body: { type: 'object', properties: { confirm: { type: 'boolean' } } } },
	}, async (request) => antinuke.restore(request.actor, request.params.id));

	app.post('/api/antinuke/incidents/:id/dismiss', {
		config: { permission: 'antinuke.manage' },
		schema: { params: idParam },
	}, async (request) => antinuke.dismiss(request.actor, request.params.id));
}
