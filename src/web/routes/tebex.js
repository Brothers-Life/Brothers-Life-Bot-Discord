import { ACHAT_VARIABLES } from '../../core/tebex.js';
import { networkTargets, resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] };

// Tebex store: connection, roles of the articles, purchases and their link to Discord members
export function registerTebexRoutes(app, { core }) {
	const { tebex, executor } = core;

	const withDiscord = async (payments) => {
		const names = await resolveNames(executor, payments.map(p => p.discordId).filter(Boolean));
		return payments.map(p => ({ ...p, discord: p.discordId ? names.get(p.discordId) ?? null : null }));
	};

	app.get('/api/tebex', { config: { permission: 'tebex.view' } }, async (request) => {
		const manage = request.actor.can('tebex.manage');
		return {
			...tebex.view(request.actor),
			guilds: manage ? await networkTargets(core) : [],
			variables: [{ title: 'Achat', items: ACHAT_VARIABLES }],
		};
	});

	app.get('/api/tebex/payments', {
		config: { permission: 'tebex.view' },
		schema: { querystring: { type: 'object', properties: { filter: { type: 'string', enum: ['all', 'unlinked', 'revoked', 'errors', 'baseline'] }, q: { type: 'string', maxLength: 100 }, before: { type: 'integer' } } } },
	}, async request => withDiscord(tebex.payments(request.actor, { filter: request.query.filter ?? 'all', search: request.query.q?.trim() ?? '', before: request.query.before ?? null })));

	app.put('/api/tebex/secret', {
		config: { permission: 'tebex.manage' },
		schema: { body: { type: 'object', required: ['secret'], properties: { secret: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 200 }] } } } },
	}, async request => tebex.setSecret(request.actor, request.body.secret));

	app.post('/api/tebex/test', { config: { permission: 'tebex.manage' } }, async request => tebex.test(request.actor));
	app.get('/api/tebex/packages', { config: { permission: 'tebex.manage' } }, async request => tebex.packages(request.actor));
	app.post('/api/tebex/poll', { config: { permission: 'tebex.manage' } }, async request => tebex.pollNow(request.actor));

	app.put('/api/tebex/config', {
		config: { permission: 'tebex.manage' },
		schema: {
			body: {
				type: 'object',
				properties: {
					enabled: { type: 'boolean' },
					showPrice: { type: 'boolean' },
					removeOnRefund: { type: 'boolean' },
					mappings: { type: 'array', maxItems: 200, items: { type: 'object' } },
					thanks: { type: 'object' },
				},
			},
		},
	}, async request => tebex.setConfig(request.actor, request.body));

	app.post('/api/tebex/payments/:id/link', {
		config: { permission: 'tebex.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['discordId'], properties: { discordId: { anyOf: [{ type: 'null' }, snowflake] }, remember: { type: 'boolean' } } } },
	}, async (request) => {
		const payment = await tebex.link(request.actor, request.params.id, { discordId: request.body.discordId, remember: request.body.remember ?? true });
		return (await withDiscord([payment]))[0];
	});

	app.post('/api/tebex/payments/:id/reapply', { config: { permission: 'tebex.manage' }, schema: { params: idParam } }, async (request) => {
		const result = await tebex.reapply(request.actor, request.params.id);
		return { ...result, payment: (await withDiscord([result.payment]))[0] };
	});
}
