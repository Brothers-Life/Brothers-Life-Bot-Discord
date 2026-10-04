import { csvCell, networkTargets, resolveNames } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const body = {
	type: 'object',
	required: ['question', 'options'],
	properties: {
		question: { type: 'string', maxLength: 250 },
		description: { type: 'string', maxLength: 2000 },
		options: { type: 'array', maxItems: 25 },
		settings: { type: 'object' },
		targets: { type: 'array', maxItems: 50 },
		startsAt: { type: ['integer', 'null'] },
		endsAt: { type: ['integer', 'null'] },
	},
};

export function registerPollRoutes(app, { core }) {
	const { polls, executor, network } = core;

	app.get('/api/polls', { config: { permission: 'polls.view' } }, async () => polls.list());
	app.get('/api/polls/targets', { config: { permission: 'polls.view' } }, async () => networkTargets(core));
	app.get('/api/polls/:id', { config: { permission: 'polls.view' }, schema: { params: idParam } }, async (request) => polls.get(request.params.id));

	app.get('/api/polls/:id/export', { config: { permission: 'polls.view' }, schema: { params: idParam } }, async (request, reply) => {
		const poll = polls.get(request.params.id);
		const votes = polls.allVotes(request.actor, request.params.id);
		const names = await resolveNames(executor, votes.map(v => v.userId).filter(Boolean));
		const guilds = new Map(network.list().map(g => [g.id, g.name]));
		const labels = new Map(poll.options.map(o => [o.id, o.label]));
		const rows = [['Choix', 'Membre', 'Serveur', 'Date'], ...votes.map(v => [labels.get(v.choice), v.userId ? names.get(v.userId)?.name ?? v.userId : '(anonyme)', guilds.get(v.guildId) ?? '', new Date(v.at).toLocaleString('fr-FR')])];
		return reply
			.type('text/csv; charset=utf-8')
			.header('Content-Disposition', `attachment; filename="sondage-${poll.id}.csv"`)
			.send(`${String.fromCharCode(0xfeff)}${rows.map(r => r.map(csvCell).join(';')).join('\n')}\n`);
	});

	app.post('/api/polls', { config: { permission: 'polls.manage' }, schema: { body } }, async (request, reply) => {
		reply.code(201);
		return polls.create(request.actor, request.body);
	});
	app.put('/api/polls/:id', { config: { permission: 'polls.manage' }, schema: { params: idParam, body } }, async (request) => polls.update(request.actor, request.params.id, request.body));
	app.post('/api/polls/:id/publish', { config: { permission: 'polls.manage' }, schema: { params: idParam } }, async (request) => polls.publish(request.actor, request.params.id));
	app.post('/api/polls/:id/close', { config: { permission: 'polls.manage', confirm: true }, schema: { params: idParam } }, async (request) => polls.close(request.actor, request.params.id));
	app.post('/api/polls/:id/duplicate', { config: { permission: 'polls.manage' }, schema: { params: idParam } }, async (request) => polls.duplicate(request.actor, request.params.id));
	app.delete('/api/polls/:id', { config: { permission: 'polls.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await polls.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
