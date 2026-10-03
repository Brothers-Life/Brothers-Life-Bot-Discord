import { listPermissions } from '../../core/permissions.js';
import { API_RATE_LIMIT } from '../guard.js';
import { apiCatalogue, toOpenApi, toBruno } from '../apiDocs.js';
import { zip } from '../zip.js';
import { resolveNames } from './helpers.js';

// Public API: keys (panel only) and its documentation (OpenAPI, Bruno collection)
export function registerApiRoutes(app, { core, runtime, routes }) {
	const { apiKeys, executor } = core;
	const baseUrl = () => core.config.WEB_PUBLIC_URL ?? '';
	const version = () => runtime.info()?.version ?? '';

	app.get('/api/api-keys', {
		config: { permission: null, apiKey: false },
		schema: { querystring: { type: 'object', properties: { all: { type: 'boolean' } } } },
	}, async (request) => {
		const keys = apiKeys.list(request.actor, { all: request.query.all });
		const names = await resolveNames(executor, keys.map(k => k.ownerId));
		return {
			keys: keys.map(k => ({ ...k, owner: names.get(k.ownerId) ?? null })),
			// What a new key of this user may be given
			permissions: listPermissions().filter(p => request.actor.can(p.key)),
			baseUrl: baseUrl(),
			rateLimit: API_RATE_LIMIT,
		};
	});

	app.post('/api/api-keys', {
		config: { permission: 'api.use', apiKey: false },
		schema: {
			body: {
				type: 'object',
				required: ['name'],
				properties: {
					name: { type: 'string', maxLength: 60 },
					// null first: with type coercion, null would otherwise become 0 or []
					permissions: { anyOf: [{ type: 'null' }, { type: 'array', items: { type: 'string' }, maxItems: 200 }] },
					expiresInDays: { anyOf: [{ type: 'null' }, { type: 'integer' }] },
				},
			},
		},
	}, async (request, reply) => {
		reply.code(201);
		return apiKeys.create(request.actor, request.body);
	});

	app.delete('/api/api-keys/:id', {
		config: { permission: null, apiKey: false },
		schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
	}, async (request) => apiKeys.revoke(request.actor, request.params.id));

	// Documentation: reachable from the panel and with any valid key
	app.get('/api/api-docs', { config: { permission: null } }, async (request) => ({
		baseUrl: baseUrl(),
		version: version(),
		rateLimit: API_RATE_LIMIT,
		// Identity of the caller, handy to test a key
		actor: { id: request.actor.id, source: request.actor.source, apiKey: request.actor.apiKey ?? null, permissions: request.actor.permissions },
		routes: apiCatalogue(routes),
	}));

	app.get('/api/openapi.json', { config: { permission: null } }, async (request, reply) => {
		reply.header('Content-Disposition', 'attachment; filename="brothers-life-api.openapi.json"');
		return toOpenApi(routes, { baseUrl: baseUrl(), version: version() });
	});

	app.get('/api/bruno.zip', { config: { permission: null } }, async (request, reply) => {
		const files = toBruno(routes, { baseUrl: baseUrl(), version: version() });
		return reply
			.type('application/zip')
			.header('Content-Disposition', 'attachment; filename="brothers-life-api-bruno.zip"')
			.send(zip(files.map(f => ({ path: `brothers-life-api/${f.path}`, content: f.content }))));
	});
}
