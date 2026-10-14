// API side of the internal link with the bot (split deployment): the bot dials in (src/rpc/socket.js), then the API
// gets a Discord executor and stand-ins for the services living in the bot, live events relayed to the panel,
// and the bot's process controls. While no bot is linked, calls fail with BotUnavailableError (503).
import { EventEmitter } from 'node:events';
import { createPeer, BotUnavailableError } from '../rpc/peer.js';
import { attachInternalLink, remoteObject } from '../rpc/socket.js';

// Subscriptions answered here from the bot's event stream: service -> [method, event]
const SUBSCRIPTIONS = { tickets: ['subscribe', 'tickets'], dms: ['subscribe', 'dms'], music: ['onChange', 'music'], customCommands: ['onChange', null] };
// Pure synchronous helpers of bot services, run on the local copy
const LOCAL_METHODS = { tickets: new Set(['priorities']) };

export function createApiLink({ config, consoleLog, logger }) {
	const events = new EventEmitter();
	events.setMaxListeners(0);
	let snapshot = { botUserId: null, status: { ready: false, ping: null, guilds: 0, uptime: null, user: null }, icons: {}, runtime: null, install: null };
	let core = null;
	// { ws, peer } of the linked bot
	let current = null;
	let attached = null;

	function onEvent({ type, data }) {
		if (type === 'snapshot') snapshot = data;
		else if (type === 'notification') core?.notifications.relay(data);
		else if (type === 'console') consoleLog.ingest(data, 'bot');
		else if (type === 'audit') core?.remoteAudit(data).catch(error => logger.warn('Bot change not applied here:', error?.message));
		events.emit(type, data);
	}

	function accept(ws) {
		// A new bot connection replaces the old one (bot restarted before the old socket timed out)
		if (current) current.ws.terminate();
		const peer = createPeer({ send: text => ws.send(text), onEvent, logger });
		const link = { ws, peer };
		current = link;
		ws.on('message', text => peer.handle(text));
		ws.on('error', error => logger.warn('Internal link error:', error?.message));
		ws.on('close', () => {
			peer.close(new Error('Link closed'));
			if (current !== link) return;
			current = null;
			snapshot = { ...snapshot, status: { ...snapshot.status, ready: false } };
			logger.warn('The bot left the internal link.');
			events.emit('disconnected');
		});
		logger.success('Linked to the bot');
		events.emit('connected');
	}

	const rpc = {
		call(target, method, args = [], service = null) {
			if (!current) return Promise.reject(new BotUnavailableError());
			return current.peer.call(target, method, args, service);
		},
		emit(type, data = null) {
			current?.peer.event(type, data);
		},
	};

	// Discord actions are done by the bot; the few synchronous answers come from its last snapshot
	const executor = remoteObject(rpc, 'executor', {
		local: {
			botUserId: () => snapshot.botUserId,
			status: () => ({ ...snapshot.status, ready: Boolean(current) && snapshot.status.ready }),
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
						events.on(subscription[1], listener);
						return () => events.off(subscription[1], listener);
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
		events,
		executor,
		remote,
		botRuntime,
		get connected() {
			return Boolean(current);
		},
		attach(attachedCore) {
			core = attachedCore;
			// Changes made from the panel reach the bot (caches, staff resync, new servers…)
			core.audit.onRecord((entry) => {
				try {
					rpc.emit('audit', entry);
				}
				catch (error) {
					logger.warn('Panel change not sent to the bot:', error?.message);
				}
			});
		},
		// Takes the bot's connections on the API's HTTP server (before it listens)
		listen(server) {
			attached = attachInternalLink(server, { token: config.INTERNAL_TOKEN, onConnection: accept, logger });
		},
		close() {
			current?.ws.terminate();
			current = null;
			attached?.close();
		},
	};
}
