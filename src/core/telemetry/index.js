import crypto from 'node:crypto';
import { definePermission } from '../permissions.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { blockedUrl } from '../netGuard.js';
import { createIngest } from './ingest.js';
import { createPerf } from './perf.js';
import { createViews } from './views.js';
import { createCommands } from './commands.js';
import { createAlerts, ALERT_KINDS } from './alerts.js';
import { scrub } from './privacy.js';

// FiveM telemetry, port of the bl-panel-api service: the bl_telemetry resource of the game server sends its
// data in batches (POST /v1/batch, ingest token), the bot scrapes /perf/ and /dynamic.json of the server,
// raises alerts (anticheat, server down, console errors, money jumps) and the panel reads the views.
// Not a BOT_SERVICES service: every process works on the database; only the bot runs the ticks.

definePermission('telemetry.view', { label: 'Télémétrie FiveM : voir les données du jeu', category: 'Télémétrie FiveM' });
definePermission('telemetry.economy', { label: 'Télémétrie FiveM : argent, inflation, sauts d’argent, traces', category: 'Télémétrie FiveM' });
definePermission('telemetry.logs', { label: 'Télémétrie FiveM : console, chat, journaux du jeu', category: 'Télémétrie FiveM' });
definePermission('telemetry.announce', { label: 'Télémétrie FiveM : annonces en jeu', category: 'Télémétrie FiveM' });
definePermission('telemetry.manage', { label: 'Télémétrie FiveM : réglages, jeton d’ingestion', category: 'Télémétrie FiveM' });

export const SETTINGS_KEY = 'telemetry.config';
export const STREAM_INTERVAL_MS = 3000;
// Tables purged by age and their default retention (days), as RETENTION_* of bl-panel-api
export const RETENTION_DEFAULTS = {
	events: 365, server_logs: 30, perf_metrics: 90, player_snapshots: 180, economy_snapshots: 365, vehicles_owned: 365,
	alerts: 365, db_table_stats: 365, commands: 365, perf_windows: 90, perf_buckets: 90, profiler_runs: 90,
};
const ALERT_DEFAULTS = { errors5min: 25, moneyJump: 1_000_000, anticheatChannel: 'anticheat' };
const DEFAULT_TIMEZONE = 'Europe/Paris';
const CONFIG_TTL_MS = 15_000;
const PURGE_BATCH = 50_000;

export function defaultConfig() {
	return { ingestToken: null, fivemBase: null, alerts: { ...ALERT_DEFAULTS }, retention: { ...RETENTION_DEFAULTS }, timezone: DEFAULT_TIMEZONE };
}

function validTimezone(tz) {
	if (typeof tz !== 'string' || !/^[A-Za-z_/+-]{1,64}$/.test(tz)) return false;
	try {
		new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
		return true;
	}
	catch {
		return false;
	}
}

// Bearer <token>, or Basic base64(user:token) as bl-panel-api accepted
export function tokenFromHeader(header) {
	const h = String(header ?? '');
	if (h.startsWith('Bearer ')) return h.slice(7);
	if (h.startsWith('Basic ')) {
		try {
			const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
			return decoded.slice(decoded.indexOf(':') + 1);
		}
		catch {
			return null;
		}
	}
	return null;
}

// Constant time: both sides hashed to the same length first
function sameSecret(given, expected) {
	const a = crypto.createHash('sha256').update(String(given)).digest();
	const b = crypto.createHash('sha256').update(String(expected)).digest();
	return crypto.timingSafeEqual(a, b);
}

