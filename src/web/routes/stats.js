import { NotFoundError, ValidationError } from '../../core/errors.js';
import { COUNTER_VARIABLES } from '../../core/stats.js';
import { csvCell, resolveNames, snowflake } from './helpers.js';

const filters = {
	type: 'object',
	properties: {
		guildId: { type: 'string', pattern: '^(\\d{17,20}|all)$' },
		from: { type: 'integer' },
		to: { type: 'integer' },
		days: { type: 'integer', minimum: 1, maximum: 400 },
		channelId: snowflake,
		userId: snowflake,
		staffOnly: { type: 'boolean' },
		metric: { type: 'string', enum: ['messages', 'voice'] },
		limit: { type: 'integer', minimum: 1, maximum: 200 },
		kind: { type: 'string', enum: ['days', 'members', 'channels', 'staff'] },
	},
};

// Byte order mark + semicolons: Excel in French opens it directly with the accents
const BOM = String.fromCharCode(0xfeff);

function toCsv(rows, columns) {
	return `${BOM}${[columns.map(c => c.label).join(';'), ...rows.map(r => columns.map(c => csvCell(c.value(r))).join(';'))].join('\n')}\n`;
}

export function registerStatsRoutes(app, { core }) {
	const { stats, executor, network } = core;

	function parse(query) {
		const guildIds = !query.guildId || query.guildId === 'all' ? null : [query.guildId];
		if (guildIds && !network.find(guildIds[0])) throw new NotFoundError('Serveur introuvable.');
		return { guildIds, from: query.from, to: query.to, days: query.days ?? 30, channelId: query.channelId, userId: query.userId, staffOnly: query.staffOnly };
	}

	async function channelNames(guildIds) {
		const ids = guildIds ?? network.activeIds();
		const names = new Map();
		for (const id of ids) {
			const [text, voice] = await Promise.all([executor.listTextChannels(id), executor.listVoiceChannels(id)]);
			for (const c of [...text, ...voice]) names.set(c.id, c.name);
		}
		return names;
	}

	async function withUsers(rows) {
		const names = await resolveNames(executor, rows.map(r => r.userId));
		return rows.map(r => ({ ...r, user: names.get(r.userId) ?? { name: r.userId, avatar: null } }));
	}

	const view = { permission: 'stats.view' };

	app.get('/api/stats/options', { config: view, schema: { querystring: filters } }, async (request) => {
		const { guildIds } = parse(request.query);
		if (!guildIds) return { textChannels: [], voiceChannels: [], categories: [] };
		const [textChannels, voiceChannels, categories] = await Promise.all([
			executor.listTextChannels(guildIds[0]), executor.listVoiceChannels(guildIds[0]), executor.listCategoryChannels(guildIds[0]),
		]);
		return { textChannels, voiceChannels, categories, variables: COUNTER_VARIABLES };
	});

	app.get('/api/stats/overview', { config: view, schema: { querystring: filters } }, async (request) => {
		await stats.flush();
		return stats.overview(parse(request.query));
	});

	app.get('/api/stats/heatmap', { config: view, schema: { querystring: filters } }, async (request) => stats.heatmap(parse(request.query)));

	app.get('/api/stats/members', { config: view, schema: { querystring: filters } }, async (request) => {
		return withUsers(await stats.topMembers(parse(request.query), { metric: request.query.metric, limit: request.query.limit ?? 50 }));
	});

	app.get('/api/stats/channels', { config: view, schema: { querystring: filters } }, async (request) => {
		const f = parse(request.query);
		const [rows, names] = await Promise.all([stats.topChannels(f, { limit: request.query.limit ?? 50 }), channelNames(f.guildIds)]);
		const guilds = new Map(network.list().map(g => [g.id, g.name]));
		return rows.map(r => ({ ...r, name: names.get(r.channelId) ?? 'salon supprimé', guildName: guilds.get(r.guildId) ?? r.guildId }));
	});

	app.get('/api/stats/staff', { config: view, schema: { querystring: filters } }, async (request) => withUsers(await stats.staff(parse(request.query))));

	app.get('/api/stats/export', { config: view, schema: { querystring: { ...filters, required: ['kind'] } } }, async (request, reply) => {
		const f = parse(request.query);
		let csv;
		switch (request.query.kind) {
		case 'days': {
			const { days } = await stats.overview(f);
			csv = toCsv(days, [
				{ label: 'Jour', value: d => d.day }, { label: 'Messages', value: d => d.messages }, { label: 'Heures de vocal', value: d => d.voiceHours },
				{ label: 'Membres actifs', value: d => d.active }, { label: 'Arrivées', value: d => d.joins }, { label: 'Départs', value: d => d.leaves }, { label: 'Membres', value: d => d.memberCount },
			]);
			break;
		}
		case 'members': {
			const rows = await withUsers(await stats.topMembers(f, { metric: request.query.metric, limit: 200 }));
			csv = toCsv(rows, [
				{ label: 'Membre', value: r => r.user.name }, { label: 'ID', value: r => r.userId }, { label: 'Messages', value: r => r.messages },
				{ label: 'Heures de vocal', value: r => r.voiceHours }, { label: 'Jours actifs', value: r => r.days },
			]);
			break;
		}
		case 'channels': {
			const names = await channelNames(f.guildIds);
			const rows = await stats.topChannels(f, { limit: 200 });
			csv = toCsv(rows, [
				{ label: 'Salon', value: r => names.get(r.channelId) ?? r.channelId }, { label: 'Messages', value: r => r.messages },
				{ label: 'Heures de vocal', value: r => r.voiceHours }, { label: 'Membres', value: r => r.members },
			]);
			break;
		}
		case 'staff': {
			const rows = await withUsers(await stats.staff(f));
			csv = toCsv(rows, [
				{ label: 'Membre du staff', value: r => r.user.name }, { label: 'Sanctions', value: r => r.sanctionsTotal },
				{ label: 'Tickets pris', value: r => r.ticketsClaimed }, { label: 'Tickets fermés', value: r => r.ticketsClosed },
				{ label: 'Résolution moyenne (h)', value: r => r.avgResolutionHours }, { label: 'Note moyenne', value: r => r.rating },
				{ label: 'Messages', value: r => r.messages }, { label: 'Heures de vocal', value: r => r.voiceHours },
			]);
			break;
		}
		default:
			throw new ValidationError('Export inconnu.');
		}
		return reply
			.type('text/csv; charset=utf-8')
			.header('Content-Disposition', `attachment; filename="stats-${request.query.kind}.csv"`)
			.send(csv);
	});

	// --- Counter channels ----------------------------------------------------------------------
	app.get('/api/stats/counters', { config: view, schema: { querystring: filters } }, async (request) => stats.counters(parse(request.query).guildIds?.[0] ?? null));

	app.post('/api/stats/counters', {
		config: { permission: 'stats.manage' },
		schema: {
			body: {
				type: 'object',
				required: ['guildId', 'template'],
				properties: { guildId: snowflake, template: { type: 'string', maxLength: 90 }, channelId: { anyOf: [{ type: 'null' }, snowflake] }, categoryId: { anyOf: [{ type: 'null' }, snowflake] } },
				additionalProperties: false,
			},
		},
	}, async (request, reply) => {
		const { guildId, ...input } = request.body;
		const counter = await stats.createCounter(request.actor, guildId, input);
		reply.code(201);
		return counter;
	});

	app.put('/api/stats/counters/:id', {
		config: { permission: 'stats.manage' },
		schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }, body: { type: 'object', required: ['template'], properties: { template: { type: 'string', maxLength: 90 } } } },
	}, async (request) => stats.updateCounter(request.actor, request.params.id, request.body.template));

	app.delete('/api/stats/counters/:id', {
		config: { permission: 'stats.manage', confirm: true },
		schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }, body: { type: 'object', properties: { confirm: { type: 'boolean' }, deleteChannel: { type: 'boolean' } } } },
	}, async (request) => {
		await stats.deleteCounter(request.actor, request.params.id, { deleteChannel: Boolean(request.body?.deleteChannel) });
		return { ok: true };
	});
}
