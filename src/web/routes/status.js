import { definePermission } from '../../core/permissions.js';

definePermission('status.view', { label: 'Voir l’état des services (bot, base, cache, liaison avec le jeu)', category: 'Système' });

// Older than this, the game is considered silent (bl_telemetry sends a batch every few seconds, a reading every 5 minutes)
const GAME_QUIET_MS = 15 * 60_000;
const CHECK_TIMEOUT_MS = 4000;
// Streams and feeds are read every minute or so: silent for this long, something is stuck
const FEED_QUIET_MS = 20 * 60_000;
const SLOW_PING_MS = 500;
const DAY_MS = 86_400_000;

// Periodic tasks of the bot (labels of `every` in src/app/tasks.js) in plain words
const TASK_NAMES = {
	'Session purge failed': 'Sessions expirées',
	'Ban expiry failed': 'Fin des bans temporaires',
	'Announcements failed': 'Annonces programmées',
	'Stats flush failed': 'Enregistrement des statistiques',
	'Counters failed': 'Salons compteurs',
	'Stats purge failed': 'Ménage des statistiques',
	'Live messages failed': 'Messages dynamiques',
	'Server links failed': 'Liens entre serveurs',
	'Polls failed': 'Sondages',
	'Giveaways failed': 'Giveaways',
	'Feedback reminders failed': 'Rappels des bugs',
	'RP events failed': 'Événements RP',
	'Takeovers failed': 'Reprises',
	'Staff report failed': 'Rapport d’activité du staff',
	'Backups failed': 'Sauvegardes des serveurs',
	'FiveM failed': 'Statut FiveM',
	'Bot status failed': 'Statut du bot',
	'FiveM roles sync failed': 'Rôles Discord selon le jeu',
	'In-game sanctions log failed': 'Sanctions du jeu',
	'Tebex poll failed': 'Achats Tebex',
	'Streams failed': 'Streams et vidéos',
	'Feeds failed': 'Flux RSS et TikTok',
	'Music tick failed': 'Musique',
	'Meetings tick failed': 'Réunions du staff',
	'Channel schedules failed': 'Horaires des salons',
	'Verification tick failed': 'Vérification des arrivants',
	'Absences failed': 'Absences du staff',
	'Anti-raid tick failed': 'Anti-raid',
	'Temporary roles failed': 'Rôles temporaires',
	'Ticket sweep failed': 'Tickets inactifs',
	'Events purge failed': 'Ménage de l’historique Discord',
	'Permission check failed': 'Contrôle des permissions',
	'Telemetry scrape failed': 'Relevé du serveur de jeu',
	'Telemetry alerts failed': 'Alertes du jeu',
	'Telemetry purge failed': 'Ménage de la télémétrie',
};
const PLATFORMS = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick', tiktok: 'TikTok', rss: 'Flux RSS' };

// State of the periodic tasks of a process. A task is late when it has not run for three of its periods
// (plus a minute), counted from the start of the process for one that never ran.
export function tasksState(tasks, startedAt, now = Date.now()) {
	const items = tasks.map((task) => {
		const reference = task.lastStartAt ?? startedAt ?? now;
		const late = now - reference > task.everyMs * 3 + 60_000;
		const state = task.lastError ? 'down' : late ? 'warn' : 'ok';
		return { label: TASK_NAMES[task.label] ?? task.label.replace(/ (tick )?failed$/, ''), state, at: task.lastStartAt, value: task.lastError ?? (late ? 'en retard' : null) };
	});
	// What needs attention first, the rest by name
	const rank = { down: 0, warn: 1, ok: 2 };
	items.sort((a, b) => rank[a.state] - rank[b.state] || a.label.localeCompare(b.label, 'fr'));
	return { items, failing: items.filter(i => i.state === 'down').length, late: items.filter(i => i.state === 'warn').length };
}

// What a Redis failure means, in plain words (the address shown never includes the password)
const REDIS_ERRORS = [
	[/REDIS_URL/, 'la variable REDIS_URL n’est pas une adresse redis://:motdepasse@hôte:6379'],
	[/ECONNREFUSED/, 'rien n’écoute à cette adresse (hôte ou port de REDIS_URL à vérifier, ou service Redis arrêté)'],
	[/ENOTFOUND|EAI_AGAIN/, 'l’hôte de REDIS_URL est introuvable'],
	[/WRONGPASS|NOAUTH|invalid (username-)?password/i, 'le mot de passe de REDIS_URL est refusé'],
	[/ETIMEDOUT|timeout/i, 'pas de réponse dans le délai (réseau ou pare-feu)'],
];

