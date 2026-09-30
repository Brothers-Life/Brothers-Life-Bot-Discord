import { parseDuration } from '../../core/duration.js';
import { ValidationError } from '../../core/errors.js';
import { resolveNames, snowflake } from './helpers.js';

export function registerSanctionRoutes(app, { core }) {
	const { sanctions, executor } = core;

	async function withNames(list) {
		const names = await resolveNames(executor, list.flatMap(s => [s.userId, s.moderatorId, s.revokedBy]));
		return list.map(s => ({
			...s,
			user: names.get(s.userId) ?? { name: s.userName, avatar: null },
			moderator: names.get(s.moderatorId) ?? null,
		}));
	}

	app.get('/api/sanctions', {
		config: { permission: 'sanctions.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					userId: { type: 'string' },
					type: { type: 'string', enum: ['ban', 'kick', 'timeout', 'warn'] },
					active: { type: 'boolean' },
					guildId: { type: 'string' },
					before: { type: 'integer' },
					limit: { type: 'integer', minimum: 1, maximum: 200 },
				},
			},
		},
	}, async (request) => withNames(sanctions.list(request.query)));

	// Each type is checked by the sanctions service (sanctions.ban, sanctions.warn...)
	app.post('/api/sanctions', {
		config: { permission: null },
		schema: {
			body: {
				type: 'object',
				required: ['type', 'userId'],
				properties: {
					type: { type: 'string', enum: ['ban', 'kick', 'timeout', 'warn'] },
					userId: snowflake,
					reason: { type: 'string', maxLength: 500 },
					duration: { type: ['string', 'null'], maxLength: 20 },
					scope: { type: 'string', enum: ['network', 'local'] },
					originGuildId: { anyOf: [snowflake, { type: 'null' }] },
				},
				additionalProperties: false,
			},
		},
	}, async (request, reply) => {
		const { duration, ...body } = request.body;
		const durationMs = duration ? parseDuration(duration) : null;
		if (duration && !durationMs) throw new ValidationError(`Durée invalide : « ${duration} ». Exemples : 30m, 2h, 7j.`);
		const sanction = await sanctions.create(request.actor, { ...body, durationMs });
		reply.code(201);
		return (await withNames([sanction]))[0];
	});

	app.post('/api/sanctions/:id/revoke', {
		config: { permission: 'sanctions.revoke', confirm: true },
		schema: {
			params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
			body: { type: 'object', properties: { reason: { type: 'string', maxLength: 500 }, confirm: { type: 'boolean' } } },
		},
	}, async (request) => sanctions.revoke(request.actor, request.params.id, request.body?.reason ?? ''));

	app.post('/api/sanctions/unban', {
		config: { permission: 'sanctions.revoke', confirm: true },
		schema: { body: { type: 'object', required: ['userId'], properties: { userId: snowflake, reason: { type: 'string', maxLength: 500 }, confirm: { type: 'boolean' } } } },
	}, async (request) => sanctions.unbanUser(request.actor, request.body.userId, request.body.reason ?? ''));
}
