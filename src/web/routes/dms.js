import { authenticate } from '../guard.js';
import { resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const PERMISSION_RECHECK_MS = 30_000;

// Private messages through the bot: inbox, conversations, live updates
export function registerDmRoutes(app, { core }) {
	const { dms, executor, network } = core;

	async function withNames(threads) {
		const names = await resolveNames(executor, threads.flatMap(t => [t.userId, t.assignedTo]));
		return threads.map(t => ({ ...t, user: names.get(t.userId) ?? { name: t.userName ?? t.userId, avatar: null }, assignee: t.assignedTo ? names.get(t.assignedTo) ?? null : null }));
	}

	app.get('/api/dms', {
		config: { permission: 'dm.view' },
		schema: { querystring: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed'] }, mine: { type: 'boolean' } } } },
	}, async (request) => {
		const { status, mine } = request.query;
		const manage = request.actor.can('dm.manage');
		const guilds = manage ? network.list().filter(g => g.status === 'active' && g.botPresent) : [];
		return {
			threads: await withNames(dms.threads({ status, assignedTo: mine ? request.actor.id : null })),
			snippets: dms.snippets(),
			config: manage ? dms.config() : null,
			blocklist: manage ? dms.blocklist() : [],
			guilds: await Promise.all(guilds.map(async g => ({ id: g.id, name: g.name, channels: await executor.listTextChannels(g.id) }))),
		};
	});

	app.get('/api/dms/:id', { config: { permission: 'dm.view' }, schema: { params: idParam } }, async (request) => {
		const [thread] = await withNames([dms.get(request.params.id)]);
		const messages = dms.messages(thread.id);
		const names = await resolveNames(executor, messages.filter(m => m.direction !== 'in').map(m => m.authorId).filter(id => id !== 'bot'));
		return { thread, messages, authors: Object.fromEntries(names) };
	});

	app.post('/api/dms', {
		config: { permission: 'dm.send' },
		schema: { body: { type: 'object', required: ['userId'], properties: { userId: snowflake, userName: { type: ['string', 'null'], maxLength: 100 } } } },
	}, async (request) => (await withNames([dms.open(request.actor, request.body.userId, request.body.userName ?? null)]))[0]);

	app.post('/api/dms/:id/messages', {
		config: { permission: 'dm.send' },
		schema: { params: idParam, body: { type: 'object', properties: { content: { type: 'string', maxLength: 1800 }, attachments: { type: 'array', maxItems: 5, items: { type: 'string' } }, signed: { type: 'boolean' } } } },
	}, async (request) => {
		const authorName = request.body.signed ? (await resolveNames(executor, [request.actor.id])).get(request.actor.id)?.name ?? null : null;
		return dms.send(request.actor, request.params.id, { ...request.body, authorName });
	});

	app.post('/api/dms/:id/notes', {
		config: { permission: 'dm.view' },
		schema: { params: idParam, body: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } } },
	}, async (request) => dms.addNote(request.actor, request.params.id, request.body.text));

	app.post('/api/dms/:id/read', { config: { permission: 'dm.view' }, schema: { params: idParam } }, async (request) => dms.markRead(request.actor, request.params.id));
	app.post('/api/dms/:id/assign', {
		config: { permission: 'dm.send' },
		schema: { params: idParam, body: { type: 'object', properties: { userId: { type: ['string', 'null'], pattern: '^\\d{17,20}$' } } } },
	}, async (request) => dms.assign(request.actor, request.params.id, request.body.userId ?? null));
	app.post('/api/dms/:id/status', {
		config: { permission: 'dm.send' },
		schema: { params: idParam, body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['open', 'closed'] } } } },
	}, async (request) => dms.setStatus(request.actor, request.params.id, request.body.status));

	app.put('/api/dms/config', { config: { permission: 'dm.manage' }, schema: { body: { type: 'object' } } }, async (request) => dms.setConfig(request.actor, request.body));
	app.post('/api/dms/snippets', {
		config: { permission: 'dm.manage' },
		schema: { body: { type: 'object', required: ['name', 'content'], properties: { id: { type: ['integer', 'null'] }, name: { type: 'string', maxLength: 60 }, content: { type: 'string', maxLength: 1800 } } } },
	}, async (request) => dms.saveSnippet(request.actor, request.body));
	app.delete('/api/dms/snippets/:id', { config: { permission: 'dm.manage' }, schema: { params: idParam } }, async (request) => {
		dms.deleteSnippet(request.actor, request.params.id);
		return { ok: true };
	});
	app.post('/api/dms/blocklist', {
		config: { permission: 'dm.manage' },
		schema: { body: { type: 'object', required: ['userId'], properties: { userId: snowflake, reason: { type: 'string', maxLength: 300 } } } },
	}, async (request) => {
		dms.block(request.actor, request.body.userId, request.body.reason ?? '');
		return { ok: true };
	});
	app.delete('/api/dms/blocklist/:userId', { config: { permission: 'dm.manage' }, schema: { params: { type: 'object', properties: { userId: snowflake }, required: ['userId'] } } }, async (request) => {
		dms.unblock(request.actor, request.params.userId);
		return { ok: true };
	});

	// Live: new messages and conversation changes
	app.get('/api/dms/live', { websocket: true, config: { permission: 'dm.view' } }, (socket, request) => {
		const send = (payload) => {
			if (socket.readyState === 1) socket.send(JSON.stringify(payload));
		};
		const unsubscribe = dms.subscribe((event) => {
			withNames([event.thread]).then(([thread]) => send({ ...event, thread })).catch(() => null);
		});
		const recheck = setInterval(async () => {
			const actor = await authenticate(request, core).catch(() => null);
			if (!actor?.can('panel.access') || !actor.can('dm.view')) socket.close(4003, 'Forbidden');
		}, PERMISSION_RECHECK_MS);
		socket.on('close', () => {
			clearInterval(recheck);
			unsubscribe();
		});
		socket.on('message', () => undefined);
	});
}
