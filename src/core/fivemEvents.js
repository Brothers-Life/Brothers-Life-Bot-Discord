import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';
import { normalizePayload, normalizeTargets } from './announcements.js';
import { fillPayload } from './onboarding.js';

definePermission('fivem.events', { label: 'Envoyer les événements du serveur FiveM au bot (clé d’API du pont txAdmin)', category: 'FiveM' });
definePermission('fivemevents.view', { label: 'Voir les annonces FiveM (txAdmin), la maintenance et les événements reçus', category: 'FiveM' });
definePermission('fivemevents.manage', { label: 'Régler les annonces FiveM (txAdmin)', category: 'FiveM' });
definePermission('fivemevents.maintenance', { label: 'Activer et terminer la maintenance du serveur FiveM', category: 'FiveM' });

const SNOWFLAKE = /^\d{17,20}$/;
const DUPLICATE_WINDOW_MS = 15_000;
const KEEP_EVENTS = 300;
// txAdmin sends the scheduled restart warning 30, 15, 10, 5, 4, 3, 2 and 1 minutes before
export const RESTART_WARNINGS = [30, 15, 10, 5, 4, 3, 2, 1];
const DEFAULT_THRESHOLDS = [30, 15, 5, 1];

// Events of txAdmin (docs/events.md of citizenfx/txAdmin) + serverStarted, sent by the bridge when it starts.
// public: announced in the chosen channels with a template; staff: a log of the "fivemevents" category.
export const EVENT_TYPES = {
	serverStarted: { label: 'Serveur démarré', kind: 'public' },
	scheduledRestart: { label: 'Redémarrage programmé (compte à rebours)', kind: 'public' },
	scheduledRestartSkipped: { label: 'Redémarrage programmé annulé', kind: 'public' },
	serverShuttingDown: { label: 'Arrêt ou redémarrage du serveur', kind: 'public' },
	announcement: { label: 'Annonce txAdmin', kind: 'public' },
	playerKicked: { label: 'Joueur expulsé', kind: 'staff' },
	playerBanned: { label: 'Joueur banni', kind: 'staff' },
	playerWarned: { label: 'Joueur averti', kind: 'staff' },
	playerDirectMessage: { label: 'Message privé d’un admin', kind: 'staff' },
	playerHealed: { label: 'Joueur soigné', kind: 'staff' },
	actionRevoked: { label: 'Sanction révoquée', kind: 'staff' },
};
// Deprecated names, still sent by txAdmin before v8
export const EVENT_ALIASES = { healedPlayer: 'playerHealed', skippedNextScheduledRestart: 'scheduledRestartSkipped' };

export const TXADMIN_VARIABLES = [
	{ key: 'txadmin.server', label: 'Nom du serveur FiveM (réglé dans le pont)' },
	{ key: 'txadmin.author', label: 'Admin à l’origine de l’action (ou txAdmin)' },
	{ key: 'txadmin.message', label: 'Message (annonce, arrêt)' },
	{ key: 'txadmin.minutes', label: 'Minutes avant le redémarrage' },
	{ key: 'txadmin.restart.at', label: 'Heure du redémarrage (s’affiche à l’heure de chacun)' },
	{ key: 'txadmin.restart.relative', label: 'Redémarrage « dans X minutes » (se met à jour tout seul)' },
	{ key: 'txadmin.shutdown.relative', label: 'Arrêt « dans X secondes »' },
	{ key: 'txadmin.player', label: 'Joueur visé' },
	{ key: 'txadmin.reason', label: 'Raison' },
	{ key: 'txadmin.duration', label: 'Durée du ban' },
];

export const MAINTENANCE_VARIABLES = [
	{ key: 'maintenance.reason', label: 'Raison de la maintenance' },
	{ key: 'maintenance.since', label: 'Début de la maintenance (horodatage Discord)' },
	{ key: 'maintenance.duration', label: 'Durée de la maintenance (message de fin)' },
	{ key: 'maintenance.by', label: 'Qui a lancé la maintenance (mention)' },
];

const embed = (title, description, color, footerText = '') => ({ content: '', embed: { enabled: true, title, description, color, footerText, timestamp: true } });

