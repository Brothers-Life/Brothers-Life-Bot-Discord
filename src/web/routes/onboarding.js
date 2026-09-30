import { ForbiddenError, NotFoundError } from '../../core/errors.js';
import { FONTS } from '../../core/cards.js';
import { MIME, MAX_UPLOAD_BYTES } from '../../core/uploads.js';
import { snowflake } from './helpers.js';

const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };

export function registerOnboardingRoutes(app, { core }) {
	const { onboarding, uploads, executor, network } = core;

	function requireGuild(guildId) {
		if (!network.find(guildId)) throw new NotFoundError('Serveur introuvable.');
	}

	app.get('/api/onboarding/:guildId', { config: { permission: 'onboarding.view' }, schema: { params: guildParam } }, async (request) => {
		const { guildId } = request.params;
		requireGuild(guildId);
		const [channels, roles] = await Promise.all([executor.listTextChannels(guildId), executor.listRoles(guildId)]);
		return { config: onboarding.get(guildId), channels, roles, fonts: Object.keys(FONTS) };
	});

	app.put('/api/onboarding/:guildId', {
		config: { permission: 'onboarding.manage' },
		schema: { params: guildParam, body: { type: 'object' } },
		bodyLimit: 1024 * 1024,
	}, async (request) => onboarding.save(request.actor, request.params.guildId, request.body));

	// The real rendering of a card, exactly as the bot will send it
	app.post('/api/onboarding/:guildId/card/preview', {
		config: { permission: 'onboarding.view' },
		schema: { params: guildParam, body: { type: 'object', required: ['design'], properties: { design: { type: 'object' } } } },
		bodyLimit: 1024 * 1024,
	}, async (request, reply) => {
		requireGuild(request.params.guildId);
		const user = await executor.getUser(request.actor.id);
		const png = await onboarding.previewCard(request.params.guildId, request.body.design, user ? { id: user.id, username: user.username, globalName: user.globalName, avatarUrl: user.avatar } : null);
		return reply.type('image/png').header('Cache-Control', 'no-store').send(png);
	});

	app.post('/api/onboarding/:guildId/test', {
		config: { permission: 'onboarding.manage' },
		schema: { params: guildParam, body: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['welcome', 'leave', 'boost'] } } } },
	}, async (request) => {
		await onboarding.sendTest(request.actor, request.params.guildId, request.body.kind);
		return { ok: true };
	});

	app.post('/api/onboarding/:guildId/rules/publish', { config: { permission: 'onboarding.manage' }, schema: { params: guildParam } }, async (request) => {
		return onboarding.publishRules(request.actor, request.params.guildId);
	});

	// --- Images sent from the panel -----------------------------------------------------------
	// JSON { data: base64 }: no multipart parser needed, the type is checked from the bytes
	app.post('/api/uploads', {
		config: { permission: null },
		bodyLimit: Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 1024,
		schema: { body: { type: 'object', required: ['data'], properties: { data: { type: 'string' } }, additionalProperties: false } },
	}, async (request, reply) => {
		const actor = request.actor;
		if (!['onboarding.manage', 'announcements.manage', 'tickets.manage', 'messages.manage'].some(p => actor.can(p))) {
			throw new ForbiddenError('Il te faut une permission de configuration pour envoyer des images.');
		}
		const buffer = Buffer.from(request.body.data.replace(/^data:[^,]*,/, ''), 'base64');
		const saved = uploads.save(buffer);
		core.audit.record({ actorId: actor.id, source: 'panel', action: 'uploads.add', target: saved.id, details: { size: saved.size } });
		reply.code(201);
		return saved;
	});

	app.get('/api/uploads/:id', {
		config: { permission: null },
		schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-f0-9]{32}\\.(png|jpg|webp|gif)$' } }, required: ['id'] } },
	}, async (request, reply) => {
		const { id } = request.params;
		const buffer = uploads.read(id);
		return reply.type(MIME[id.split('.').pop()]).header('Cache-Control', 'private, max-age=86400').send(buffer);
	});
}
