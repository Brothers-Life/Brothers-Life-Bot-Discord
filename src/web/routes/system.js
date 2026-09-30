import { authenticate } from '../guard.js';

const PERMISSION_RECHECK_MS = 30_000;

// Console, restart/stop and versions: everything that talks to launcher.js through `runtime`
export function registerSystemRoutes(app, { core, runtime, consoleLog, versions }) {
	const confirmBody = { type: 'object', properties: { confirm: { type: 'boolean' } } };

	// --- Live console (WebSocket) ---------------------------------------------------------------
	app.get('/api/console', { websocket: true, config: { permission: 'console.view' } }, (socket, request) => {
		// preHandler already checked session + console.view for the upgrade request
		const send = (payload) => {
			if (socket.readyState === 1) socket.send(JSON.stringify(payload));
		};
		send({ type: 'history', lines: consoleLog.lines() });
		const unsubscribe = consoleLog.subscribe(line => send({ type: 'line', line }));

		// Close as soon as the session expires or the permission is removed
		const recheck = setInterval(async () => {
			const actor = await authenticate(request, core).catch(() => null);
			if (!actor?.can('panel.access') || !actor.can('console.view')) socket.close(4003, 'Forbidden');
		}, PERMISSION_RECHECK_MS);

		socket.on('close', () => {
			clearInterval(recheck);
			unsubscribe();
		});
		socket.on('message', () => {
			// Read-only console: typing commands is intentionally not supported
		});
	});

	app.post('/api/system/restart', { config: { permission: 'console.control', confirm: true }, schema: { body: confirmBody } }, async (request) => {
		core.audit.record({ actorId: request.actor.id, source: 'panel', action: 'system.restart' });
		setTimeout(() => runtime.restart(), 300);
		return { ok: true, supervised: runtime.info().supervised };
	});

	app.post('/api/system/stop', { config: { permission: 'console.control', confirm: true }, schema: { body: confirmBody } }, async (request) => {
		core.audit.record({ actorId: request.actor.id, source: 'panel', action: 'system.stop' });
		setTimeout(() => runtime.stop(), 300);
		return { ok: true, supervised: runtime.info().supervised };
	});

	// --- Versions -----------------------------------------------------------------------------
	app.get('/api/versions', {
		config: { permission: 'versions.view' },
		schema: { querystring: { type: 'object', properties: { refresh: { type: 'boolean' } } } },
	}, async (request) => {
		return { ...(await versions.describe(Boolean(request.query.refresh))), supervised: runtime.info().supervised, install: runtime.installState() };
	});

	app.post('/api/versions/ignore', {
		config: { permission: 'versions.install' },
		schema: { body: { type: 'object', properties: { version: { type: ['string', 'null'] } }, required: ['version'] } },
	}, async (request) => {
		versions.ignore(request.body.version);
		return { ok: true };
	});

	app.post('/api/versions/install', {
		config: { permission: 'versions.install', confirm: true },
		schema: {
			body: {
				type: 'object',
				properties: { version: { type: 'string', pattern: '^v\\d+\\.\\d+\\.\\d+$' }, confirm: { type: 'boolean' }, acceptDataLoss: { type: 'boolean' } },
				required: ['version'],
			},
		},
	}, async (request, reply) => {
		const { version, acceptDataLoss } = request.body;
		if (!runtime.info().supervised) {
			return reply.code(409).send({ error: { code: 'NOT_SUPERVISED', message: 'Versions can only be installed when the bot runs with launcher.js (npm start).' } });
		}
		const target = await versions.prepareInstall(version);
		if (target.restoreBackup && acceptDataLoss !== true) {
			return reply.code(409).send({
				error: {
					code: 'DATA_LOSS',
					message: `Installing ${version} requires restoring the backup of ${new Date(target.restoreBackup.at).toISOString()}: changes made since then will be lost.`,
					backup: target.restoreBackup,
				},
			});
		}

		core.audit.record({
			actorId: request.actor.id,
			source: 'panel',
			action: 'system.install',
			target: version,
			details: { from: versions.current().version, restoreBackup: target.restoreBackup?.file ?? null },
		});
		runtime.install({ version, assetId: target.release.asset, schemaVersion: target.release.schemaVersion, restoreBackup: target.restoreBackup?.file ?? null });
		return { ok: true };
	});
}
