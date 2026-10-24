// FiveM telemetry: views of the panel (/api/telemetry/…) and the ingestion of the bl_telemetry resource (/v1/…).
// Query parameters keep the names of bl-panel-api (h, d, q, cid…) so the pages port as they are.

const hours = { type: 'integer', minimum: 1, maximum: 24 * 90 };
const cid = { type: 'string', minLength: 1, maxLength: 60 };
const query = properties => ({ type: 'object', properties, additionalProperties: false });
const withCid = (properties = {}) => ({ ...query({ cid, ...properties }), required: ['cid'] });

// Plain GET views: path, service method, permission, query schema, how the query maps to the method's parameters
const VIEWS = [
	['overview', 'overview', 'telemetry.view', query({ h: hours }), q => ({ hours: q.h })],
	['players', 'players', 'telemetry.view', query({ q: { type: 'string', maxLength: 60 } }), q => ({ q: q.q })],
	['player', 'player', 'telemetry.view', withCid(), q => ({ cid: q.cid })],
	['timeline', 'timeline', 'telemetry.view', withCid({ before: { type: 'string', maxLength: 40 }, limit: { type: 'integer', minimum: 20, maximum: 500 } }), q => ({ cid: q.cid, before: q.before, limit: q.limit })],
	['linked', 'linked', 'telemetry.view', withCid(), q => ({ cid: q.cid })],
	['admin', 'admin', 'telemetry.view', query({}), () => ({})],
	['db', 'db', 'telemetry.view', query({}), () => ({})],
	['deathmap', 'deathmap', 'telemetry.view', query({ h: hours }), q => ({ hours: q.h })],
	['insights', 'insights', 'telemetry.view', query({ d: { type: 'integer', minimum: 1, maximum: 90 } }), q => ({ days: q.d })],
	['search', 'search', 'telemetry.view', { ...query({ q: { type: 'string', minLength: 2, maxLength: 100 }, days: { type: 'integer', minimum: 1, maximum: 90 } }), required: ['q'] }, q => ({ q: q.q, days: q.days })],
	['scripts', 'scripts', 'telemetry.view', query({}), () => ({})],
	['staff', 'staff', 'telemetry.view', query({ days: { type: 'integer', minimum: 1, maximum: 90 }, staff: { type: 'string', maxLength: 120 }, cat: { type: 'string', maxLength: 60 }, q: { type: 'string', maxLength: 80 } }), q => ({ days: q.days, staff: q.staff, cat: q.cat, q: q.q })],
	['perf', 'perf', 'telemetry.view', query({ h: { type: 'integer', minimum: 1, maximum: 24 * 30 } }), q => ({ hours: q.h })],
	['alerts', 'alerts', 'telemetry.view', query({}), () => ({})],
	['economy', 'economy', 'telemetry.economy', query({ h: hours }), q => ({ hours: q.h })],
	['anomalies', 'anomalies', 'telemetry.economy', query({ h: hours, min: { type: 'integer', minimum: 0 } }), q => ({ hours: q.h, min: q.min })],
	['inflation', 'inflation', 'telemetry.economy', query({ d: { type: 'integer', minimum: 7, maximum: 365 } }), q => ({ days: q.d })],
	['trace', 'trace', 'telemetry.economy', withCid({ ts: { type: 'string', maxLength: 40 }, min: { type: 'integer', minimum: 5, maximum: 720 } }), q => ({ cid: q.cid, ts: q.ts, min: q.min })],
	['logs', 'logs', 'telemetry.logs', query({ q: { type: 'string', maxLength: 100 }, level: { type: 'string', maxLength: 10 } }), q => ({ q: q.q, level: q.level })],
];

const announceBody = {
	type: 'object',
	properties: {
		type: { type: 'string', enum: ['announce'] },
		payload: {
			type: 'object',
			properties: {
				message: { type: 'string', minLength: 1, maxLength: 500 },
				title: { type: 'string', maxLength: 60 },
				mode: { type: 'string', enum: ['chat', 'notify', 'both'] },
				type: { type: 'string', enum: ['inform', 'success', 'warning', 'error'] },
				duration: { type: 'integer', minimum: 3000, maximum: 60000 },
			},
			required: ['message'],
		},
	},
	required: ['payload'],
};

const configBody = {
	type: 'object',
	properties: {
		ingestToken: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 200 }] },
		fivemBase: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 300 }] },
		alerts: {
			type: 'object',
			properties: {
				errors5min: { type: 'integer', minimum: 1, maximum: 100000 },
				moneyJump: { type: 'integer', minimum: 1 },
				anticheatChannel: { type: 'string', maxLength: 60 },
			},
			additionalProperties: false,
		},
		retention: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 3650 } },
		timezone: { type: 'string', maxLength: 64 },
	},
	additionalProperties: false,
};

const KEEP_ALIVE_MS = 20_000;