const timed = async (fn) => {
	const start = performance.now();
	const value = await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('pas de réponse en 4 s')), CHECK_TIMEOUT_MS))]);
	return { value, ms: Math.round(performance.now() - start) };
};
const ms = value => (value ? new Date(value).getTime() : null);

// One card per service: state ok / warn / down / off (not configured), a sentence, a few figures.
// A check that fails never fails the page: it becomes the "down" state of its card.
export function registerStatusRoutes(app, { core, runtime, fetchImpl = fetch, logger = console }) {
	const { db, executor, cache, settings, fivemMirror } = core;
	const row = async (sql, params = []) => (await db.raw(sql, params)).rows[0] ?? {};

	const checks = {
		async api() {
			const info = runtime.info();
			return { state: 'ok', detail: `${info.version} · en route`, metrics: { version: info.version, commit: info.commit?.slice(0, 7) ?? null, startedAt: info.startedAt, memory: info.memory, node: info.node, split: Boolean(info.split) } };
		},

		async bot() {
			const info = runtime.info();
			const status = executor.status();
			// Split deployment: the bot is another process, known through its link to this API
			const process = info.split ? info.bot : info;
			if (info.split && !process) return { state: 'down', detail: 'Le bot n’est pas relié à l’API : ses pages (tickets, musique, boutique, statut FiveM…) répondent « bot indisponible ».', metrics: {} };
			if (!status.ready) return { state: 'warn', detail: 'Le processus du bot tourne mais n’est pas connecté à Discord.', metrics: { version: process?.version ?? null, startedAt: process?.startedAt ?? null } };
			const slow = Number.isFinite(status.ping) && status.ping > SLOW_PING_MS;
			return {
				state: slow ? 'warn' : 'ok',
				detail: slow ? `Connecté à Discord, mais la liaison est lente (${Math.round(status.ping)} ms) : les commandes peuvent tarder.` : `Connecté à Discord en tant que ${status.user?.username ?? 'bot'}`,
				metrics: { version: process?.version ?? null, commit: process?.commit?.slice(0, 7) ?? null, startedAt: process?.startedAt ?? null, memory: process?.memory ?? null, ping: status.ping ?? null, guilds: status.guilds ?? 0, uptime: status.uptime ?? null },
			};
		},

		async database() {
			const { value, ms: latency } = await timed(() => row('SELECT pg_database_size(current_database()) AS size, (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections, current_setting(\'server_version\') AS version'));
			return {
				state: latency > 1000 ? 'warn' : 'ok', detail: latency > 1000 ? 'La base répond lentement.' : 'La base répond.',
				metrics: { latency, size: Number(value.size ?? 0), connections: Number(value.connections ?? 0), version: String(value.version ?? '').split(' ')[0] },
			};
		},

		async cache() {
			const status = await cache.status();
			if (!status.configured) return { state: 'off', detail: 'Pas de Redis configuré (REDIS_URL) : chaque processus garde son cache en mémoire.', metrics: {} };
			if (!status.ready) {
				const why = REDIS_ERRORS.find(([pattern]) => pattern.test(status.error ?? ''))?.[1] ?? (status.error ? `erreur « ${String(status.error).slice(0, 120)} »` : 'pas de réponse');
				return { state: 'down', detail: `Redis ne répond pas : ${why}. Le cache est retombé en mémoire, le panel continue de fonctionner.`, metrics: { target: status.target } };
			}
			return { state: 'ok', detail: 'Cache partagé entre les processus.', metrics: { latency: status.latency, target: status.target } };
		},

		// The FiveM servers themselves, as the bot sees them from outside (their public address)
		async game() {
			if (typeof core.fivem?.list !== 'function') return { state: 'off', detail: 'Aucun serveur FiveM suivi.', metrics: {} };
			const { value: servers } = await timed(() => core.fivem.list());
			if (!servers.length) return { state: 'off', detail: 'Aucun serveur FiveM ajouté dans la page FiveM.', metrics: {} };
			const items = servers.map((server) => {
				const status = server.status;
				if (server.maintenance) return { label: server.name, state: 'warn', value: 'Maintenance', at: status?.checkedAt ?? null };
				if (!status) return { label: server.name, state: 'warn', value: 'Pas encore vérifié', at: null };
				if (!status.online) return { label: server.name, state: 'down', value: status.error ? `Hors ligne (${String(status.error).slice(0, 60)})` : 'Hors ligne', at: status.checkedAt ?? null };
				return { label: server.name, state: 'ok', value: `${status.players} / ${status.max} joueurs`, at: status.checkedAt ?? null };
			});
			const down = items.filter(i => i.state === 'down').length;
			const players = servers.reduce((sum, s) => sum + (s.status?.online ? s.status.players : 0), 0);
			const metrics = { players, servers: servers.length };
			if (down === items.length) return { state: 'down', detail: items.length === 1 ? 'Le serveur FiveM ne répond pas.' : 'Aucun serveur FiveM ne répond.', metrics, items };
			if (items.some(i => i.state !== 'ok')) return { state: 'warn', detail: down ? `${down} serveur(s) FiveM ne répondent pas.` : 'Un serveur FiveM est en maintenance ou pas encore vérifié.', metrics, items };
			return { state: 'ok', detail: items.length === 1 ? 'Le serveur FiveM répond.' : 'Tous les serveurs FiveM répondent.', metrics, items };
		},

		// Announcements of the game received through the txAdmin bridge (POST /api/fivem/events)
		async bridge() {
			const [last, failed] = await Promise.all([
				row('SELECT type, status, received_at FROM fivem_events WHERE test = 0 ORDER BY received_at DESC LIMIT 1'),
				row('SELECT COUNT(*) AS n FROM fivem_events WHERE test = 0 AND status = \'failed\' AND received_at > $1', [Date.now() - DAY_MS]),
			]);
			const at = last.received_at ? Number(last.received_at) : null;
			const metrics = { last: at, failed: Number(failed.n ?? 0) };
			if (!at) return { state: 'off', detail: 'Aucune annonce du jeu reçue (ressource brl-bridge avec txAdmin).', metrics };
			if (metrics.failed) return { state: 'warn', detail: `${metrics.failed} annonce(s) du jeu n’ont pas pu être publiées depuis 24 h.`, metrics };
			return { state: 'ok', detail: 'Les annonces du jeu arrivent (redémarrages, messages txAdmin).', metrics };
		},

		// yt-dlp and ffmpeg live on the disk of the bot, the Spotify keys in the settings
		async music() {
			const tools = executor.status()?.music ?? null;
			const spotify = await settings.get('music.spotify', {});
			if (!tools) return { state: 'off', detail: 'État de la musique inconnu : le bot n’est pas relié.', metrics: {} };
			const ready = value => (value ? 'Prêt' : 'Téléchargé à la première lecture');
			const items = [
				{ label: 'yt-dlp (recherche et son)', state: tools.ytdlp ? 'ok' : 'warn', value: ready(tools.ytdlp) },
				{ label: 'ffmpeg (lecture)', state: tools.ffmpeg ? 'ok' : 'warn', value: ready(tools.ffmpeg) },
				{ label: 'Recherche Spotify', state: spotify?.clientId ? 'ok' : 'off', value: spotify?.clientId ? 'Configurée' : 'Non configurée' },
			];
			const waiting = !tools.ytdlp || !tools.ffmpeg;
			return { state: 'ok', detail: waiting ? 'La musique téléchargera ses outils à la première lecture (quelques secondes de plus cette fois-là).' : 'Les outils de la musique sont en place.', metrics: {}, items };
		},

		// Twitch, YouTube, Kick, TikTok and RSS feeds: when each kind was last read, and how many fail
		async streams() {
			const [streams, feeds] = await Promise.all([
				db.raw(`SELECT s.platform AS kind, COUNT(*) AS total, MAX(st.checked_at) AS checked, COUNT(st.error) AS errors
					FROM stream_subscriptions s LEFT JOIN stream_state st ON st.subscription_id = s.id WHERE s.enabled = 1 GROUP BY s.platform`),
				db.raw(`SELECT f.kind AS kind, COUNT(*) AS total, MAX(st.checked_at) AS checked, COUNT(st.error) AS errors
					FROM feed_subscriptions f LEFT JOIN feed_state st ON st.subscription_id = f.id WHERE f.enabled = 1 GROUP BY f.kind`),
			]);
			const merged = new Map();
			for (const r of [...(streams.rows ?? []), ...(feeds.rows ?? [])]) {
				const entry = merged.get(r.kind) ?? { total: 0, checked: null, errors: 0 };
				entry.total += Number(r.total ?? 0);
				entry.errors += Number(r.errors ?? 0);
				entry.checked = Math.max(entry.checked ?? 0, Number(r.checked ?? 0)) || null;
				merged.set(r.kind, entry);
			}
			if (!merged.size) return { state: 'off', detail: 'Aucun stream, chaîne ou flux suivi.', metrics: {} };
			const items = [...merged].map(([kind, e]) => {
				const quiet = !e.checked || Date.now() - e.checked > FEED_QUIET_MS;
				const state = e.errors === e.total ? 'down' : e.errors || quiet ? 'warn' : 'ok';
				const value = e.errors ? `${e.errors} sur ${e.total} en erreur` : !e.checked ? `${e.total} suivi(s), pas encore relevé` : `${e.total} suivi(s)`;
				return { label: PLATFORMS[kind] ?? kind, state, value, at: e.checked };
			});
			const last = Math.max(...items.map(i => i.at ?? 0)) || null;
			const metrics = { last, followed: items.length ? [...merged.values()].reduce((sum, e) => sum + e.total, 0) : 0 };
			if (items.every(i => i.state === 'down')) return { state: 'down', detail: 'Aucun stream ni flux ne peut être relevé.', metrics, items };
			if (items.some(i => i.state !== 'ok')) return { state: 'warn', detail: 'Certains streams ou flux sont en erreur ou ne sont plus relevés.', metrics, items };
			return { state: 'ok', detail: 'Streams, chaînes et flux sont relevés.', metrics, items };
		},

		// Periodic work of the bot: what last ran, what fails, what is stuck
		async tasks() {
			const info = runtime.info();
			const process = info.split ? info.bot : info;
			const list = process?.tasks ?? [];
			if (info.split && !process) return { state: 'down', detail: 'Le bot n’est pas relié : l’état de ses tâches est inconnu.', metrics: {} };
			if (!list.length) return { state: 'off', detail: 'Aucune tâche périodique lancée dans ce processus.', metrics: {} };
			const { items, failing, late } = tasksState(list, process.startedAt);
			const metrics = { tasks: items.length };
			if (failing) return { state: 'warn', detail: `${failing} tâche(s) ont échoué à leur dernier passage.`, metrics, items };
			if (late) return { state: 'warn', detail: `${late} tâche(s) n’ont pas tourné depuis trop longtemps.`, metrics, items };
			return { state: 'ok', detail: `Les ${items.length} tâches périodiques du bot tournent.`, metrics };
		},

		// bl_telemetry: events and readings (POST /v1/batch)
		async telemetry() {
			const [event, health] = await Promise.all([
				row('SELECT ts FROM tel_events ORDER BY ts DESC LIMIT 1'),
				row('SELECT ts, players, max_players, data->>\'server_uptime_s\' AS uptime FROM tel_health ORDER BY ts DESC LIMIT 1'),
			]);
			const last = Math.max(ms(event.ts) ?? 0, ms(health.ts) ?? 0) || null;
			const metrics = { last, lastReading: ms(health.ts), players: health.players ?? null, maxPlayers: health.max_players ?? null, serverUptime: health.uptime ? Number(health.uptime) : null };
			if (!last) return { state: 'off', detail: 'Aucun envoi du serveur de jeu reçu (ressource bl_telemetry).', metrics };
			if (Date.now() - last > GAME_QUIET_MS) return { state: 'warn', detail: 'Le serveur de jeu n’envoie plus rien : il est arrêté, ou bl_telemetry ne joint plus le panel.', metrics };
			return { state: 'ok', detail: health.ts ? 'Le serveur de jeu envoie ses événements et ses relevés.' : 'Le serveur de jeu envoie ses événements (relevés 1.6 pas encore reçus).', metrics };
		},

		// Copy of the game database (POST /v1/mirror)
		async mirror() {
			const status = await fivemMirror.status();
			const metrics = { last: status.lastSync, tables: status.tables.filter(t => t.mode !== 'count').length, counted: status.tables.filter(t => t.mode === 'count').length };
			if (!status.lastSync) return { state: 'off', detail: 'Aucune table du jeu copiée pour l’instant.', metrics };
			if (Date.now() - status.lastSync > GAME_QUIET_MS) return { state: 'warn', detail: 'La copie de la base du jeu n’est plus mise à jour.', metrics };
			return { state: 'ok', detail: 'La copie de la base du jeu est à jour.', metrics };
		},

		async tebex() {
			const [secret, config, state] = await Promise.all([settings.get('tebex.secret', ''), settings.get('tebex.config', {}), settings.get('tebex.state', {})]);
			const metrics = { last: state.lastPollAt ?? null };
			if (!secret) return { state: 'off', detail: 'Boutique Tebex non configurée.', metrics };
			if (config.enabled === false) return { state: 'off', detail: 'Suivi des achats en pause.', metrics };
			if (state.lastError) return { state: 'down', detail: state.lastError, metrics };
			return { state: 'ok', detail: state.lastPollAt ? 'Les achats sont relevés.' : 'En attente du premier relevé.', metrics };
		},

		async media() {
			const { MEDIA_BASE_URL: baseUrl, MEDIA_READ_KEY: readKey } = core.config;
			if (!baseUrl || !readKey) return { state: 'off', detail: 'Service média non configuré (MEDIA_BASE_URL et MEDIA_READ_KEY).', metrics: {} };

			const target = new URL(baseUrl).origin;
			const endpoint = new URL(`${baseUrl}/api/v1/files?kind=image&limit=1`);
			const start = performance.now();
			let response;
			try {
				response = await fetchImpl(endpoint, {
					headers: { Authorization: readKey },
					redirect: 'error',
					signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
				});
			}
			catch (error) {
				logger.warn('Media service status check failed:', error.message);
				return { state: 'down', detail: 'Le service média ne répond pas à l’API du panel (adresse ou réseau à vérifier).', metrics: { target } };
			}

			const latency = Math.round(performance.now() - start);
			if (!response.ok) {
				const detail = {
					401: 'La clé MEDIA_READ_KEY est refusée.',
					403: 'La clé média doit avoir le droit files:read.',
					404: 'L’adresse MEDIA_BASE_URL ne pointe pas vers le service média attendu.',
				}[response.status] ?? `Le service média a répondu avec l’erreur HTTP ${response.status}.`;
				return { state: 'down', detail, metrics: { target, latency } };
			}

			try {
				const payload = await response.json();
				if (payload?.status === 'error' || !Array.isArray(payload?.data?.items)) {
					return { state: 'down', detail: 'Le service média a renvoyé un catalogue invalide.', metrics: { target, latency } };
				}
			}
			catch (error) {
				logger.warn('Media service returned an invalid status response:', error.message);
				return { state: 'down', detail: 'Le service média a renvoyé une réponse invalide.', metrics: { target, latency } };
			}

			return { state: latency > 1000 ? 'warn' : 'ok', detail: latency > 1000 ? 'Le catalogue des images répond lentement.' : 'Le catalogue des images est accessible.', metrics: { target, latency } };
		},
	};

	const LABELS = {
		api: 'Panel et API', bot: 'Bot Discord', database: 'Base de données', cache: 'Cache Redis', telemetry: 'Serveur de jeu (télémétrie)', mirror: 'Copie de la base du jeu', tebex: 'Boutique Tebex', media: 'API des images',
		game: 'Serveurs FiveM', bridge: 'Annonces du jeu (txAdmin)', music: 'Musique', streams: 'Streams et flux', tasks: 'Tâches périodiques',
	};
	// The order of the cards on the page
	const ORDER = ['api', 'bot', 'database', 'cache', 'telemetry', 'mirror', 'tebex', 'media', 'game', 'bridge', 'music', 'streams', 'tasks'];

	app.get('/api/status', { config: { permission: 'status.view' } }, async () => {
		const services = await Promise.all(ORDER.map(key => [key, checks[key]]).map(async ([key, check]) => {
			try {
				return { key, label: LABELS[key], ...(await check()) };
			}
			catch (error) {
				return { key, label: LABELS[key], state: 'down', detail: `Vérification impossible : ${error.message}`, metrics: {} };
			}
		}));
		const worst = ['down', 'warn', 'ok'].find(state => services.some(s => s.state === state)) ?? 'ok';
		return { at: Date.now(), state: worst, services };
	});
}
