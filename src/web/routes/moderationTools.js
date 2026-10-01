import fs from 'node:fs';
import { resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };

// Sanction appeals, channel opening hours, channel archives
export function registerModerationToolRoutes(app, { core }) {
	const { appeals, channelSchedules, archives, network, executor } = core;
	const activeGuilds = () => network.list().filter(g => g.status === 'active' && g.botPresent);

	// --- Appeals ------------------------------------------------------------------------------
	app.get('/api/appeals', { config: { permission: 'appeals.view' } }, async (request) => {
		const list = appeals.list(request.actor);
		const names = await resolveNames(executor, list.flatMap(a => [a.userId, a.decidedBy, a.sanction?.moderatorId]));
		return {
			appeals: list.map(a => ({ ...a, user: names.get(a.userId) ?? null, decider: a.decidedBy ? names.get(a.decidedBy) ?? null : null, moderator: names.get(a.sanction?.moderatorId) ?? null })),
			config: appeals.config(),
			guilds: await Promise.all(activeGuilds().map(async g => ({ id: g.id, name: g.name, channels: await executor.listTextChannels(g.id), roles: (await executor.listRoles(g.id)).filter(r => r.id !== g.id).map(({ id, name, color }) => ({ id, name, color })) }))),
		};
	});
	app.put('/api/appeals/config', { config: { permission: 'appeals.manage' }, schema: { body: { type: 'object' } } }, async (request) => appeals.setConfig(request.actor, request.body));
	app.post('/api/appeals/:id/decide', {
		config: { permission: 'sanctions.revoke' },
		schema: { params: idParam, body: { type: 'object', required: ['accepted'], properties: { accepted: { type: 'boolean' }, reason: { type: 'string', maxLength: 500 } } } },
	}, async (request) => appeals.decide(request.actor, request.params.id, request.body.accepted, request.body.reason ?? ''));

	// --- Opening hours of channels ------------------------------------------------------------
	app.get('/api/channel-schedules', { config: { permission: 'schedules.view' } }, async () => ({
		schedules: channelSchedules.list(),
		guilds: await Promise.all(activeGuilds().map(async g => ({ id: g.id, name: g.name, icon: g.icon ?? null, channels: [...await executor.listTextChannels(g.id), ...(await executor.listVoiceChannels(g.id)).map(c => ({ ...c, voice: true, canSend: true }))] }))),
	}));
	app.put('/api/channel-schedules', { config: { permission: 'schedules.manage' }, schema: { body: { type: 'object', required: ['guildId'], properties: { guildId: snowflake } } } }, async (request) => channelSchedules.save(request.actor, request.body));
	app.delete('/api/channel-schedules/:id', { config: { permission: 'schedules.manage' }, schema: { params: idParam } }, async (request) => {
		await channelSchedules.remove(request.actor, request.params.id);
		return { ok: true };
	});

	// --- Archives -----------------------------------------------------------------------------
	app.get('/api/archives', { config: { permission: 'archives.view' } }, async () => {
		const list = archives.list();
		const names = await resolveNames(executor, list.map(a => a.createdBy));
		return {
			archives: list.map(a => ({ ...a, author: names.get(a.createdBy) ?? null, guildName: network.find(a.guildId)?.name ?? a.guildId })),
			guilds: await Promise.all(activeGuilds().map(async g => ({ id: g.id, name: g.name, channels: await executor.listTextChannels(g.id) }))),
		};
	});
	app.post('/api/archives', {
		config: { permission: 'archives.manage' },
		schema: { body: { type: 'object', required: ['guildId', 'channelId'], properties: { guildId: snowflake, channelId: snowflake, limit: { type: 'integer', minimum: 1, maximum: 10000 }, from: { type: ['integer', 'null'] }, to: { type: ['integer', 'null'] } } } },
	}, async (request) => archives.create({ ...request.actor, name: request.actor.name ?? request.session?.username }, request.body));
	app.get('/api/archives/:id/file', {
		config: { permission: 'archives.view' },
		schema: { params: idParam, querystring: { type: 'object', properties: { download: { type: 'boolean' } } } },
	}, async (request, reply) => {
		const archive = archives.get(request.params.id);
		const name = `archive-${archive.channelName}-${new Date(archive.createdAt).toISOString().slice(0, 10)}.html`.replace(/[^\w.-]/g, '_');
		return reply.type('text/html; charset=utf-8')
			.header('Content-Disposition', `${request.query.download ? 'attachment' : 'inline'}; filename="${name}"`)
			.send(fs.createReadStream(archives.pathOf(archive)));
	});
	app.delete('/api/archives/:id', { config: { permission: 'archives.manage' }, schema: { params: idParam } }, async (request) => {
		archives.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
