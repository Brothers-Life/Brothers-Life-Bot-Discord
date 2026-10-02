import { NotFoundError } from '../../core/errors.js';
import { resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };

function csvCell(value) {
	const text = value === null || value === undefined ? '' : String(value);
	return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function registerFeedbackRoutes(app, { core }) {
	const { feedback, executor, network } = core;

	async function withNames(items) {
		const names = await resolveNames(executor, items.flatMap(i => [i.authorId, i.assigneeId]));
		return items.map(i => ({ ...i, author: i.anonymous ? null : names.get(i.authorId) ?? { name: i.authorName, avatar: null }, assignee: i.assigneeId ? names.get(i.assigneeId) ?? null : null }));
	}

	// Boxes the panel user may see, with the channels and roles of the server
	app.get('/api/feedback/:guildId', { config: { permission: null }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		const boxes = feedback.boxes(guildId).filter(b => (b.kind === 'staff' ? request.actor.can('feedback.staff') : request.actor.can('feedback.view')));
		const [channels, roles] = await Promise.all([executor.listTextChannels(guildId), executor.listRoles(guildId)]);
		return { boxes, channels, roles, presets: Object.entries(feedback.presets).map(([key, p]) => ({ key, name: p.name, kind: p.kind })) };
	});

	app.post('/api/feedback/:guildId/boxes', {
		config: { permission: 'feedback.manage' },
		schema: { params: guildParam, body: { type: 'object', properties: { preset: { type: 'string', enum: ['suggestions', 'bugs', 'staff'] }, name: { type: 'string', maxLength: 60 }, config: { type: 'object' } } } },
	}, async (request, reply) => {
		reply.code(201);
		return feedback.createBox(request.actor, request.params.guildId, request.body);
	});
	app.put('/api/feedback/boxes/:id', { config: { permission: 'feedback.manage' }, schema: { params: idParam, body: { type: 'object' } } }, async (request) => feedback.updateBox(request.actor, request.params.id, request.body));
	app.delete('/api/feedback/boxes/:id', { config: { permission: 'feedback.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		feedback.deleteBox(request.actor, request.params.id);
		return { ok: true };
	});
	app.post('/api/feedback/boxes/:id/panel', { config: { permission: 'feedback.manage' }, schema: { params: idParam } }, async (request) => feedback.publishPanel(request.actor, request.params.id));

	app.get('/api/feedback/boxes/:id/items', {
		config: { permission: null },
		schema: { params: idParam, querystring: { type: 'object', properties: { status: { type: 'string', maxLength: 20 }, sort: { type: 'string', enum: ['recent', 'score', 'urgency'] } } } },
	}, async (request) => withNames(feedback.list(request.actor, { boxId: request.params.id, ...request.query })));

	app.get('/api/feedback/boxes/:id/export', { config: { permission: null }, schema: { params: idParam } }, async (request, reply) => {
		const box = feedback.getBox(request.params.id);
		const items = await withNames(feedback.list(request.actor, { boxId: box.id, limit: 500 }));
		const rows = [['N°', 'Titre', 'Statut', 'Pour', 'Contre', 'Auteur', 'Urgence', 'Créé le'], ...items.map(i => [
			i.number, i.title, box.config.statuses.find(s => s.key === i.status)?.label ?? i.status, i.up, i.down, i.author?.name ?? 'anonyme', i.urgency ?? '', new Date(i.createdAt).toLocaleString('fr-FR'),
		])];
		return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${box.name.replace(/[^\w-]+/g, '-')}.csv"`)
			.send(`${String.fromCharCode(0xfeff)}${rows.map(r => r.map(csvCell).join(';')).join('\n')}\n`);
	});

	app.post('/api/feedback/items/:id/status', {
		config: { permission: null },
		schema: { params: idParam, body: { type: 'object', required: ['status'], properties: { status: { type: 'string', maxLength: 20 }, reason: { type: 'string', maxLength: 500 }, duplicateOf: { type: ['integer', 'null'] } } } },
	}, async (request) => (await withNames([await feedback.setStatus(request.actor.id, request.params.id, request.body.status, { reason: request.body.reason ?? '', duplicateOf: request.body.duplicateOf ?? null, source: 'panel' })]))[0]);

	app.post('/api/feedback/items/:id/assign', {
		config: { permission: null },
		schema: { params: idParam, body: { type: 'object', properties: { userId: { anyOf: [snowflake, { type: 'null' }] } } } },
	}, async (request) => (await withNames([await feedback.assign(request.actor.id, request.params.id, request.body.userId ?? request.actor.id, 'panel')]))[0]);

	app.post('/api/feedback/items/:id/review', {
		config: { permission: null },
		schema: { params: idParam, body: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' } } } },
	}, async (request) => ({ item: await feedback.review(request.actor.id, request.params.id, request.body.approved, 'panel') }));

	app.delete('/api/feedback/items/:id', { config: { permission: 'feedback.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await feedback.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
