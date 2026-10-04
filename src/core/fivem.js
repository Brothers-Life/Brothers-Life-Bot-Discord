import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { fillVars } from './cards.js';
import { blockedHost } from './netGuard.js';

definePermission('fivem.view', { label: 'Voir l’état des serveurs FiveM', category: 'FiveM' });
definePermission('fivem.manage', { label: 'Gérer les serveurs FiveM, leurs messages de statut et le statut du bot', category: 'FiveM' });

const SNOWFLAKE = /^\d{17,20}$/;
const ADDRESS = /^([a-z0-9.-]{1,253}):(\d{1,5})$/i;
const JOIN_CODE = /^[a-z0-9]{4,10}$/i;
const TIMEOUT = 5000;
const DEFAULT_PRESENCE = { enabled: false, serverIds: [], text: '{players}/{max} joueurs sur {name}', offlineText: '{name} est hors ligne' };

export function normalizePresence(input = {}) {
	return {
		enabled: Boolean(input.enabled),
		serverIds: [...new Set((Array.isArray(input.serverIds) ? input.serverIds : []).map(Number).filter(Number.isInteger))].slice(0, 10),
		text: String(input.text ?? DEFAULT_PRESENCE.text).trim().slice(0, 120) || DEFAULT_PRESENCE.text,
		offlineText: String(input.offlineText ?? DEFAULT_PRESENCE.offlineText).trim().slice(0, 120) || DEFAULT_PRESENCE.offlineText,
	};
}

