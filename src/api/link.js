// API side of the internal link with the bot (split deployment): a Discord executor and stand-ins for the
// services living in the bot, live events relayed to the panel, the bot's process controls.
import { EventEmitter } from 'node:events';
import { createRpcClient, remoteObject } from '../rpc/client.js';

// Subscriptions answered here from the bot's event stream: service -> [method, event]
const SUBSCRIPTIONS = { tickets: ['subscribe', 'tickets'], dms: ['subscribe', 'dms'], music: ['onChange', 'music'], customCommands: ['onChange', null] };
// Pure synchronous helpers of bot services, run on the local copy
const LOCAL_METHODS = { tickets: new Set(['priorities']) };

export function createApiLink({ config, consoleLog, logger }) {
	const rpc = createRpcClient({ url: config.BOT_URL, token: config.INTERNAL_TOKEN, logger });
	const bridge = new EventEmitter();
	bridge.setMaxListeners(0);
	let snapshot = { botUserId: null, status: { ready: false, ping: null, guilds: 0, uptime: null, user: null }, icons: {}, runtime: null, install: null };
	let core = null;

	rpc.events.on('snapshot', (data) => {
		snapshot = data;
	});
	for (const type of ['tickets', 'dms', 'music']) rpc.events.on(type, data => bridge.emit(type, data));
	rpc.events.on('notification', data => core?.notifications.relay(data));
	rpc.events.on('console', line => consoleLog.ingest(line, 'bot'));
	rpc.events.on('audit', entry => core?.remoteAudit(entry).catch(error => logger.warn('Bot change not applied here:', error?.message)));
	rpc.events.on('connected', () => logger.success('Linked to the bot'));

	// Discord actions are done by the bot; the few synchronous answers come from its last snapshot
	const executor = remoteObject(rpc, 'executor', {
		local: {
			botUserId: () => snapshot.botUserId,
			status: () => ({ ...snapshot.status, ready: rpc.connected && snapshot.status.ready }),
			guildIcon: guildId => snapshot.icons[guildId] ?? null,
			guildIds: () => Object.keys(snapshot.icons),
			music: null,
			musicResolver: null,
		},
	});

	// Stand-in of a bot service: every method is carried out by the bot
	function remote(name, local) {
		const subscription = SUBSCRIPTIONS[name];
		return new Proxy(local, {
			get(target, prop) {
				if (typeof prop !== 'string' || prop === 'then') return undefined;
				if (subscription && prop === subscription[0]) {
					return (listener) => {
						if (!subscription[1]) return () => undefined;
						bridge.on(subscription[1], listener);
						return () => bridge.off(subscription[1], listener);
					};
				}
				const value = target[prop];
				if (typeof value !== 'function') return value;
				if (LOCAL_METHODS[name]?.has(prop)) return value.bind(target);
				return (...args) => rpc.call('service', prop, args, name);
			},
		});
	}

	// Restart / stop / install of the bot process, asked from the panel
	const botRuntime = {
		info: () => snapshot.runtime,
		installState: () => snapshot.install,
		restart: () => rpc.call('runtime', 'restart'),
		stop: () => rpc.call('runtime', 'stop'),
		install: payload => rpc.call('runtime', 'install', [payload]),
	};

	return {
		rpc,
		executor,
		remote,
		botRuntime,
		get connected() {
			return rpc.connected;
		},
		attach(attached) {
			core = attached;
			// Changes made from the panel reach the bot (caches, staff resync, new servers…)
			core.audit.onRecord(entry => rpc.emit('audit', entry).catch(() => undefined));
		},
		start() {
			rpc.start();
		},
		close() {
			rpc.close();
		},
	};
}
