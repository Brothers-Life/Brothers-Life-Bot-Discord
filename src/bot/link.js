// Bot side of the internal link with the API (split deployment). The bot dials the API (API_URL + /internal/bot,
// INTERNAL_TOKEN) and keeps that websocket open: over it, it carries out the API's Discord actions and the calls
// to the services living in the bot, and streams what the panel shows live. It needs no open port.
// When API_URL is a load balancer in front of several API replicas, every dial reaches one of them at random:
// the bot keeps one link per replica (instance id sent by the API) and keeps dialing to find the ones it lacks,
// so that every replica can reach Discord.
import WebSocket from 'ws';
import { createPeer } from '../rpc/peer.js';
import { INTERNAL_PATH, MAX_MESSAGE, INSTANCE_HEADER, LINKED_HEADER } from '../rpc/socket.js';
import { BOT_SERVICES } from '../core/context.js';
import { requestContext } from '../core/requestContext.js';

const SNAPSHOT_MS = 30_000;
const RETRY_MS = [1000, 2000, 5000, 10_000];
// Looking for other replicas: quick dials right after a new link, then one now and then (replicas come and go)
const EXPLORE_FAST_MS = 1000;
const EXPLORE_FAST_TRIES = 8;
const EXPLORE_SLOW_MS = 60_000;
// No ping from the API for this long: the connection is dead, dial again
const SILENCE_MS = 45_000;
// Live subscriptions stay on each side: the bot streams their events instead
const NOT_CALLABLE = new Set(['subscribe', 'onChange', 'on', 'off', 'init', 'recover']);