// FiveM servers: polled every minute, shown in Discord (status messages, bot status, /fivem) and in the panel
export function createFivem({ db, network, audit, executor, settings, logs, fetchImpl = fetch, logger = console, now = Date.now }) {
	logs.registerCategory('fivem', 'Serveurs FiveM (réglages)');
	const cache = new Map();
	let rotation = 0;
	// Maintenance of the FiveM server (set by fivemEvents): shown in the status messages
	let maintenance = null;

	const q = {
		all: db.prepare('SELECT * FROM fivem_servers ORDER BY name COLLATE NOCASE'),
		get: db.prepare('SELECT * FROM fivem_servers WHERE id = ?'),
		insert: db.prepare('INSERT INTO fivem_servers (name, address, join_code, config, created_by, created_at) VALUES (@name, @address, @joinCode, @config, @by, @at)'),
		update: db.prepare('UPDATE fivem_servers SET name = @name, address = @address, join_code = @joinCode, config = @config WHERE id = @id'),
		delete: db.prepare('DELETE FROM fivem_servers WHERE id = ?'),
		messages: db.prepare('SELECT * FROM fivem_status_messages ORDER BY id'),
		messagesOf: db.prepare('SELECT * FROM fivem_status_messages WHERE server_id = ?'),
		message: db.prepare('SELECT * FROM fivem_status_messages WHERE id = ?'),
		addMessage: db.prepare('INSERT INTO fivem_status_messages (server_id, guild_id, channel_id) VALUES (?, ?, ?) ON CONFLICT (server_id, channel_id) DO NOTHING'),
		setMessage: db.prepare('UPDATE fivem_status_messages SET message_id = ? WHERE id = ?'),
		dropMessage: db.prepare('DELETE FROM fivem_status_messages WHERE id = ?'),
	};

	function toServer(row) {
		if (!row) return null;
		const config = JSON.parse(row.config);
		return {
			id: row.id, name: row.name, address: row.address, joinCode: row.join_code,
			config: { showPlayers: config.showPlayers !== false, color: /^#[0-9a-f]{6}$/i.test(config.color ?? '') ? config.color : '#d6a249' },
			status: cache.get(row.id) ?? null,
			maintenance,
			messages: q.messagesOf.all(row.id).map(m => ({ id: m.id, guildId: m.guild_id, channelId: m.channel_id, messageId: m.message_id })),
		};
	}

	function getOrThrow(id) {
		const s = toServer(q.get.get(id));
		if (!s) throw new NotFoundError('Serveur FiveM introuvable.');
		return s;
	}

	function requireManage(actor) {
		if (!actor.can('fivem.manage')) throw new ForbiddenError('Permission manquante : fivem.manage');
	}

	function record(actor, action, target, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(target), details });
	}

	async function getJson(url) {
		const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: 'application/json' } });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.json();
	}

	async function poll(server) {
		const base = `http://${server.address}`;
		try {
			const [dynamic, players] = await Promise.all([getJson(`${base}/dynamic.json`), getJson(`${base}/players.json`)]);
			const list = (Array.isArray(players) ? players : []).map(p => ({ id: p.id, name: String(p.name ?? '?').slice(0, 64), ping: p.ping ?? null })).sort((a, b) => a.id - b.id);
			const previous = cache.get(server.id);
			const status = {
				online: true, players: list.length || Number(dynamic.clients ?? 0), max: Number(dynamic.sv_maxclients ?? 0), hostname: String(dynamic.hostname ?? '').replace(/\^\d/g, '').slice(0, 200),
				map: dynamic.mapname ?? null, list, checkedAt: now(), error: null,
				onlineSince: previous?.online ? previous.onlineSince : now(),
				peak: Math.max(previous?.peak ?? 0, list.length),
			};
			cache.set(server.id, status);
		}
		catch (error) {
			cache.set(server.id, { online: false, players: 0, max: cache.get(server.id)?.max ?? 0, hostname: null, map: null, list: [], checkedAt: now(), error: error.name === 'TimeoutError' ? 'Pas de réponse en 5 s' : error.message, onlineSince: null, peak: cache.get(server.id)?.peak ?? 0 });
		}
		return cache.get(server.id);
	}

	async function publishOne(server, row) {
		try {
			const id = await executor.upsertFivemMessage(row.channel_id, row.message_id, { server, status: cache.get(server.id) ?? null });
			if (id !== row.message_id) q.setMessage.run(id, row.id);
		}
		catch (error) {
			logger.warn(`FiveM status message ${row.channel_id} failed:`, error.message);
		}
	}

	function validate(input, current) {
		const name = String(input.name ?? current?.name ?? '').trim();
		if (!name || name.length > 60) throw new ValidationError('Le nom fait 1 à 60 caractères.');
		const address = String(input.address ?? current?.address ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
		const m = ADDRESS.exec(address);
		if (!m || !Number(m[2]) || Number(m[2]) > 65535) throw new ValidationError('Adresse attendue : ip:port (ex. 51.75.12.34:30120).');
		const blocked = blockedHost(m[1], { allowPrivate: true });
		if (blocked) throw new ValidationError(`Adresse refusée : ${blocked}.`);
		const code = String(input.joinCode ?? current?.joinCode ?? '').trim().replace(/^https?:\/\/cfx\.re\/join\//, '');
		if (code && !JOIN_CODE.test(code)) throw new ValidationError('Code cfx.re invalide (cfx.re/join/xxxxxx).');
		const config = { ...current?.config, ...input.config };
		return { name, address, joinCode: code || null, config: JSON.stringify({ showPlayers: config.showPlayers !== false, color: /^#[0-9a-f]{6}$/i.test(config.color ?? '') ? config.color : '#d6a249' }) };
	}

	function presence() {
		return normalizePresence(settings.get('fivem.presence', DEFAULT_PRESENCE));
	}

	const service = {
		list: () => q.all.all().map(toServer),
		get: getOrThrow,

		async save(actor, input) {
			requireManage(actor);
			const current = input.id ? getOrThrow(input.id) : null;
			const c = validate(input, current);
			let id = current?.id;
			if (current) q.update.run({ ...c, id });
			else id = Number(q.insert.run({ ...c, by: actor.id, at: now() }).lastInsertRowid);
			const server = getOrThrow(id);
			await poll(server);
			record(actor, current ? 'fivem.update' : 'fivem.create', id, { name: server.name, address: server.address });
			return getOrThrow(id);
		},

		async remove(actor, id) {
			requireManage(actor);
			const server = getOrThrow(id);
			for (const m of server.messages) if (m.messageId) await executor.deleteMessage(m.channelId, m.messageId).catch(() => null);
			q.delete.run(id);
			cache.delete(id);
			record(actor, 'fivem.delete', id, { name: server.name });
		},

		// A status message kept up to date in a channel
		async addStatusMessage(actor, serverId, guildId, channelId) {
			requireManage(actor);
			const server = getOrThrow(serverId);
			if (!SNOWFLAKE.test(channelId) || network.find(guildId)?.status !== 'active') throw new ValidationError('Salon invalide.');
			if (!await executor.getTextChannel(guildId, channelId)) throw new ValidationError('Le bot ne peut pas écrire dans ce salon.');
			q.addMessage.run(serverId, guildId, channelId);
			const row = q.messagesOf.all(serverId).find(m => m.channel_id === channelId);
			await publishOne(server, row);
			record(actor, 'fivem.message', serverId, { name: server.name, channel: `<#${channelId}>` });
			return getOrThrow(serverId);
		},

		async removeStatusMessage(actor, messageRowId) {
			requireManage(actor);
			const row = q.message.get(messageRowId);
			if (!row) throw new NotFoundError('Message introuvable.');
			if (row.message_id) await executor.deleteMessage(row.channel_id, row.message_id).catch(() => null);
			q.dropMessage.run(messageRowId);
			record(actor, 'fivem.message_delete', row.server_id, { channel: `<#${row.channel_id}>` });
		},

		presence,

		setPresence(actor, input) {
			requireManage(actor);
			const p = normalizePresence(input);
			settings.set('fivem.presence', p);
			record(actor, 'fivem.presence', 'presence', { enabled: p.enabled });
			if (!p.enabled) void executor.setBotStatus(null).catch(() => null);
			return p;
		},

		// Every minute: poll every server, then refresh the status messages
		async tick() {
			const servers = q.all.all().map(toServer);
			await Promise.all(servers.map(poll));
			for (const row of q.messages.all()) {
				const server = servers.find(s => s.id === row.server_id);
				if (server) await publishOne({ ...server, status: cache.get(server.id) }, row);
			}
		},

		// Every 30 s: bot status, rotating between the chosen servers
		async presenceTick() {
			const p = presence();
			if (!p.enabled) return null;
			const servers = p.serverIds.map(id => toServer(q.get.get(id))).filter(Boolean);
			if (!servers.length) return null;
			const server = servers[rotation++ % servers.length];
			const status = cache.get(server.id);
			const text = fillVars(status?.online ? p.text : p.offlineText, { players: status?.players ?? 0, max: status?.max ?? 0, name: server.name });
			await executor.setBotStatus(text).catch(error => logger.warn('Bot status failed:', error.message));
			return text;
		},

		setMaintenance(state) {
			maintenance = state?.active ? { reason: state.reason ?? null, since: state.since ?? null } : null;
		},

		// Status messages redrawn from the last poll (maintenance switched on or off)
		async republish() {
			const servers = q.all.all().map(toServer);
			for (const row of q.messages.all()) {
				const server = servers.find(s => s.id === row.server_id);
				if (server) await publishOne(server, row);
			}
		},

		// Counter channel variables: {fivem} players and {fivemMax} slots, all servers together
		variables() {
			let players = 0;
			let max = 0;
			for (const s of cache.values()) {
				if (!s.online) continue;
				players += s.players;
				max += s.max;
			}
			return { fivem: players, fivemMax: max };
		},

		async fresh(id) {
			const server = getOrThrow(id);
			const status = cache.get(id);
			return status && now() - status.checkedAt < 30_000 ? server : { ...server, status: await poll(server) };
		},
	};
	return service;
}