export const DEFAULT_PAYLOADS = {
	serverStarted: embed('🟢 {txadmin.server} est en ligne', 'Le serveur vient de démarrer : vous pouvez vous connecter !', '#3ba55d'),
	scheduledRestart: embed('🔄 Redémarrage dans {txadmin.minutes} min', 'Le serveur redémarre {txadmin.restart.relative} (à {txadmin.restart.at}).\nMettez-vous en sécurité et terminez vos scènes en cours.', '#ff9628'),
	scheduledRestartSkipped: embed('✅ Redémarrage annulé', 'Le redémarrage prévu a été annulé par {txadmin.author}. Bon jeu !', '#3ba55d'),
	serverShuttingDown: embed('🔴 {txadmin.server} s’arrête', '{txadmin.message}\nArrêt {txadmin.shutdown.relative}.', '#ed4245'),
	announcement: embed('📢 Annonce en jeu', '{txadmin.message}', '#ff9628', 'Par {txadmin.author}'),
};

const DEFAULT_MAINTENANCE = {
	targets: [],
	start: embed('🛠️ Maintenance en cours', '{maintenance.reason}\n\nLe serveur FiveM est en maintenance depuis {maintenance.since}. On vous prévient dès la réouverture !', '#f0b232'),
	end: embed('✅ Fin de la maintenance', 'Le serveur FiveM est de nouveau ouvert, bon jeu ! (maintenance de {maintenance.duration})', '#3ba55d'),
	statusMessages: true,
	mutePublic: true,
};

const SAMPLES = {
	serverStarted: {},
	scheduledRestart: { secondsRemaining: 900 },
	scheduledRestartSkipped: { secondsRemaining: 600, temporary: false, author: 'Admin' },
	serverShuttingDown: { delay: 5000, author: 'Admin', message: 'Le serveur redémarre pour une mise à jour.' },
	announcement: { author: 'Admin', message: 'Ceci est un essai des annonces txAdmin.' },
	playerKicked: { target: 12, targetName: 'Joueur_Test', author: 'Admin', reason: 'Essai' },
	playerBanned: { targetName: 'Joueur_Test', author: 'Admin', reason: 'Essai', durationTranslated: '1 jour', actionId: 'BXXX-XXXX' },
	playerWarned: { targetName: 'Joueur_Test', author: 'Admin', reason: 'Essai', actionId: 'WXXX-XXXX' },
	playerDirectMessage: { target: 12, targetName: 'Joueur_Test', author: 'Admin', message: 'Essai' },
	playerHealed: { target: -1, author: 'Admin' },
	actionRevoked: { actionId: 'BXXX-XXXX', actionType: 'ban', actionReason: 'Essai', actionAuthor: 'Admin', playerName: 'Joueur_Test', revokedBy: 'Admin' },
};

// Text coming from the game: FiveM color codes (^1…) removed, bounded
function text(value, max = 500) {
	if (value === undefined || value === null || value === false) return null;
	const out = String(value).replace(/\^\d/g, '').trim().slice(0, max);
	return out || null;
}

// Only the fields the bot uses: player identifiers, HWIDs and IPs never get stored
export function cleanEventData(data = {}) {
	const n = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	const out = {
		author: text(data.author, 100),
		message: text(data.message, 1500),
		reason: text(data.reason, 500),
		secondsRemaining: n(data.secondsRemaining),
		delay: n(data.delay),
		temporary: typeof data.temporary === 'boolean' ? data.temporary : null,
		target: n(data.target ?? data.targetNetId),
		targetName: text(data.targetName ?? data.playerName, 100),
		targetDiscord: SNOWFLAKE.test(String(data.targetDiscord ?? '')) ? String(data.targetDiscord) : null,
		expiration: n(data.expiration),
		durationTranslated: text(data.durationTranslated, 60),
		actionId: text(data.actionId, 40),
		actionType: text(data.actionType, 30),
		actionReason: text(data.actionReason, 500),
		actionAuthor: text(data.actionAuthor, 100),
		revokedBy: text(data.revokedBy, 100),
	};
	return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
}

const ts = (ms, style) => `<t:${Math.round(ms / 1000)}:${style}>`;

