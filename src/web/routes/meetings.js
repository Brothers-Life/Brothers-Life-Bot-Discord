import { resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const meetingBody = { type: 'object', required: ['guildId', 'title', 'startsAt', 'voiceChannelId'], properties: { guildId: snowflake } };

// Staff meetings
export function registerMeetingRoutes(app, { core }) {
	const { meetings, network, executor, ranks } = core;

	async function withNames(list, extraIds = []) {
		const ids = list.flatMap(m => [...m.invitees.map(i => i.userId), ...(m.report?.people.map(p => p.userId) ?? []), ...m.actions.map(a => a.assigneeId).filter(Boolean)]);
		return resolveNames(executor, [...ids, ...extraIds]);
	}
	const named = (names, id) => (id ? { id, ...(names.get(id) ?? { name: null, avatar: null }) } : null);

	app.get('/api/meetings', { config: { permission: 'meetings.view' } }, async () => {
		const list = meetings.list();
		const stats = meetings.stats(90);
		const tasks = meetings.openActions();
		const names = await withNames(list, [...stats.people.map(p => p.userId), ...tasks.map(t => t.assigneeId).filter(Boolean)]);
		const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
		return {
			meetings: list.map(m => ({
				...m,
				invitees: m.invitees.map(i => ({ ...i, user: named(names, i.userId) })),
				report: m.report ? { ...m.report, people: m.report.people.map(p => ({ ...p, user: named(names, p.userId) })) } : null,
				actions: m.actions.map(a => ({ ...a, assignee: named(names, a.assigneeId) })),
			})),
			stats: { ...stats, people: stats.people.map(p => ({ ...p, user: named(names, p.userId) })) },
			tasks: tasks.map(t => ({ ...t, assignee: named(names, t.assigneeId) })),
			ranks: ranks.list().map(({ id, name, color, level }) => ({ id, name, color, level })),
			guilds: await Promise.all(guilds.map(async g => ({
				id: g.id, name: g.name, icon: g.icon ?? null,
				voiceChannels: await executor.listVoiceChannels(g.id),
				textChannels: await executor.listTextChannels(g.id),
				roles: (await executor.listRoles(g.id)).filter(r => r.id !== g.id).map(({ id, name, color }) => ({ id, name, color })),
			}))),
		};
	});

	app.post('/api/meetings', { config: { permission: 'meetings.manage' }, schema: { body: meetingBody } }, async (request) => meetings.create(request.actor, request.body));
	app.put('/api/meetings/:id', { config: { permission: 'meetings.manage' }, schema: { params: idParam, body: { type: 'object' } } }, async (request) => meetings.update(request.actor, request.params.id, request.body));
	app.post('/api/meetings/:id/cancel', {
		config: { permission: 'meetings.manage' },
		schema: { params: idParam, body: { type: 'object', properties: { reason: { type: 'string', maxLength: 300 } } } },
	}, async (request) => meetings.cancel(request.actor, request.params.id, request.body?.reason ?? ''));
	app.post('/api/meetings/:id/start', { config: { permission: 'meetings.manage' }, schema: { params: idParam } }, async (request) => meetings.start(request.actor, request.params.id));
	app.post('/api/meetings/:id/end', { config: { permission: 'meetings.manage' }, schema: { params: idParam } }, async (request) => (await meetings.end(request.actor, request.params.id)).meeting);
	app.put('/api/meetings/:id/notes', {
		config: { permission: 'meetings.manage' },
		schema: { params: idParam, body: { type: 'object', properties: { notes: { type: 'string', maxLength: 20000 }, agenda: { type: 'array', maxItems: 30 } } } },
	}, async (request) => meetings.saveNotes(request.actor, request.params.id, request.body));
	app.post('/api/meetings/:id/actions', {
		config: { permission: 'meetings.manage' },
		schema: { params: idParam, body: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 300 }, assigneeId: { anyOf: [{ type: 'null' }, snowflake] }, dueAt: { type: ['integer', 'null'] } } } },
	}, async (request) => meetings.addAction(request.actor, request.params.id, request.body));
	app.patch('/api/meeting-actions/:id', {
		config: { permission: null },
		schema: { params: idParam, body: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } } },
	}, async (request) => meetings.setActionDone(request.actor, request.params.id, request.body.done));
	app.delete('/api/meeting-actions/:id', { config: { permission: 'meetings.manage' }, schema: { params: idParam } }, async (request) => meetings.removeAction(request.actor, request.params.id));
}
