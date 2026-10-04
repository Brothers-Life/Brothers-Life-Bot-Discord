import { csvCell, networkTargets, resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const body = {
	type: 'object',
	required: ['prize', 'endsAt'],
	properties: {
		prize: { type: 'string', maxLength: 200 },
		description: { type: 'string', maxLength: 2000 },
		winnersCount: { type: 'integer' },
		settings: { type: 'object' },
		targets: { type: 'array', maxItems: 50 },
		startsAt: { type: ['integer', 'null'] },
		endsAt: { type: 'integer' },
	},
};

export function registerGiveawayRoutes(app, { core }) {
	const { giveaways, executor, network } = core;

	app.get('/api/giveaways', { config: { permission: 'giveaways.view' } }, async () => giveaways.list());
	app.get('/api/giveaways/targets', { config: { permission: 'giveaways.view' } }, async () => networkTargets(core));
	app.get('/api/giveaways/:id', { config: { permission: 'giveaways.view' }, schema: { params: idParam } }, async (request) => {
		const g = giveaways.get(request.params.id);
		const names = await resolveNames(executor, g.winners.map(w => w.userId));
		return { ...g, winners: g.winners.map(w => ({ ...w, user: names.get(w.userId) ?? { name: w.userId, avatar: null } })) };
	});
	app.get('/api/giveaways/:id/participants', { config: { permission: 'giveaways.view' }, schema: { params: idParam } }, async (request) => {
		const list = await giveaways.participants(request.actor, request.params.id);
		const names = await resolveNames(executor, list.map(p => p.userId));
		const guilds = new Map(network.list().map(g => [g.id, g.name]));
		return list.map(p => ({ ...p, user: names.get(p.userId) ?? { name: p.userId, avatar: null }, guildName: guilds.get(p.guildId) ?? p.guildId }));
	});
	app.get('/api/giveaways/:id/export', { config: { permission: 'giveaways.view' }, schema: { params: idParam } }, async (request, reply) => {
		const g = giveaways.get(request.params.id);
		const entries = giveaways.entries(request.params.id);
		const names = await resolveNames(executor, entries.map(e => e.userId));
		const winners = new Set(g.winners.filter(w => w.status === 'winner').map(w => w.userId));
		const rows = [['Membre', 'ID', 'Entrées', 'Inscrit le', 'Gagnant'], ...entries.map(e => [names.get(e.userId)?.name ?? e.userId, e.userId, e.entries, new Date(e.at).toLocaleString('fr-FR'), winners.has(e.userId) ? 'oui' : ''])];
		return reply
			.type('text/csv; charset=utf-8')
			.header('Content-Disposition', `attachment; filename="giveaway-${g.id}.csv"`)
			.send(`${String.fromCharCode(0xfeff)}${rows.map(r => r.map(csvCell).join(';')).join('\n')}\n`);
	});

	const manage = { permission: 'giveaways.manage' };
	app.post('/api/giveaways', { config: manage, schema: { body } }, async (request, reply) => {
		reply.code(201);
		return giveaways.create(request.actor, request.body);
	});
	app.put('/api/giveaways/:id', { config: manage, schema: { params: idParam, body } }, async (request) => giveaways.update(request.actor, request.params.id, request.body));
	app.post('/api/giveaways/:id/publish', { config: manage, schema: { params: idParam } }, async (request) => giveaways.publish(request.actor, request.params.id));
	app.post('/api/giveaways/:id/end', { config: { ...manage, confirm: true }, schema: { params: idParam } }, async (request) => giveaways.end(request.actor, request.params.id));
	app.post('/api/giveaways/:id/cancel', { config: { ...manage, confirm: true }, schema: { params: idParam } }, async (request) => giveaways.cancel(request.actor, request.params.id));
	app.post('/api/giveaways/:id/duplicate', { config: manage, schema: { params: idParam } }, async (request) => giveaways.duplicate(request.actor, request.params.id));
	app.post('/api/giveaways/:id/reroll', {
		config: { ...manage, confirm: true },
		schema: { params: idParam, body: { type: 'object', properties: { userId: { anyOf: [{ type: 'null' }, snowflake] }, count: { type: 'integer' }, confirm: { type: 'boolean' } } } },
	}, async (request) => ({ winners: await giveaways.reroll(request.actor, request.params.id, { userId: request.body.userId ?? null, count: request.body.count ?? 1 }) }));
	app.delete('/api/giveaways/:id', { config: { ...manage, confirm: true }, schema: { params: idParam } }, async (request) => {
		await giveaways.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
