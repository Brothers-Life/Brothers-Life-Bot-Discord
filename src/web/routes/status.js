import { definePermission } from '../../core/permissions.js';

definePermission('status.view', { label: 'Voir l’état des services (bot, base, cache, liaison avec le jeu)', category: 'Système' });

// Older than this, the game is considered silent (bl_telemetry sends a batch every few seconds, a reading every 5 minutes)
const GAME_QUIET_MS = 15 * 60_000;
const CHECK_TIMEOUT_MS = 4000;

const timed = async (fn) => {
	const start = performance.now();
	const value = await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('pas de réponse en 4 s')), CHECK_TIMEOUT_MS))]);
	return { value, ms: Math.round(performance.now() - start) };
};
const ms = value => (value ? new Date(value).getTime() : null);

// One card per service: state ok / warn / down / off (not configured), a sentence, a few figures.
// A check that fails never fails the page: it becomes the "down" state of its card.
export function registerStatusRoutes(app, { core, runtime }) {
	const { db, executor, cache, settings, fivemMirror } = core;
	const row = async (sql, params = []) => (await db.raw(sql, params)).rows[0] ?? {};

	const checks = {
		async api() {
			const info = runtime.info();
			return { state: 'ok', detail: `${info.version} · en route`, metrics: { version: info.version, startedAt: info.startedAt, memory: info.memory, node: info.node, split: Boolean(info.split) } };
		},

		async bot() {
			const info = runtime.info();
			const status = executor.status();
			// Split deployment: the bot is another process, known through its link to this API
			const process = info.split ? info.bot : info;
			if (info.split && !process) return { state: 'down', detail: 'Le bot n’est pas relié à l’API : ses pages (tickets, musique, boutique, statut FiveM…) répondent « bot indisponible ».', metrics: {} };
			if (!status.ready) return { state: 'warn', detail: 'Le processus du bot tourne mais n’est pas connecté à Discord.', metrics: { version: process?.version ?? null, startedAt: process?.startedAt ?? null } };
			return {
				state: 'ok', detail: `Connecté à Discord en tant que ${status.user?.username ?? 'bot'}`,
				metrics: { version: process?.version ?? null, startedAt: process?.startedAt ?? null, memory: process?.memory ?? null, ping: status.ping ?? null, guilds: status.guilds ?? 0, uptime: status.uptime ?? null },
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
			if (!status.ready) return { state: 'down', detail: 'Redis ne répond pas : le cache est retombé en mémoire, le panel continue de fonctionner.', metrics: {} };
			return { state: 'ok', detail: 'Cache partagé entre les processus.', metrics: { latency: status.latency } };
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
	};

	const LABELS = { api: 'Panel et API', bot: 'Bot Discord', database: 'Base de données', cache: 'Cache Redis', telemetry: 'Serveur de jeu (télémétrie)', mirror: 'Copie de la base du jeu', tebex: 'Boutique Tebex' };

	app.get('/api/status', { config: { permission: 'status.view' } }, async () => {
		const services = await Promise.all(Object.entries(checks).map(async ([key, check]) => {
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
