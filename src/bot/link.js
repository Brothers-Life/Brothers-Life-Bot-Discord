// Bot side of the internal link with the API (split deployment). The bot dials the API (API_URL + /internal/bot,
// INTERNAL_TOKEN) and keeps that websocket open: over it, it carries out the API's Discord actions and the calls
// to the services living in the bot, and streams what the panel shows live. It needs no open port.
import WebSocket from 'ws';
import { createPeer } from '../rpc/peer.js';
import { INTERNAL_PATH, MAX_MESSAGE } from '../rpc/socket.js';
import { BOT_SERVICES } from '../core/context.js';
import { requestContext } from '../core/requestContext.js';

const SNAPSHOT_MS = 30_000;
const RETRY_MS = [1000, 2000, 5000, 10_000];
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
	let socket = null;
	let peer = null;
	let closed = false;
	let attempt = 0;
	let retryTimer = null;
	let connected = false;
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

	function broadcast(type, data) {
		try {
			peer?.event(type, data);
		}
		catch (error) {
			logger.warn(`Event ${type} not sent to the API:`, error?.message);
		}
	}

	function scheduleRetry() {
		if (closed || retryTimer) return;
		const delay = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
		retryTimer = setTimeout(() => {
			retryTimer = null;
			dial();
		}, delay);
		retryTimer.unref?.();
	}

	function dial() {
		if (closed) return;
		const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${config.INTERNAL_TOKEN}` }, maxPayload: MAX_MESSAGE, perMessageDeflate: false, handshakeTimeout: 10_000 });
		socket = ws;
		let silence = null;
		const heard = () => {
			clearTimeout(silence);
			silence = setTimeout(() => ws.terminate(), SILENCE_MS);
			silence.unref?.();
		};
		ws.on('open', () => {
			attempt = 0;
			heard();
			peer = createPeer({ send: text => ws.send(text), onCall: call, onEvent, logger });
			connected = true;
			logger.success('Linked to the API');
			broadcast('snapshot', snapshot());
			for (const resolve of waiters) resolve();
			waiters.clear();
		});
		ws.on('ping', heard);
		ws.on('message', (text) => {
			heard();
			peer?.handle(text);
		});
		ws.on('unexpected-response', (req, res) => {
			logger.warn(`The API refused the internal link (HTTP ${res.statusCode}): check INTERNAL_TOKEN and API_URL.`);
		});
		ws.on('error', (error) => {
			if (!connected) logger.debug?.(`Internal link: ${error.message}`);
		});
		ws.on('close', () => {
			clearTimeout(silence);
			if (socket === ws) socket = null;
			if (peer) {
				peer.close(new Error('Link closed'));
				peer = null;
			}
			if (connected) {
				connected = false;
				if (!closed) logger.warn('Lost the link with the API, dialing again…');
			}
			scheduleRetry();
		});
	}

	const unsubscribe = [];
	let timer = null;

	return {
		url,
		get connected() {
			return connected;
		},
		// Resolves once linked (tests, startup logs)
		ready() {
			return connected ? Promise.resolve() : new Promise(resolve => waiters.add(resolve));
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
			const ws = socket;
			if (ws && ws.readyState !== WebSocket.CLOSED) {
				await new Promise((resolve) => {
					ws.once('close', resolve);
					ws.close();
					setTimeout(() => {
						ws.terminate();
						resolve();
					}, 2000).unref?.();
				});
			}
		},
	};
}
