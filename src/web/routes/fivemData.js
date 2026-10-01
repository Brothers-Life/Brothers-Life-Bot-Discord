import { resolveNames, snowflake } from './helpers.js';

// Player sheets read from the FiveM database
export function registerFivemDataRoutes(app, { core }) {
	const { fivemData, executor } = core;

	const withDiscord = async (players) => {
		const names = await resolveNames(executor, players.map(p => p.discordId).filter(Boolean));
		return players.map(p => ({ ...p, discord: p.discordId ? names.get(p.discordId) ?? null : null }));
	};

	app.get('/api/fivem-data/settings', { config: { permission: 'fivemdata.manage' } }, async () => fivemData.settingsView());
	app.put('/api/fivem-data/settings', {
		config: { permission: 'fivemdata.manage' },
		schema: { body: { type: 'object', properties: { enabled: { type: 'boolean' }, host: { type: 'string', maxLength: 200 }, port: { type: 'integer' }, database: { type: 'string', maxLength: 64 }, user: { type: 'string', maxLength: 80 }, password: { type: 'string', maxLength: 200 } } } },
	}, async (request) => fivemData.setConfig(request.actor, request.body));
	app.post('/api/fivem-data/test', { config: { permission: 'fivemdata.manage' } }, async (request) => fivemData.test(request.actor));

	app.get('/api/fivem-data/overview', { config: { permission: 'fivemdata.view' } }, async (request) => fivemData.overview(request.actor));
	app.get('/api/fivem-data/players', {
		config: { permission: 'fivemdata.view' },
		schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 } } } },
	}, async (request) => withDiscord(await fivemData.search(request.actor, request.query.q ?? '')));
	app.get('/api/fivem-data/players/:userId', {
		config: { permission: 'fivemdata.view' },
		schema: { params: { type: 'object', properties: { userId: { type: 'integer' } }, required: ['userId'] } },
	}, async (request) => {
		const sheet = await fivemData.player(request.actor, request.params.userId);
		const [discord] = await withDiscord([{ discordId: sheet.account.discordId }]);
		return { ...sheet, discord: discord.discord };
	});
	app.get('/api/fivem-data/by-discord/:discordId', {
		config: { permission: 'fivemdata.view' },
		schema: { params: { type: 'object', properties: { discordId: snowflake }, required: ['discordId'] } },
	}, async (request) => {
		const userId = await fivemData.findByDiscord(request.params.discordId);
		return { userId, summary: userId ? (await fivemData.summaries([userId]))[0] ?? null : null };
	});
	app.get('/api/fivem-data/logs', {
		config: { permission: 'fivemdata.logs' },
		schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 }, source: { type: 'string', maxLength: 30 }, before: { type: 'integer' } } } },
	}, async (request) => fivemData.gameLogs(request.actor, { search: request.query.q ?? '', source: request.query.source ?? '', before: request.query.before ?? null }));
	app.get('/api/fivem-data/log-sources', { config: { permission: 'fivemdata.logs' } }, async request => fivemData.logSources(request.actor));
	app.get('/api/fivem-data/server', { config: { permission: 'fivemdata.view' } }, async request => fivemData.server(request.actor));

	// Discord roles checked against the game
	const { fivemRoles } = core;
	app.get('/api/fivem-data/roles/setup', { config: { permission: 'fivemdata.roles' } }, async request => ({
		links: fivemRoles.links(),
		catalog: await fivemData.catalog(request.actor),
		guilds: await Promise.all(core.network.list().filter(g => g.status === 'active' && g.botPresent).map(async g => ({
			id: g.id, name: g.name, isMain: g.isMain,
			roles: (await executor.listRoles(g.id)).map(({ id, name, color, editable }) => ({ id, name, color, editable })),
		}))),
	}));
	app.put('/api/fivem-data/roles/links', {
		config: { permission: 'fivemdata.manage' },
		schema: { body: { type: 'array', maxItems: 200, items: { type: 'object' } } },
	}, async request => fivemRoles.setLinks(request.actor, request.body));
	app.get('/api/fivem-data/roles/check', { config: { permission: 'fivemdata.roles' } }, async (request) => {
		const result = await fivemRoles.check(request.actor);
		const names = await resolveNames(executor, result.issues.map(i => i.userId));
		return { ...result, issues: result.issues.map(i => ({ ...i, discord: names.get(i.userId) ?? null })) };
	});
	app.post('/api/fivem-data/roles/fix', {
		config: { permission: 'fivemdata.roles' },
		schema: { body: { type: 'object', required: ['keys'], properties: { keys: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', maxLength: 120 } } } } },
	}, async request => fivemRoles.fix(request.actor, request.body.keys));
}
