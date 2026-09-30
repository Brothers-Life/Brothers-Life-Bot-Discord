import { NotFoundError } from '../../core/errors.js';
import { resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };

function csvCell(value) {
	const text = value === null || value === undefined ? '' : String(value);
	return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Staff recruitment and absences
export function registerStaffRoutes(app, { core }) {
	const { recruitment, absences, executor, network, ranks } = core;

	async function withNames(list, keys) {
		const names = await resolveNames(executor, list.flatMap(x => keys.map(k => x[k])));
		return list.map(x => ({ ...x, names: Object.fromEntries(keys.map(k => [k, x[k] ? names.get(x[k]) ?? { name: x[k], avatar: null } : null])) }));
	}

	// --- Recruitment ---------------------------------------------------------------------------
	app.get('/api/recruitment/:guildId', { config: { permission: 'recruitment.view' }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		const [channels, categories, roles] = await Promise.all([executor.listTextChannels(guildId), executor.listCategoryChannels(guildId), executor.listRoles(guildId)]);
		return {
			positions: recruitment.positions(guildId),
			applications: await withNames(recruitment.list(request.actor, { guildId }), ['userId', 'decidedBy']),
			statuses: recruitment.statuses,
			channels, categories, roles,
			ranks: ranks.list().map(({ id, name, level, color }) => ({ id, name, level, color })),
		};
	});
	app.put('/api/recruitment/:guildId/positions', { config: { permission: 'recruitment.manage' }, schema: { params: guildParam, body: { type: 'object' } } }, async (request) => {
		return recruitment.savePosition(request.actor, request.params.guildId, request.body);
	});
	app.delete('/api/recruitment/positions/:id', { config: { permission: 'recruitment.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		recruitment.deletePosition(request.actor, request.params.id);
		return { ok: true };
	});
	app.post('/api/recruitment/:guildId/panel', {
		config: { permission: 'recruitment.manage' },
		schema: { params: guildParam, body: { type: 'object', required: ['channelId'], properties: { channelId: snowflake } } },
	}, async (request) => ({ messageId: await recruitment.publishPanel(request.actor, request.params.guildId, request.body.channelId) }));
	app.get('/api/recruitment/applications/:id', { config: { permission: 'recruitment.view' }, schema: { params: idParam } }, async (request) => {
		const application = recruitment.get(request.actor, request.params.id);
		const names = await resolveNames(executor, [application.userId, ...application.votes.map(v => v.userId), ...application.notes.map(n => n.by), ...application.history.map(h => h.by)]);
		return { ...application, names: Object.fromEntries(names) };
	});
	app.post('/api/recruitment/applications/:id/status', {
		config: { permission: 'recruitment.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['status'], properties: { status: { type: 'string', maxLength: 20 }, reason: { type: 'string', maxLength: 500 } } } },
	}, async (request) => recruitment.setStatus(request.actor, request.params.id, request.body.status, { reason: request.body.reason ?? '' }));
	app.post('/api/recruitment/applications/:id/vote', {
		config: { permission: 'recruitment.vote' },
		schema: { params: idParam, body: { type: 'object', required: ['vote'], properties: { vote: { type: 'integer', enum: [-1, 0, 1] }, comment: { type: ['string', 'null'], maxLength: 500 } } } },
	}, async (request) => recruitment.vote(request.actor.id, request.params.id, request.body.vote, request.body.comment ?? null));
	app.post('/api/recruitment/applications/:id/notes', {
		config: { permission: 'recruitment.vote' },
		schema: { params: idParam, body: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } } },
	}, async (request) => recruitment.addNote(request.actor, request.params.id, request.body.text));
	app.get('/api/recruitment/:guildId/export', { config: { permission: 'recruitment.view' }, schema: { params: guildParam } }, async (request, reply) => {
		const list = await withNames(recruitment.list(request.actor, { guildId: request.params.guildId }), ['userId']);
		const positions = new Map(recruitment.positions(request.params.guildId).map(p => [p.id, p.name]));
		const rows = [['Candidat', 'Poste', 'Statut', 'Pour', 'Contre', 'Déposée le'], ...list.map(a => [a.names.userId?.name ?? a.userId, positions.get(a.positionId), recruitment.statuses[a.status].label, a.score.for, a.score.against, new Date(a.createdAt).toLocaleString('fr-FR')])];
		return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="candidatures.csv"')
			.send(`${String.fromCharCode(0xfeff)}${rows.map(r => r.map(csvCell).join(';')).join('\n')}\n`);
	});

	// --- Absences -------------------------------------------------------------------------------
	app.get('/api/absences', {
		config: { permission: null },
		schema: { querystring: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } } } },
	}, async (request) => {
		const canSeeAll = request.actor.can('absences.view') || request.actor.can('absences.manage');
		const list = canSeeAll ? absences.list(request.actor, request.query) : absences.mine(request.actor.id);
		const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
		const roles = request.actor.can('absences.manage')
			? Object.fromEntries(await Promise.all(guilds.map(async g => [g.id, (await executor.listRoles(g.id)).map(({ id, name, color }) => ({ id, name, color }))])))
			: {};
		return {
			absences: await withNames(list, ['userId', 'declaredBy', 'reviewedBy']),
			config: absences.config(),
			guilds: guilds.map(({ id, name }) => ({ id, name })),
			roles,
			channels: request.actor.can('absences.manage') ? Object.fromEntries(await Promise.all(guilds.map(async g => [g.id, await executor.listTextChannels(g.id)]))) : {},
		};
	});
	app.post('/api/absences', {
		config: { permission: null },
		schema: { body: { type: 'object', required: ['endAt'], properties: { userId: snowflake, startAt: { type: ['integer', 'null'] }, endAt: { type: 'integer' }, reason: { type: 'string', maxLength: 300 } } } },
	}, async (request, reply) => {
		reply.code(201);
		return absences.declare(request.actor, { ...request.body, startAt: request.body.startAt ?? undefined });
	});
	app.post('/api/absences/:id/review', {
		config: { permission: 'absences.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' } } } },
	}, async (request) => absences.review(request.actor, request.params.id, request.body.approved));
	app.post('/api/absences/:id/end', { config: { permission: null }, schema: { params: idParam } }, async (request) => absences.end(request.actor, request.params.id));
	app.post('/api/absences/:id/extend', {
		config: { permission: null },
		schema: { params: idParam, body: { type: 'object', required: ['endAt'], properties: { endAt: { type: 'integer' } } } },
	}, async (request) => absences.extend(request.actor, request.params.id, request.body.endAt));
	app.put('/api/absences/config', { config: { permission: 'absences.manage' }, schema: { body: { type: 'object' } } }, async (request) => absences.setConfig(request.actor, request.body));
}
