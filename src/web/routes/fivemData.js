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
		schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 }, before: { type: 'integer' } } } },
	}, async (request) => fivemData.adminLogs(request.actor, { search: request.query.q ?? '', before: request.query.before ?? null }));
}
