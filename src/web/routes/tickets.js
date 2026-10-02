import fs from 'node:fs';
import { NotFoundError } from '../../core/errors.js';
import { authenticate } from '../guard.js';
import { resolveNames, snowflake } from './helpers.js';

const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };
const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const guildIdParam = { type: 'object', properties: { guildId: snowflake, id: { type: 'integer' } }, required: ['guildId', 'id'] };
const PERMISSION_RECHECK_MS = 30_000;

export function registerTicketRoutes(app, { core }) {
	const { tickets, executor, network, ranks } = core;

	async function withNames(list) {
		const names = await resolveNames(executor, list.flatMap(t => [t.openerId, t.claimedBy, t.closedBy]));
		const guilds = new Map(network.list().map(g => [g.id, g.name]));
		const categories = new Map();
		return list.map((t) => {
			if (!categories.has(t.guildId)) categories.set(t.guildId, new Map(tickets.describe(t.guildId).categories.map(c => [c.id, c])));
			const category = categories.get(t.guildId).get(t.categoryId);
			return {
				...t,
				guildName: guilds.get(t.guildId) ?? t.guildId,
				categoryName: category?.name ?? null,
				categoryEmoji: category?.emoji ?? null,
				opener: names.get(t.openerId) ?? { name: t.openerName, avatar: null },
				claimer: t.claimedBy ? names.get(t.claimedBy) ?? null : null,
			};
		});
	}

	app.get('/api/tickets', {
		config: { permission: 'tickets.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					guildId: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed'] }, statusKey: { type: 'string', maxLength: 30 },
					categoryId: { type: 'integer' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
					claimedBy: { type: 'string' }, openerId: { type: 'string' },
					before: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 200 },
				},
			},
		},
	}, async (request) => withNames(tickets.list(request.query)));

	// Live updates of tickets and their conversations (new messages, statuses, claims...)
	app.get('/api/tickets/live', { websocket: true, config: { permission: 'tickets.view' } }, (socket, request) => {
		const send = (payload) => {
			if (socket.readyState === 1) socket.send(JSON.stringify(payload));
		};
		const unsubscribe = tickets.subscribe((event) => {
			// Internal notes are panel-only, but still only for people who can see tickets: fine to forward
			if (event.type === 'ticket') withNames([event.ticket]).then(([ticket]) => send({ ...event, ticket })).catch(() => null);
			else send(event);
		});
		const recheck = setInterval(async () => {
			const actor = await authenticate(request, core).catch(() => null);
			if (!actor?.can('panel.access') || !actor.can('tickets.view')) socket.close(4003, 'Forbidden');
		}, PERMISSION_RECHECK_MS);
		socket.on('close', () => {
			clearInterval(recheck);
			unsubscribe();
		});
		socket.on('message', () => undefined);
	});

	app.get('/api/tickets/:id', { config: { permission: 'tickets.view' }, schema: { params: idParam } }, async (request) => {
		const [ticket] = await withNames([tickets.get(request.params.id, { withTranscript: true })]);
		return {
			...ticket,
			messages: tickets.messages(ticket.id),
			statuses: tickets.statuses(ticket.guildId),
			priorities: tickets.priorities(),
			htmlTranscript: Boolean(tickets.transcriptFile(ticket.id)),
		};
	});

	// The staff HTML transcript, opened in a new tab (or downloaded); the panel's CSP blocks any inline script
	app.get('/api/tickets/:id/transcript', {
		config: { permission: 'tickets.view' },
		schema: { params: idParam, querystring: { type: 'object', properties: { download: { type: 'boolean' } } } },
	}, async (request, reply) => {
		const found = tickets.transcriptFile(request.params.id);
		if (!found) throw new NotFoundError('Pas de transcript web pour ce ticket (fermé avant cette fonction, ou salon illisible).');
		const name = `ticket-${String(found.ticket.number).padStart(4, '0')}.html`;
		return reply.type('text/html; charset=utf-8')
			.header('Content-Disposition', `${request.query.download ? 'attachment' : 'inline'}; filename="${name}"`)
			.send(fs.createReadStream(found.file));
	});

	const handle = { permission: 'tickets.handle' };

	app.post('/api/tickets/:id/reply', {
		config: handle,
		schema: {
			params: idParam,
			body: { type: 'object', required: ['content'], properties: { content: { type: 'string', maxLength: 2000 }, internal: { type: 'boolean' } }, additionalProperties: false },
		},
	}, async (request) => tickets.reply(request.actor, request.params.id, request.body));

	app.post('/api/tickets/:id/claim', { config: handle, schema: { params: idParam } }, async (request) => tickets.claim(request.actor.id, request.params.id, 'panel'));

	app.post('/api/tickets/:id/status', {
		config: handle,
		schema: { params: idParam, body: { type: 'object', required: ['key'], properties: { key: { type: 'string', maxLength: 30 } } } },
	}, async (request) => tickets.setStatus(request.actor.id, request.params.id, request.body.key, 'panel'));

	app.post('/api/tickets/:id/priority', {
		config: handle,
		schema: { params: idParam, body: { type: 'object', required: ['priority'], properties: { priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } } } },
	}, async (request) => tickets.setPriority(request.actor.id, request.params.id, request.body.priority, 'panel'));

	app.post('/api/tickets/:id/members', {
		config: handle,
		schema: { params: idParam, body: { type: 'object', required: ['userId'], properties: { userId: snowflake } } },
	}, async (request) => {
		await tickets.addMember(request.actor.id, request.params.id, request.body.userId, 'panel');
		return { ok: true };
	});

	app.post('/api/tickets/:id/reopen', { config: handle, schema: { params: idParam } }, async (request) => tickets.reopen(request.actor.id, request.params.id, 'panel'));

	app.post('/api/tickets/:id/close', {
		config: { permission: 'tickets.handle', confirm: true },
		schema: { params: idParam, body: { type: 'object', properties: { reason: { type: 'string', maxLength: 200 }, confirm: { type: 'boolean' } } } },
	}, async (request) => tickets.close(request.actor.id, request.params.id, request.body?.reason ?? '', 'panel'));

	// --- Configuration of a server ------------------------------------------------------------
	app.get('/api/tickets/config/:guildId', { config: { permission: 'tickets.view' }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
		const [channels, categoryChannels, roles] = await Promise.all([
			executor.listTextChannels(guildId),
			executor.listCategoryChannels(guildId),
			executor.listRoles(guildId),
		]);
		return {
			...tickets.describe(guildId),
			channels,
			categoryChannels,
			roles,
			ranks: ranks.list().map(({ id, name, level, color }) => ({ id, name, level, color })),
		};
	});

	app.post('/api/tickets/config/:guildId/copy', {
		config: { permission: 'tickets.manage' },
		schema: { params: guildParam, body: { type: 'object', required: ['toGuildId'], properties: { toGuildId: snowflake } } },
	}, async request => tickets.copySystem(request.actor, request.params.guildId, request.body.toGuildId));

	app.put('/api/tickets/config/:guildId/settings', {
		config: { permission: 'tickets.manage' },
		schema: {
			params: guildParam,
			body: { type: 'object', properties: { maxOpen: { type: 'integer' }, statusPrefix: { type: 'boolean' } }, additionalProperties: false },
		},
	}, async (request) => tickets.saveSettings(request.actor, request.params.guildId, request.body));

	app.put('/api/tickets/config/:guildId/statuses', {
		config: { permission: 'tickets.manage' },
		schema: { params: guildParam, body: { type: 'array', maxItems: 20, items: { type: 'object' } } },
	}, async (request) => tickets.saveStatuses(request.actor, request.params.guildId, request.body));

	app.put('/api/tickets/config/:guildId/categories', {
		config: { permission: 'tickets.manage' },
		schema: {
			params: guildParam,
			body: {
				type: 'object',
				required: ['name'],
				properties: {
					id: { type: 'integer' },
					name: { type: 'string', maxLength: 50 },
					emoji: { type: ['string', 'null'], maxLength: 64 },
					description: { type: ['string', 'null'], maxLength: 100 },
					parentChannelId: { anyOf: [snowflake, { type: 'null' }] },
					transcriptChannelId: { anyOf: [snowflake, { type: 'null' }] },
					rankIds: { type: 'array', items: { type: 'integer' }, maxItems: 50 },
					roleIds: { type: 'array', items: snowflake, maxItems: 50 },
					position: { type: 'integer' },
					config: { type: 'object' },
				},
				additionalProperties: false,
			},
		},
	}, async (request) => tickets.saveCategory(request.actor, request.params.guildId, request.body));

	app.delete('/api/tickets/config/:guildId/categories/:id', {
		config: { permission: 'tickets.manage', confirm: true },
		schema: { params: guildIdParam },
	}, async (request) => {
		tickets.deleteCategory(request.actor, request.params.guildId, request.params.id);
		return { ok: true };
	});

	app.put('/api/tickets/config/:guildId/panels', {
		config: { permission: 'tickets.manage' },
		schema: {
			params: guildParam,
			body: {
				type: 'object',
				required: ['name'],
				properties: {
					id: { type: 'integer' },
					name: { type: 'string', maxLength: 50 },
					channelId: { anyOf: [snowflake, { type: 'null' }] },
					payload: { type: 'object' },
					style: { type: 'string', enum: ['buttons', 'select'] },
					placeholder: { type: ['string', 'null'], maxLength: 150 },
					categoryIds: { type: 'array', items: { type: 'integer' }, maxItems: 25 },
				},
				additionalProperties: false,
			},
		},
	}, async (request) => tickets.savePanel(request.actor, request.params.guildId, request.body));

	app.delete('/api/tickets/config/:guildId/panels/:id', {
		config: { permission: 'tickets.manage', confirm: true },
		schema: { params: guildIdParam },
	}, async (request) => {
		await tickets.deletePanel(request.actor, request.params.guildId, request.params.id);
		return { ok: true };
	});

	app.post('/api/tickets/config/:guildId/panels/:id/publish', { config: { permission: 'tickets.manage' }, schema: { params: guildIdParam } }, async (request) => {
		return tickets.publishPanel(request.actor, request.params.guildId, request.params.id);
	});
}