function durationText(ms) {
	const minutes = Math.max(1, Math.round(ms / 60_000));
	const h = Math.floor(minutes / 60);
	return h ? `${h} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

function playerText(d) {
	if (d.target === -1) return 'Tous les joueurs';
	const name = d.targetName ?? (d.target !== undefined ? `ID ${d.target}` : 'inconnu');
	return d.targetDiscord ? `${name} (<@${d.targetDiscord}>)` : name;
}

// {txadmin.*} of an event
export function eventVariables(d, { server, at }) {
	const restartAt = d.secondsRemaining !== undefined ? at + d.secondsRemaining * 1000 : null;
	return {
		'txadmin.server': server || 'Le serveur',
		'txadmin.author': d.author ?? d.revokedBy ?? 'txAdmin',
		'txadmin.message': d.message ?? '',
		'txadmin.minutes': d.secondsRemaining !== undefined ? Math.max(1, Math.round(d.secondsRemaining / 60)) : '',
		'txadmin.restart.at': restartAt ? ts(restartAt, 't') : '',
		'txadmin.restart.relative': restartAt ? ts(restartAt, 'R') : '',
		'txadmin.shutdown.relative': d.delay !== undefined ? ts(at + d.delay, 'R') : 'maintenant',
		'txadmin.player': playerText(d),
		'txadmin.reason': d.reason ?? d.actionReason ?? 'aucune',
		'txadmin.duration': d.durationTranslated ?? (d.expiration ? ts(d.expiration * 1000, 'f') : 'définitif'),
	};
}

// Staff log (category fivemevents) of a player event
export function staffLogMessage(type, d, { server }) {
	const field = (name, value, inline = true) => (value ? [{ name, value: String(value).slice(0, 1000), inline }] : []);
	const common = [...field('Serveur', server), ...field('Admin', d.author)];
	const player = field('Joueur', playerText(d));
	const base = { title: `${EVENT_TYPES[type].label} (txAdmin)`, thumbnailUserId: d.targetDiscord ?? null };
	switch (type) {
	case 'playerKicked':
		return { ...base, color: 'warning', fields: [...player, ...common, ...field('Raison', d.reason ?? 'aucune', false)] };
	case 'playerBanned':
		return { ...base, color: 'danger', fields: [...player, ...common, ...field('Durée', eventVariables(d, { server, at: 0 })['txadmin.duration']), ...field('Raison', d.reason ?? 'aucune', false), ...field('Action', d.actionId)] };
	case 'playerWarned':
		return { ...base, color: 'warning', fields: [...player, ...common, ...field('Raison', d.reason ?? 'aucune', false), ...field('Action', d.actionId)] };
	case 'playerDirectMessage':
		return { ...base, color: 'info', fields: [...player, ...common, ...field('Message', d.message, false)] };
	case 'playerHealed':
		return { ...base, color: 'success', fields: [...player, ...common] };
	case 'actionRevoked':
		return { ...base, color: 'success', fields: [...field('Joueur', d.targetName), ...field('Sanction', [d.actionType, d.actionId].filter(Boolean).join(' · ')), ...field('Révoquée par', d.revokedBy), ...field('Donnée par', d.actionAuthor), ...field('Raison', d.actionReason, false), ...field('Serveur', server)] };
	default:
		return { ...base, color: 'neutral', fields: common };
	}
}

function samePing(a, b) {
	return a.channelId === b.channelId && a.ping === b.ping;
}

// @everyone/@here only with announcements.everyone (targets that already pinged everyone may stay)
function assertPings(actor, targets, previous = []) {
	for (const t of targets) {
		if ((t.ping === 'everyone' || t.ping === 'here') && !previous.some(p => samePing(p, t)) && !actor.can('announcements.everyone')) {
			throw new ForbiddenError('Permission manquante pour mentionner @everyone ou @here.');
		}
	}
}

function payloadOf(input, fallback, label) {
	try {
		return normalizePayload(input ?? fallback);
	}
	catch (error) {
		if (error instanceof ValidationError) throw new ValidationError(`${label} : ${error.message}`);
		throw error;
	}
}

export function defaultConfig() {
	const events = {};
	for (const [type, def] of Object.entries(EVENT_TYPES)) {
		events[type] = def.kind === 'staff'
			? { enabled: true }
			: { enabled: false, targets: [], payload: normalizePayload(DEFAULT_PAYLOADS[type]) };
	}
	events.scheduledRestart.thresholds = DEFAULT_THRESHOLDS;
	return {
		events,
		maintenance: { ...DEFAULT_MAINTENANCE, start: normalizePayload(DEFAULT_MAINTENANCE.start), end: normalizePayload(DEFAULT_MAINTENANCE.end) },
	};
}

// Every setting checked; unknown keys dropped
export function normalizeConfig(input = {}) {
	const defaults = defaultConfig();
	const events = {};
	for (const [type, def] of Object.entries(EVENT_TYPES)) {
		const e = input.events?.[type] ?? {};
		if (def.kind === 'staff') {
			events[type] = { enabled: e.enabled === undefined ? true : Boolean(e.enabled) };
			continue;
		}
		const targets = normalizeTargets(Array.isArray(e.targets) ? e.targets : []);
		const enabled = Boolean(e.enabled);
		if (enabled && !targets.length) throw new ValidationError(`${def.label} : choisis au moins un salon.`);
		events[type] = { enabled, targets, payload: payloadOf(e.payload, defaults.events[type].payload, def.label) };
	}
	const thresholds = Array.isArray(input.events?.scheduledRestart?.thresholds) ? input.events.scheduledRestart.thresholds : DEFAULT_THRESHOLDS;
	events.scheduledRestart.thresholds = [...new Set(thresholds.map(Number).filter(m => RESTART_WARNINGS.includes(m)))].sort((a, b) => b - a);
	if (events.scheduledRestart.enabled && !events.scheduledRestart.thresholds.length) throw new ValidationError('Redémarrage programmé : choisis au moins un rappel.');

	const m = input.maintenance ?? {};
	return {
		events,
		maintenance: {
			targets: normalizeTargets(Array.isArray(m.targets) ? m.targets : []),
			start: payloadOf(m.start, defaults.maintenance.start, 'Message de début de maintenance'),
			end: payloadOf(m.end, defaults.maintenance.end, 'Message de fin de maintenance'),
			statusMessages: m.statusMessages === undefined ? true : Boolean(m.statusMessages),
			mutePublic: m.mutePublic === undefined ? true : Boolean(m.mutePublic),
		},
	};
}

// txAdmin bridge: events of the FiveM server announced on Discord, and the maintenance mode
export function createFivemEvents({ db, settings, audit, logs, executor, network, variables, fivem, logger = console, now = Date.now }) {
	const typeLabels = Object.fromEntries(Object.entries(EVENT_TYPES).filter(([, d]) => d.kind === 'staff').map(([k, d]) => [k, d.label]));
	logs.registerCategory('fivemevents', 'Événements FiveM (txAdmin : expulsions, bans, maintenance…)', typeLabels);

	const q = {
		insert: db.prepare('INSERT INTO fivem_events (type, server, data, status, detail, test, received_at) VALUES (@type, @server, @data, @status, @detail, @test, @at)'),
		recent: db.prepare('SELECT * FROM fivem_events ORDER BY id DESC LIMIT ?'),
		prune: db.prepare('DELETE FROM fivem_events WHERE id <= (SELECT id FROM fivem_events ORDER BY id DESC LIMIT 1 OFFSET ?)'),
	};

	// Fingerprint -> time, to drop the same event sent twice (bridge retry, two resources started)
	const seen = new Map();
	// Countdown messages already posted: { server, minutes, restartAt }
	let countdown = [];

	const config = () => {
		const stored = settings.get('fivemEvents.config', null);
		if (!stored) return defaultConfig();
		try {
			return normalizeConfig(stored);
		}
		catch {
			return defaultConfig();
		}
	};
	const maintenance = () => settings.get('fivemEvents.maintenance', { active: false, reason: null, since: null, by: null });
	const nextRestart = () => {
		const at = settings.get('fivemEvents.nextRestart', null);
		return at && at > now() ? at : null;
	};

	function syncStatus() {
		const m = maintenance();
		fivem?.setMaintenance?.(m.active && config().maintenance.statusMessages ? m : null);
	}
	syncStatus();

	function store(type, server, data, status, detail, test) {
		q.insert.run({ type, server: server ?? null, data: JSON.stringify(data), status, detail: detail ?? null, test: test ? 1 : 0, at: now() });
		q.prune.run(KEEP_EVENTS);
		return { status, detail: detail ?? null };
	}

	// One message to each target; returns how many were sent
	// test: no ping, no crosspost (a trial must not notify anyone)
	async function announce(targets, payload, vars, { test = false } = {}) {
		let ok = 0;
		const errors = [];
		for (const target of targets) {
			if (network.find(target.guildId)?.status !== 'active') {
				errors.push('serveur hors réseau');
				continue;
			}
			try {
				const filled = fillPayload(payload, { ...await variables.server(target.guildId), ...vars });
				await executor.sendAnnouncement(target.channelId, filled, test ? { ...target, ping: 'none', roleIds: [], publish: false } : target);
				ok += 1;
			}
			catch (error) {
				logger.warn(`FiveM event announcement in ${target.channelId} failed:`, error.message);
				errors.push(error.message);
			}
		}
		return { ok, errors };
	}

	function isDuplicate(type, server, data) {
		const at = now();
		for (const [key, time] of seen) if (at - time > DUPLICATE_WINDOW_MS) seen.delete(key);
		const key = `${type}|${server ?? ''}|${JSON.stringify(data)}`;
		if (seen.has(key)) return true;
		seen.set(key, at);
		return false;
	}

	// The restart time txAdmin announces is the same for every warning: one message per threshold and restart
	function countdownPosted(server, minutes, restartAt) {
		countdown = countdown.filter(c => c.restartAt > now() - 3600_000);
		return countdown.some(c => c.server === server && c.minutes === minutes && Math.abs(c.restartAt - restartAt) < 90_000);
	}

	async function handle(type, data, server, { test = false } = {}) {
		const def = EVENT_TYPES[type];
		const at = now();
		const conf = config();
		const eventConf = conf.events[type];

		if (!test) {
			if (type === 'scheduledRestart' && data.secondsRemaining !== undefined) settings.set('fivemEvents.nextRestart', at + data.secondsRemaining * 1000);
			if (['scheduledRestartSkipped', 'serverStarted', 'serverShuttingDown'].includes(type)) settings.set('fivemEvents.nextRestart', null);
		}

		if (!eventConf.enabled) return store(type, server, data, 'disabled', 'Événement désactivé dans le panel', test);

		if (def.kind === 'staff') {
			const channels = logs.log(null, 'fivemevents', staffLogMessage(type, data, { server }), type);
			return store(type, server, data, 'logged', channels.length ? null : 'Aucun salon de logs pour « Événements FiveM »', test);
		}

		if (maintenance().active && conf.maintenance.mutePublic && type !== 'announcement') {
			return store(type, server, data, 'muted', 'Maintenance en cours', test);
		}

		let restartAt = null;
		if (type === 'scheduledRestart') {
			const minutes = Math.max(1, Math.round((data.secondsRemaining ?? 0) / 60));
			if (!eventConf.thresholds.includes(minutes)) return store(type, server, data, 'ignored', `Rappel à ${minutes} min non choisi`, test);
			restartAt = at + (data.secondsRemaining ?? 0) * 1000;
			if (!test && countdownPosted(server, minutes, restartAt)) return store(type, server, data, 'duplicate', `Rappel à ${minutes} min déjà publié`, test);
			if (!test) countdown.push({ server, minutes, restartAt });
		}

		const { ok, errors } = await announce(eventConf.targets, eventConf.payload, eventVariables(data, { server, at }), { test });
		if (!ok) return store(type, server, data, 'failed', errors[0] ?? 'Aucun salon', test);
		return store(type, server, data, 'posted', errors.length ? `${ok}/${eventConf.targets.length} salons` : null, test);
	}

	function toEvent(row) {
		return {
			id: row.id, type: row.type, label: EVENT_TYPES[row.type]?.label ?? row.type, server: row.server, data: JSON.parse(row.data),
			status: row.status, detail: row.detail, test: Boolean(row.test), receivedAt: row.received_at,
		};
	}

	const service = {
		config,

		// POST /api/fivem/events: called by the FiveM bridge with its API key
		async ingest(actor, { type, data = {}, server = null }) {
			if (!actor.can('fivem.events')) throw new ForbiddenError('Permission manquante : fivem.events');
			type = EVENT_ALIASES[type] ?? type;
			if (!EVENT_TYPES[type]) throw new ValidationError(`Événement inconnu : ${type}.`);
			const clean = cleanEventData(data);
			const serverName = text(server, 100);
			if (isDuplicate(type, serverName, clean)) return store(type, serverName, clean, 'duplicate', 'Reçu deux fois en moins de 15 s', false);
			return handle(type, clean, serverName);
		},

		// Panel "Tester": the event with sample data, nothing remembered (countdown, next restart)
		async test(actor, type) {
			if (!actor.can('fivemevents.manage')) throw new ForbiddenError('Permission manquante : fivemevents.manage');
			if (!EVENT_TYPES[type]) throw new ValidationError(`Événement inconnu : ${type}.`);
			return handle(type, cleanEventData(SAMPLES[type]), 'Serveur de test', { test: true });
		},

		saveConfig(actor, input) {
			if (!actor.can('fivemevents.manage')) throw new ForbiddenError('Permission manquante : fivemevents.manage');
			const previous = config();
			const next = normalizeConfig(input);
			for (const [type, e] of Object.entries(next.events)) if (e.targets) assertPings(actor, e.targets, previous.events[type].targets);
			assertPings(actor, next.maintenance.targets, previous.maintenance.targets);
			settings.set('fivemEvents.config', next);
			syncStatus();
			void fivem?.republish?.();
			const on = Object.entries(next.events).filter(([, e]) => e.enabled).map(([type]) => EVENT_TYPES[type].label);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'fivemevents.config', target: 'config', details: { 'Événements actifs': on } });
			return next;
		},

		maintenance,

		async setMaintenance(actor, { active, reason = null }) {
			if (!actor.can('fivemevents.maintenance')) throw new ForbiddenError('Permission manquante : fivemevents.maintenance');
			const current = maintenance();
			if (active && current.active) throw new ValidationError('La maintenance est déjà en cours.');
			if (!active && !current.active) throw new ValidationError('Aucune maintenance en cours.');
			const conf = config().maintenance;
			const at = now();
			let state;
			let sent;
			if (active) {
				state = { active: true, reason: text(reason, 300), since: at, by: actor.id };
				settings.set('fivemEvents.maintenance', state);
				sent = await announce(conf.targets, conf.start, {
					'maintenance.reason': state.reason ?? '', 'maintenance.since': ts(at, 'f'), 'maintenance.duration': '', 'maintenance.by': `<@${actor.id}>`,
				});
			}
			else {
				state = { active: false, reason: null, since: null, by: null };
				settings.set('fivemEvents.maintenance', state);
				sent = await announce(conf.targets, conf.end, {
					'maintenance.reason': current.reason ?? '', 'maintenance.since': ts(current.since ?? at, 'f'), 'maintenance.duration': durationText(at - (current.since ?? at)), 'maintenance.by': current.by ? `<@${current.by}>` : '',
				});
			}
			syncStatus();
			await fivem?.republish?.();
			audit.record({
				actorId: actor.id, source: actor.source ?? 'panel', action: active ? 'fivemevents.maintenance_on' : 'fivemevents.maintenance_off', target: 'maintenance',
				details: active ? { Raison: state.reason ?? 'aucune', Annonces: `${sent.ok}/${conf.targets.length}` } : { Durée: durationText(at - (current.since ?? at)), Annonces: `${sent.ok}/${conf.targets.length}` },
			});
			return { ...service.publicState(), announced: sent.ok, targets: conf.targets.length };
		},

		// Read-only view for other features (public page…): no personal data
		publicState() {
			const m = maintenance();
			const at = nextRestart();
			return {
				maintenance: { active: Boolean(m.active), reason: m.active ? m.reason ?? null : null, since: m.active ? m.since : null },
				nextRestart: at ? { at } : null,
			};
		},

		recent(limit = 50) {
			return q.recent.all(Math.min(Math.max(1, limit), 200)).map(toEvent);
		},

		types: () => Object.entries(EVENT_TYPES).map(([key, d]) => ({ key, ...d })),
	};
	return service;
}