export function registerTelemetryRoutes(app, { core }) {
	const { telemetry } = core;

	for (const [path, method, permission, schema, params] of VIEWS) {
		app.get(`/api/telemetry/${path}`, { config: { permission }, schema: { querystring: schema } }, async request => telemetry[method](request.actor, params(request.query ?? {})));
	}

	app.get('/api/telemetry/commands', { config: { permission: 'telemetry.view' } }, async request => telemetry.listCommands(request.actor));
	app.post('/api/telemetry/commands', { config: { permission: 'telemetry.announce' }, schema: { body: announceBody } }, async request => (
		telemetry.createCommand(request.actor, request.body, { authorName: request.session?.username ?? null })
	));

	app.get('/api/telemetry/config', { config: { permission: 'telemetry.manage' } }, async request => telemetry.config(request.actor));
	app.put('/api/telemetry/config', { config: { permission: 'telemetry.manage' }, schema: { body: configBody } }, async request => telemetry.setConfig(request.actor, request.body));
	// The new token is shown once: panel only
	app.post('/api/telemetry/config/token', { config: { permission: 'telemetry.manage', apiKey: false } }, async request => telemetry.generateIngestToken(request.actor));

	// Live feed (Server-Sent Events): { status, logs, chat, sessions, deaths, alerts } every 3 s
	app.get('/api/telemetry/stream', { config: { permission: 'telemetry.view' } }, (request, reply) => {
		reply.hijack();
		const res = reply.raw;
		res.writeHead(200, {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
			'X-Content-Type-Options': 'nosniff',
		});
		res.write('retry: 5000\n: ok\n\n');
		let unsubscribe = () => undefined;
		const ping = setInterval(() => res.write(': ping\n\n'), KEEP_ALIVE_MS);
		const close = () => {
			clearInterval(ping);
			unsubscribe();
		};
		request.raw.on('close', close);
		try {
			unsubscribe = telemetry.subscribe(request.actor, payload => {
				if (!res.writableEnded) res.write(`event: tick\ndata: ${JSON.stringify(payload)}\n\n`);
			});
		}
		catch {
			close();
			res.end();
		}
	});
}

// What bl_telemetry calls (outside /api, so the panel guard does not apply): the ingest token is checked here,
// before the body is even read. Answers exactly as bl-panel-api did.
export function registerTelemetryIngestRoutes(app, { core, logger = console }) {
	const { telemetry } = core;

	app.register(async (scope) => {
		// Batches reach 5 MB; an empty or broken body is not a Fastify error here (bl-panel-api read them as {})
		scope.removeAllContentTypeParsers();
		scope.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 }, (request, body, done) => {
			if (!body) return done(null, {});
			try {
				done(null, JSON.parse(body));
			}
			catch {
				done(null, undefined);
			}
		});

		const authorized = async (request, reply) => {
			if (!await telemetry.checkIngest(request.headers.authorization)) {
				return reply.code(401).header('Cache-Control', 'no-store').send({ error: 'unauthorized' });
			}
		};
		const fail = (reply, error) => {
			logger.error?.('Telemetry ingest failed:', error);
			return reply.code(500).send({ error: 'internal' });
		};

		scope.post('/v1/batch', { onRequest: authorized, bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
			if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return reply.code(400).send({ error: 'bad request' });
			try {
				// bl_telemetry 1.3+: results of the announcements in the batch, new announcements in the answer (?commands=1)
				return await telemetry.ingestBatch(request.body, { withCommands: String(request.query?.commands) === '1' });
			}
			catch (error) {
				return fail(reply, error);
			}
		});

		scope.get('/v1/commands', { onRequest: authorized }, async (request, reply) => {
			try {
				return { commands: await telemetry.pullCommands() };
			}
			catch (error) {
				return fail(reply, error);
			}
		});

		// Mirror of the game's database (bl_telemetry server/mirror.lua): where each table is, then the changes
		scope.get('/v1/mirror/state', { onRequest: authorized }, async (request, reply) => {
			try {
				return { tables: await core.fivemMirror.state() };
			}
			catch (error) {
				return fail(reply, error);
			}
		});

		scope.post('/v1/mirror', { onRequest: authorized, bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
			if (!request.body || typeof request.body !== 'object' || !Array.isArray(request.body.tables)) return reply.code(400).send({ error: 'bad request' });
			try {
				return await core.fivemMirror.apply(request.body);
			}
			catch (error) {
				return fail(reply, error);
			}
		});

		scope.post('/v1/commands/:id/ack', { onRequest: authorized }, async (request, reply) => {
			if (!/^\d+$/.test(request.params.id)) return reply.code(404).send({ error: 'inconnu' });
			const body = request.body && typeof request.body === 'object' ? request.body : {};
			try {
				await telemetry.ackCommand(request.params.id, body.ok, body.result);
				return { ok: true };
			}
			catch (error) {
				return fail(reply, error);
			}
		});
	});
}
