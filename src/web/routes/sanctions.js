import { parseDuration } from '../../core/duration.js';
import { ValidationError } from '../../core/errors.js';
import { resolveNames, snowflake } from './helpers.js';
import { RESTRICTABLE } from '../../core/restrictions.js';
import { COMMANDS } from '../../core/commandCatalog.js';
import { listPermissions } from '../../core/permissions.js';

export function registerSanctionRoutes(app, { core }) {
	const { sanctions, executor, restrictions, moderation } = core;
	const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

	async function withNames(list) {
		const names = await resolveNames(executor, list.flatMap(s => [s.userId, s.moderatorId, s.revokedBy]));
		const profiles = new Map(restrictions.profiles().map(p => [p.key, p.label]));
		return list.map(s => ({
			...s,
			profileLabel: s.profile ? profiles.get(s.profile) ?? s.profile : null,
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
					type: { type: 'string', enum: ['ban', 'kick', 'timeout', 'warn', 'restrict'] },
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
					type: { type: 'string', enum: ['ban', 'kick', 'timeout', 'warn', 'restrict'] },
					userId: snowflake,
					reason: { type: 'string', maxLength: 500 },
					duration: { type: ['string', 'null'], maxLength: 20 },
					scope: { type: 'string', enum: ['network', 'local'] },
					originGuildId: { anyOf: [snowflake, { type: 'null' }] },
					profile: { type: ['string', 'null'], maxLength: 30 },
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

	app.patch('/api/sanctions/:id', {
		config: { permission: 'sanctions.edit' },
		schema: { params: idParam, body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', maxLength: 500 } }, additionalProperties: false } },
	}, async (request) => (await withNames([sanctions.setReason(request.actor, request.params.id, request.body.reason)]))[0]);

	// --- Restriction profiles ("punishment roles") ---------------------------------------------
	app.get('/api/restrictions', { config: { permission: 'sanctions.view' } }, async () => ({
		profiles: restrictions.profiles(),
		restrictable: RESTRICTABLE,
	}));

	app.put('/api/restrictions', {
		config: { permission: 'restrictions.manage' },
		schema: { body: { type: 'array', maxItems: 15, items: { type: 'object' } } },
	}, async (request) => restrictions.saveProfiles(request.actor, request.body));

	app.post('/api/restrictions/repair', {
		config: { permission: 'restrictions.manage', confirm: true },
		schema: { body: { type: 'object', properties: { guildId: { anyOf: [snowflake, { type: 'null' }] }, confirm: { type: 'boolean' } } } },
	}, async (request) => restrictions.repair(request.actor, request.body.guildId ?? null));

	// --- Temporary roles ---------------------------------------------------------------------------
	app.get('/api/temp-roles', {
		config: { permission: 'members.view' },
		schema: { querystring: { type: 'object', properties: { userId: { type: 'string' }, guildId: { type: 'string' } } } },
	}, async (request) => moderation.listTempRoles(request.query));

	app.post('/api/temp-roles', {
		config: { permission: 'commands.roles' },
		schema: {
			body: {
				type: 'object',
				required: ['guildId', 'userId', 'roleId', 'duration'],
				properties: { guildId: snowflake, userId: snowflake, roleId: snowflake, duration: { type: 'string', maxLength: 20 }, reason: { type: 'string', maxLength: 300 } },
				additionalProperties: false,
			},
		},
	}, async (request, reply) => {
		const durationMs = parseDuration(request.body.duration);
		if (!durationMs) throw new ValidationError(`Durée invalide : « ${request.body.duration} ». Exemples : 12h, 7j, 1sem.`);
		const temp = await moderation.giveRole(request.actor, { ...request.body, durationMs });
		reply.code(201);
		return temp;
	});

	app.post('/api/temp-roles/:id/extend', {
		config: { permission: 'commands.roles' },
		schema: { params: idParam, body: { type: 'object', required: ['duration'], properties: { duration: { type: 'string', maxLength: 20 } } } },
	}, async (request) => {
		const durationMs = parseDuration(request.body.duration);
		if (!durationMs) throw new ValidationError(`Durée invalide : « ${request.body.duration} ».`);
		return moderation.extendTempRole(request.actor, request.params.id, durationMs);
	});

	app.delete('/api/temp-roles/:id', { config: { permission: 'commands.roles', confirm: true }, schema: { params: idParam } }, async (request) => {
		await moderation.removeTempRole(request.actor, request.params.id);
		return { ok: true };
	});

	// Slash commands and the permission each one checks
	app.get('/api/commands', { config: { permission: null } }, async () => {
		const labels = new Map(listPermissions().map(p => [p.key, p.label]));
		return COMMANDS.map(c => ({ ...c, permissions: c.permissions.map(key => ({ key, label: labels.get(key) ?? key })) }));
	});
}
