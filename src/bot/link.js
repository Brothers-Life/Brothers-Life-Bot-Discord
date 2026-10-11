// Bot side of the internal link with the API (split deployment): carries out the API's Discord actions and the
// calls to the services living in the bot, and streams what the panel shows live.
import { createRpcServer } from '../rpc/server.js';
import { BOT_SERVICES } from '../core/context.js';
import { requestContext } from '../core/requestContext.js';

const SNAPSHOT_MS = 30_000;
// Live subscriptions stay on each side: the bot streams their events instead
const NOT_CALLABLE = new Set(['subscribe', 'onChange', 'on', 'off', 'init', 'recover']);
export function createBotLink({ config, core, executor, runtime, consoleLog, logger }) {
	let server = null;

	function snapshot() {
		const icons = {};
		for (const guildId of executor.guildIds?.() ?? []) icons[guildId] = executor.guildIcon?.(guildId) ?? null;
		return { botUserId: executor.botUserId?.() ?? null, status: executor.status(), icons, runtime: runtime.info(), install: runtime.installState() };
	}

	async function call({ target, service, method, args = [] }) {
		if (typeof method !== 'string' || NOT_CALLABLE.has(method) || method.startsWith('_')) throw new Error(`Not callable: ${method}`);
		if (target === 'executor') {
			if (typeof executor[method] !== 'function') throw new Error(`Unknown Discord action: ${method}`);
			return executor[method](...args);
		}
		if (target === 'service') {
			if (!BOT_SERVICES.has(service) || typeof core[service]?.[method] !== 'function') throw new Error(`Unknown service call: ${service}.${method}`);
			// An action made with an API key keeps naming the key in the audit log
			const apiKey = args.find(arg => arg?.apiKey && typeof arg.can === 'function')?.apiKey ?? null;
			return requestContext.run({ apiKey }, () => core[service][method](...args));
		}
		if (target === 'runtime') {
			if (!['info', 'installState', 'restart', 'stop', 'install'].includes(method)) throw new Error(`Unknown runtime call: ${method}`);
			return runtime[method](...args);
		}
		throw new Error(`Unknown target: ${target}`);
	}

	async function emit({ type, data }) {
		// A change made from the panel: refreshed caches, staff resync, new server…
		if (type === 'audit') await core.remoteAudit(data);
	}

	const unsubscribe = [];
	let timer = null;

	return {
		async start() {
			server = createRpcServer({
				token: config.INTERNAL_TOKEN,
				host: config.BOT_RPC_HOST,
				port: config.BOT_RPC_PORT,
				logger,
				handlers: {
					call,
					emit,
					health: async () => ({ ready: executor.status().ready }),
					welcome: async () => [{ type: 'snapshot', data: snapshot() }],
				},
			});
			const address = await server.listen();
			logger.info(`Internal link listening on ${address.address}:${address.port}`);

			const forward = type => data => server.broadcast({ type, data });
			unsubscribe.push(
				core.tickets.subscribe(forward('tickets')),
				core.dms.subscribe(forward('dms')),
				core.music.onChange(forward('music')),
				core.notifications.subscribe(forward('notification')),
				core.audit.onRecord(forward('audit')),
				// Lines of this process only (not the ones it got from elsewhere)
				consoleLog.subscribe(line => !line.origin && server.broadcast({ type: 'console', data: line })),
			);
			timer = setInterval(() => server.broadcast({ type: 'snapshot', data: snapshot() }), SNAPSHOT_MS);
			timer.unref();
			return address;
		},
		// Right away (guilds joined or left, bot ready…)
		pushSnapshot() {
			server?.broadcast({ type: 'snapshot', data: snapshot() });
		},
		async close() {
			clearInterval(timer);
			unsubscribe.forEach(fn => fn());
			await server?.close();
		},
	};
}