export function linkUrl(apiUrl) {
	const url = new URL(INTERNAL_PATH, apiUrl.replace(/\/+$/, '') + '/');
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

export function createBotLink({ config, core, executor, runtime, consoleLog, logger }) {
	if (!config.INTERNAL_TOKEN || config.INTERNAL_TOKEN.length < 32) throw new Error('INTERNAL_TOKEN must be set (32 characters or more) to link the bot and the API.');
	const url = linkUrl(config.API_URL);
	// instance id -> { ws, peer }; an API without instance ids (older version) is a single link
	const links = new Map();
	const sockets = new Set();
	let closed = false;
	let dialing = false;
	let attempt = 0;
	let duplicates = 0;
	let retryTimer = null;
	let retryAt = Infinity;
	const waiters = new Set();

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

	function onEvent({ type, data }) {
		// A change made from the panel: refreshed caches, staff resync, new server…
		if (type === 'audit') core.remoteAudit(data).catch(error => logger.warn('Panel change not applied here:', error?.message));
	}

	function send(peer, type, data) {
		try {
			peer.event(type, data);
		}
		catch (error) {
			logger.warn(`Event ${type} not sent to the API:`, error?.message);
		}
	}

	function broadcast(type, data) {
		for (const { peer } of links.values()) send(peer, type, data);
	}

	// One pending dial at a time; a sooner one replaces a later one
	function schedule(delay) {
		if (closed) return;
		const at = Date.now() + delay;
		if (retryTimer && retryAt <= at) return;
		clearTimeout(retryTimer);
		retryAt = at;
		retryTimer = setTimeout(() => {
			retryTimer = null;
			retryAt = Infinity;
			dial();
		}, delay);
		retryTimer.unref?.();
	}

	// After a dial: no link at all -> back off; linked -> look for the replicas not linked yet
	function next() {
		if (!links.size) return schedule(RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
		if (links.has(null)) return;
		schedule(duplicates < EXPLORE_FAST_TRIES ? EXPLORE_FAST_MS : EXPLORE_SLOW_MS);
	}

	function dial() {
		if (closed || dialing) return;
		dialing = true;
		const linked = [...links.keys()].filter(Boolean);
		const headers = { Authorization: `Bearer ${config.INTERNAL_TOKEN}` };
		if (linked.length) headers[LINKED_HEADER] = linked.join(',');
		const ws = new WebSocket(url, { headers, maxPayload: MAX_MESSAGE, perMessageDeflate: false, handshakeTimeout: 10_000 });
		sockets.add(ws);
		let instance = null;
		let link = null;
		let silence = null;
		const heard = () => {
			clearTimeout(silence);
			silence = setTimeout(() => ws.terminate(), SILENCE_MS);
			silence.unref?.();
		};
		ws.on('upgrade', (res) => {
			instance = res.headers[INSTANCE_HEADER] || null;
		});
		ws.on('open', () => {
			dialing = false;
			// Raced with another dial to the same replica, or an older API (no id) while already linked
			if (links.has(instance) || (instance === null && links.size)) {
				duplicates++;
				ws.close();
				return;
			}
			attempt = 0;
			duplicates = 0;
			heard();
			const peer = createPeer({ send: text => ws.send(text), onCall: call, onEvent, logger });
			link = { ws, peer };
			links.set(instance, link);
			logger.success(instance ? `Linked to the API (instance ${instance.slice(0, 8)}, ${links.size} link(s))` : 'Linked to the API');
			send(peer, 'snapshot', snapshot());
			for (const resolve of waiters) resolve();
			waiters.clear();
			next();
		});
		ws.on('ping', heard);
		ws.on('message', (text) => {
			heard();
			link?.peer.handle(text);
		});
		ws.on('unexpected-response', (req, res) => {
			// This replica is already linked: keep looking for the others
			if (res.statusCode === 409) duplicates++;
			else logger.warn(`The API refused the internal link (HTTP ${res.statusCode}): check INTERNAL_TOKEN and API_URL.`);
			// Ends the handshake: 'close' follows and the next dial is scheduled
			ws.terminate();
		});
		ws.on('error', (error) => {
			if (!links.size) logger.debug?.(`Internal link: ${error.message}`);
		});
		ws.on('close', () => {
			clearTimeout(silence);
			sockets.delete(ws);
			if (!link) {
				dialing = false;
				next();
				return;
			}
			link.peer.close(new Error('Link closed'));
			if (links.get(instance) === link) links.delete(instance);
			if (closed) return;
			logger.warn(links.size ? `Lost a link with the API (${links.size} left), dialing again…` : 'Lost the link with the API, dialing again…');
			duplicates = 0;
			next();
		});
	}

	const unsubscribe = [];
	let timer = null;

	return {
		url,
		get connected() {
			return links.size > 0;
		},
		// Number of API replicas linked
		get links() {
			return links.size;
		},
		// Resolves once linked (tests, startup logs)
		ready() {
			return links.size ? Promise.resolve() : new Promise(resolve => waiters.add(resolve));
		},
		start() {
			closed = false;
			const forward = type => data => broadcast(type, data);
			unsubscribe.push(
				core.tickets.subscribe(forward('tickets')),
				core.dms.subscribe(forward('dms')),
				core.music.onChange(forward('music')),
				core.notifications.subscribe(forward('notification')),
				core.audit.onRecord(forward('audit')),
				// Lines of this process only (not the ones it got from elsewhere)
				consoleLog.subscribe(line => !line.origin && broadcast('console', line)),
			);
			timer = setInterval(() => broadcast('snapshot', snapshot()), SNAPSHOT_MS);
			timer.unref();
			logger.info(`Internal link: dialing ${url}`);
			dial();
		},
		// Right away (guilds joined or left, bot ready…)
		pushSnapshot() {
			broadcast('snapshot', snapshot());
		},
		async close() {
			closed = true;
			clearInterval(timer);
			clearTimeout(retryTimer);
			unsubscribe.splice(0).forEach(fn => fn());
			await Promise.all([...sockets].filter(ws => ws.readyState !== WebSocket.CLOSED).map(ws => new Promise((resolve) => {
				ws.once('close', resolve);
				if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
				else ws.close();
				setTimeout(() => {
					ws.terminate();
					resolve();
				}, 2000).unref?.();
			})));
			links.clear();
		},
	};
}