function parsePerf(body) {
	const metrics = [];
	const buckets = {};
	const sums = {};
	const counts = {};
	for (const line of body.split('\n')) {
		let m;
		if ((m = line.match(/^tickTime_bucket\{name="([^"]+)",le="([^"]+)"\} ([0-9.e+]+)/))) {
			(buckets[m[1]] = buckets[m[1]] || []).push({ le: parseFloat(m[2]), v: parseFloat(m[3]) });
		}
		else if ((m = line.match(/^tickTime_sum\{name="([^"]+)"\} ([0-9.e+-]+)/))) {sums[m[1]] = parseFloat(m[2]);}
		else if ((m = line.match(/^tickTime_count\{name="([^"]+)"\} ([0-9.e+]+)/))) {counts[m[1]] = parseFloat(m[2]);}
	}
	for (const [name, bs] of Object.entries(buckets)) {
		bs.sort((a, b) => a.le - b.le);
		metrics.push({ metric: 'tick_count', thread: name, value: counts[name] || 0 });
		metrics.push({ metric: 'tick_sum_sec', thread: name, value: sums[name] || 0 });
		for (const b of bs) if (Number.isFinite(b.le)) metrics.push({ metric: 'tick_bucket', thread: name, le: b.le, value: b.v });
	}
	return metrics;
}

export { parsePerf };

export function createTelemetry({ db, settings, logs, notifications, audit, config = {}, logger = console, fetchImpl = fetch, now = Date.now }) {
	// Errors are logged and give no rows, as in bl-panel-api: one broken event never loses the batch
	const q = (text, values) => db.raw(text, values).catch((error) => {
		logger.warn?.(`Telemetry query failed: ${error.message} (${String(text).trim().slice(0, 60)})`);
		return { rows: [], rowCount: 0 };
	});
	const raw = (text, values) => db.raw(text, values);

	logs?.registerCategory?.('telemetry', 'FiveM — alertes (anticheat, serveur, argent)', ALERT_KINDS);

	// core.notifications may be created after this service: looked up when an alert is sent
	let typeRegistered = false;
	function notifier() {
		const n = typeof notifications === 'function' ? notifications() : notifications;
		if (n && !typeRegistered && typeof n.registerType === 'function') {
			n.registerType('telemetry_alert', { label: 'Alertes de la télémétrie FiveM', permission: 'telemetry.view' });
			typeRegistered = true;
		}
		return n;
	}
	notifier();
	function notify(notification) {
		const n = notifier();
		if (!n?.push) return;
		Promise.resolve()
			.then(() => n.push(notification))
			.catch(error => logger.warn?.('Telemetry notification failed:', error?.message ?? error));
	}

	/* ------------------------------ configuration ------------------------------ */

	let cached = null;
	async function getConfig() {
		if (cached && now() - cached.at < CONFIG_TTL_MS) return cached.value;
		const stored = await settings.get(SETTINGS_KEY, null);
		const base = defaultConfig();
		const value = {
			...base,
			...stored,
			alerts: { ...base.alerts, ...stored?.alerts },
			retention: { ...base.retention, ...stored?.retention },
		};
		if (!value.ingestToken && config.TELEMETRY_INGEST_TOKEN) value.ingestToken = config.TELEMETRY_INGEST_TOKEN;
		if (!value.fivemBase && config.TELEMETRY_FIVEM_BASE) value.fivemBase = config.TELEMETRY_FIVEM_BASE;
		if (!validTimezone(value.timezone)) value.timezone = DEFAULT_TIMEZONE;
		cached = { at: now(), value };
		return value;
	}
	const timezone = async () => (await getConfig()).timezone.replace(/[^A-Za-z_/+-]/g, '');

	// What the panel sees: never the token itself
	function publicConfig(cfg) {
		const { ingestToken, ...rest } = cfg;
		return { ...rest, hasIngestToken: Boolean(ingestToken), ingestTokenEnd: ingestToken ? ingestToken.slice(-4) : null };
	}

	function need(actor, permission) {
		if (!actor?.can?.(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	async function record(actor, action, details = null) {
		await audit?.record({ actorId: actor.id, source: actor.source ?? 'panel', action, details });
	}

	/* --------------------------------- modules --------------------------------- */

	const alerts = createAlerts({ q, getConfig, logs, notify, now, logger });
	const perf = createPerf({ q });
	const ingest = createIngest({ q, perf, raiseAlert: alerts.raiseAlert, now });
	const views = createViews({ q, getConfig, timezone, now });
	const commands = createCommands({ q, raw });

	// A read view: permission checked, identifiers scrubbed from the answer
	const view = (permission, fn) => async (actor, params = {}) => {
		need(actor, permission);
		return scrub(await fn(params, actor));
	};

	/* ---------------------------------- scraper --------------------------------- */

	let lastScrapeOk = null;
	async function scrapeOnce() {
		const { fivemBase } = await getConfig();
		if (!fivemBase) return false;
		const base = fivemBase.replace(/\/+$/, '');
		const ts = now();
		const insert = r => q('INSERT INTO tel_perf_metrics (ts, metric, thread, le, value) VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5)', r);
		try {
			const [perfR, dynR] = await Promise.all([
				fetchImpl(`${base}/perf/`, { signal: AbortSignal.timeout(8000), redirect: 'error' }),
				fetchImpl(`${base}/dynamic.json`, { signal: AbortSignal.timeout(8000), redirect: 'error' }),
			]);
			const rows = [];
			if (perfR.ok) for (const p of parsePerf(await perfR.text())) rows.push([ts, p.metric, p.thread || null, p.le ?? null, p.value]);
			if (dynR.ok) {
				const dyn = await dynR.json();
				rows.push([ts, 'players_online', null, null, parseInt(dyn.clients, 10) || 0]);
				rows.push([ts, 'players_max', null, null, parseInt(dyn.sv_maxclients, 10) || 0]);
			}
			rows.push([ts, 'server_up', null, null, perfR.ok ? 1 : 0]);
			for (const r of rows) await insert(r);
			lastScrapeOk = ts;
		}
		catch {
			await insert([ts, 'server_up', null, null, 0]);
		}
		return true;
	}

	/* ---------------------------------- purge ---------------------------------- */

	async function purgeOld() {
		const { retention } = await getConfig();
		const removed = {};
		for (const table of Object.keys(RETENTION_DEFAULTS)) {
			const days = Math.max(1, parseInt(retention[table], 10) || RETENTION_DEFAULTS[table]);
			removed[table] = 0;
			// By batches of 50,000 rows so that the database is never blocked
			for (let i = 0; i < 400; i++) {
				const r = await q(`DELETE FROM tel_${table} WHERE ctid IN (SELECT ctid FROM tel_${table} WHERE ts < now() - make_interval(days => $1) LIMIT ${PURGE_BATCH})`, [days]);
				removed[table] += r.rowCount || 0;
				if ((r.rowCount || 0) < PURGE_BATCH) break;
			}
		}
		return removed;
	}

	/* ------------------------------- live feed ------------------------------- */

	const subscribers = new Set();
	const cursor = { log: null, chat: null, session: null, death: null, alert: null };
	let streamTimer = null;
	let streaming = false;
	const maxId = async table => Number((await q(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`)).rows[0]?.id || 0);

	async function streamTick() {
		if (!subscribers.size || streaming) return;
		streaming = true;
		try {
			const c = cursor;
			if (c.log === null) {
				[c.log, c.chat, c.session, c.death, c.alert] = await Promise.all(['tel_server_logs', 'tel_events', 'tel_sessions', 'tel_deaths', 'tel_alerts'].map(maxId));
			}
			// Events (chat) move fast: bounded by the current max so that no line is scanned twice or missed
			const lastEvent = await maxId('tel_events');
			const [logLines, chat, sessions, deaths, newAlerts, status] = await Promise.all([
				q('SELECT id, ts, channel, level, line FROM tel_server_logs WHERE id > $1 ORDER BY id LIMIT 100', [c.log]),
				q('SELECT id, ts, player_name, citizenid, subtype, data->>\'message\' AS message FROM tel_events WHERE id > $1 AND id <= $2 AND subtype IN (\'chat\', \'command\') ORDER BY id LIMIT 100', [c.chat, lastEvent]),
				q('SELECT id, start_ts AS ts, player_name, citizenid FROM tel_sessions WHERE id > $1 ORDER BY id LIMIT 50', [c.session]),
				q('SELECT id, ts, player_name, citizenid, cause, killer_name, weapon FROM tel_deaths WHERE id > $1 ORDER BY id LIMIT 50', [c.death]),
				q('SELECT id, ts, kind, severity, title, detail FROM tel_alerts WHERE id > $1 ORDER BY id LIMIT 20', [c.alert]),
				q(`SELECT (SELECT value FROM tel_perf_metrics WHERE metric = 'players_online' ORDER BY ts DESC LIMIT 1) AS online,
					(SELECT value FROM tel_perf_metrics WHERE metric = 'players_max' ORDER BY ts DESC LIMIT 1) AS max,
					(SELECT value FROM tel_perf_metrics WHERE metric = 'server_up' ORDER BY ts DESC LIMIT 1) AS up`),
			]);
			if (logLines.rows.length) c.log = Number(logLines.rows.at(-1).id);
			c.chat = chat.rows.length === 100 ? Number(chat.rows[99].id) : lastEvent;
			if (sessions.rows.length) c.session = Number(sessions.rows.at(-1).id);
			if (deaths.rows.length) c.death = Number(deaths.rows.at(-1).id);
			if (newAlerts.rows.length) c.alert = Number(newAlerts.rows.at(-1).id);
			const payload = scrub({ status: status.rows[0] || {}, logs: logLines.rows, chat: chat.rows, sessions: sessions.rows, deaths: deaths.rows, alerts: newAlerts.rows });
			const withoutLogs = { ...payload, logs: [], chat: [] };
			for (const s of subscribers) {
				try {
					s.listener(s.actor.can('telemetry.logs') ? payload : withoutLogs);
				}
				catch (error) {
					logger.warn?.('Telemetry stream listener failed:', error?.message ?? error);
				}
			}
		}
		finally {
			streaming = false;
		}
	}

	function stopStream() {
		clearInterval(streamTimer);
		streamTimer = null;
		for (const k of Object.keys(cursor)) cursor[k] = null;
	}

	/* --------------------------------- service --------------------------------- */

	const service = {
		/* ----- ingestion (bl_telemetry, outside /api) ----- */

		// Whether an Authorization header carries the ingest token
		async checkIngest(authorization) {
			const given = tokenFromHeader(authorization);
			if (!given) return false;
			const { ingestToken } = await getConfig();
			if (!ingestToken) return false;
			return sameSecret(given, ingestToken);
		},

		// POST /v1/batch: events, console lines, results of the announcements (acks); `withCommands` adds the pending ones
		async ingestBatch(body, { withCommands = false } = {}) {
			if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Lot invalide.');
			const out = await ingest.batch(body);
			if (Array.isArray(body.acks)) for (const a of body.acks.slice(0, 50)) await commands.ack(a?.id, a?.ok, a?.result);
			if (withCommands) out.commands = await commands.pull();
			return out;
		},
		pullCommands: () => commands.pull(),
		ackCommand: (id, ok, result) => commands.ack(id, ok, result),

		/* ----- read views ----- */

		overview: view('telemetry.view', p => views.overview(p)),
		players: view('telemetry.view', p => views.players(p)),
		player: view('telemetry.view', p => views.player(p)),
		admin: view('telemetry.view', () => views.admin()),
		deathmap: view('telemetry.view', p => views.deathmap(p)),
		insights: view('telemetry.view', p => views.insights(p)),
		timeline: view('telemetry.view', p => views.timeline(p)),
		linked: view('telemetry.view', p => views.linked(p)),
		search: view('telemetry.view', (p, actor) => views.search({ ...p, withLogs: actor.can('telemetry.logs') })),
		scripts: view('telemetry.view', () => views.scripts()),
		staff: view('telemetry.view', p => views.staff(p)),
		perf: view('telemetry.view', p => perf.perf(p)),
		db: view('telemetry.view', () => views.db()),
		economy: view('telemetry.economy', p => views.economy(p)),
		anomalies: view('telemetry.economy', p => views.anomalies(p)),
		inflation: view('telemetry.economy', p => views.inflation(p)),
		trace: view('telemetry.economy', p => views.trace(p)),
		logs: view('telemetry.logs', p => views.logs(p)),
		alerts: view('telemetry.view', () => views.alerts()),
		listCommands: view('telemetry.view', () => commands.list()),

		/* ----- announcements in game ----- */

		// authorName: how the author shows in the list and the staff view (the panel username)
		async createCommand(actor, input, { authorName = null } = {}) {
			need(actor, 'telemetry.announce');
			if (input?.type !== undefined && input.type !== 'announce') throw new ValidationError('Ordre inconnu.');
			const { id, payload } = await commands.announce(input?.payload ?? input, authorName || actor.id);
			await record(actor, 'telemetry.announce', { message: payload.message, title: payload.title, mode: payload.mode });
			return { ok: true, id };
		},

		/* ----- configuration ----- */

		async config(actor) {
			need(actor, 'telemetry.manage');
			return publicConfig(await getConfig());
		},

		async setConfig(actor, input = {}) {
			need(actor, 'telemetry.manage');
			const stored = { ...defaultConfig(), ...await settings.get(SETTINGS_KEY, {}) };
			const next = { ...stored, alerts: { ...ALERT_DEFAULTS, ...stored.alerts }, retention: { ...RETENTION_DEFAULTS, ...stored.retention } };
			const changed = [];
			if (input.ingestToken !== undefined) {
				if (input.ingestToken === null || input.ingestToken === '') {next.ingestToken = null;}
				else {
					const token = String(input.ingestToken).trim();
					if (token.length < 16 || token.length > 200 || /\s/.test(token)) throw new ValidationError('Le jeton d’ingestion doit faire entre 16 et 200 caractères, sans espace.');
					next.ingestToken = token;
				}
				changed.push('jeton d’ingestion');
			}
			if (input.fivemBase !== undefined) {
				if (input.fivemBase === null || input.fivemBase === '') {next.fivemBase = null;}
				else {
					const url = String(input.fivemBase).trim().replace(/\/+$/, '');
					let parsed;
					try {
						parsed = new URL(url);
					}
					catch {
						throw new ValidationError('Adresse du serveur FiveM invalide (ex. http://1.2.3.4:30120).');
					}
					if (!['http:', 'https:'].includes(parsed.protocol)) throw new ValidationError('L’adresse du serveur FiveM doit commencer par http:// ou https://.');
					const blocked = blockedUrl(url, { allowPrivate: true });
					if (blocked) throw new ValidationError(`Adresse du serveur FiveM refusée : ${blocked}.`);
					next.fivemBase = url.slice(0, 300);
				}
				changed.push('adresse du serveur');
			}
			if (input.alerts !== undefined) {
				const a = input.alerts ?? {};
				if (a.errors5min !== undefined) {
					const n = Number(a.errors5min);
					if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new ValidationError('Le seuil d’erreurs doit être un entier entre 1 et 100 000.');
					next.alerts.errors5min = n;
				}
				if (a.moneyJump !== undefined) {
					const n = Number(a.moneyJump);
					if (!Number.isInteger(n) || n < 1 || n > 9e15) throw new ValidationError('Le seuil de saut d’argent doit être un entier positif.');
					next.alerts.moneyJump = n;
				}
				if (a.anticheatChannel !== undefined) {
					const channel = String(a.anticheatChannel ?? '').trim();
					if (!/^[\w:.-]{1,60}$/.test(channel)) throw new ValidationError('Canal anticheat invalide (lettres, chiffres, - _ . : seulement).');
					next.alerts.anticheatChannel = channel;
				}
				changed.push('alertes');
			}
			if (input.retention !== undefined) {
				for (const [table, days] of Object.entries(input.retention ?? {})) {
					if (!(table in RETENTION_DEFAULTS)) throw new ValidationError(`Table inconnue : ${table}.`);
					const n = Number(days);
					if (!Number.isInteger(n) || n < 1 || n > 3650) throw new ValidationError('La durée de conservation doit être entre 1 et 3650 jours.');
					next.retention[table] = n;
				}
				changed.push('conservation');
			}
			if (input.timezone !== undefined) {
				if (!validTimezone(input.timezone)) throw new ValidationError('Fuseau horaire inconnu (ex. Europe/Paris).');
				next.timezone = input.timezone;
				changed.push('fuseau horaire');
			}
			await settings.set(SETTINGS_KEY, next);
			cached = null;
			await record(actor, 'telemetry.config', { changes: changed.join(', ') || 'aucun' });
			return publicConfig(await getConfig());
		},

		// A new random ingest token, shown once: to copy into telemetry_token of server.cfg
		async generateIngestToken(actor) {
			need(actor, 'telemetry.manage');
			const token = crypto.randomBytes(32).toString('base64url');
			const stored = await settings.get(SETTINGS_KEY, {});
			await settings.set(SETTINGS_KEY, { ...stored, ingestToken: token });
			cached = null;
			await record(actor, 'telemetry.token');
			return { token };
		},

		/* ----- live feed ----- */

		// listener({ status, logs, chat, sessions, deaths, alerts }) every 3 s; logs and chat need telemetry.logs.
		// Returns the unsubscribe function.
		subscribe(actor, listener) {
			need(actor, 'telemetry.view');
			const entry = { actor, listener };
			subscribers.add(entry);
			if (!streamTimer) {
				const tick = () => streamTick().catch(error => logger.warn?.('Telemetry stream failed:', error?.message ?? error));
				// Sets the cursors at once
				tick();
				streamTimer = setInterval(tick, STREAM_INTERVAL_MS);
				streamTimer.unref?.();
			}
			return () => {
				subscribers.delete(entry);
				if (!subscribers.size) stopStream();
			};
		},

		/* ----- periodic tasks (bot process) ----- */

		// Every 15 s
		scrapeTick: () => scrapeOnce(),
		// Every 60 s
		alertsTick: () => alerts.check(),
		// Daily
		purgeTick: () => purgeOld(),
		// For tests and the status of the page
		health: () => ({ lastScrapeOk }),
		streamTick,
		close() {
			subscribers.clear();
			stopStream();
		},
	};
	return service;
}
