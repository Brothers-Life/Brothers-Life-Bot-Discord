import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('voice.view', { label: 'Voir les vocaux personnels', category: 'Vocaux perso' });
definePermission('voice.manage', { label: 'Configurer les vocaux personnels, fermer un salon', category: 'Vocaux perso' });

const SNOWFLAKE = /^\d{17,20}$/;
export const ROOM_OPTIONS = ['rename', 'limit', 'lock', 'hide', 'permit', 'reject', 'kick', 'transfer', 'claim', 'bitrate', 'region'];
export const REGIONS = ['rotterdam', 'us-east', 'us-west', 'us-central', 'us-south', 'brazil', 'hongkong', 'india', 'japan', 'russia', 'singapore', 'southafrica', 'sydney'];

const int = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);

export function normalizeHub(input = {}) {
	const options = {};
	for (const key of ROOM_OPTIONS) options[key] = input.options?.[key] !== false;
	return {
		nameTemplate: String(input.nameTemplate ?? 'Salon de {user}').trim().slice(0, 90) || 'Salon de {user}',
		categoryId: SNOWFLAKE.test(input.categoryId) ? input.categoryId : null,
		userLimit: int(input.userLimit, 0, 99, 0),
		bitrate: input.bitrate === null || input.bitrate === undefined ? null : int(input.bitrate, 8, 384, 64),
		maxPerUser: int(input.maxPerUser, 1, 5, 1),
		allowedRoleIds: (Array.isArray(input.allowedRoleIds) ? input.allowedRoleIds : []).filter(r => SNOWFLAKE.test(r)).slice(0, 25),
		deleteAfterSeconds: int(input.deleteAfterSeconds, 0, 3600, 5),
		rememberSettings: input.rememberSettings !== false,
		options,
	};
}

// What the owner may change, and what the bot applies to the channel
function normalizeState(input = {}) {
	return {
		name: typeof input.name === 'string' ? input.name.slice(0, 100) : null,
		userLimit: int(input.userLimit, 0, 99, 0),
		locked: Boolean(input.locked),
		hidden: Boolean(input.hidden),
		permitted: (Array.isArray(input.permitted) ? input.permitted : []).filter(r => SNOWFLAKE.test(r)).slice(0, 50),
		rejected: (Array.isArray(input.rejected) ? input.rejected : []).filter(r => SNOWFLAKE.test(r)).slice(0, 50),
		bitrate: input.bitrate === null || input.bitrate === undefined ? null : int(input.bitrate, 8, 384, 64),
		region: REGIONS.includes(input.region) ? input.region : null,
	};
}

// "Join to create" voice channels: every creator gets their own channel and controls it
export function createVoiceRooms({ db, network, audit, executor, logger = console, now = Date.now, setTimer = setTimeout }) {
	const q = {
		hubs: db.prepare('SELECT * FROM voice_hubs WHERE guild_id = ? ORDER BY id'),
		hub: db.prepare('SELECT * FROM voice_hubs WHERE id = ?'),
		hubByChannel: db.prepare('SELECT * FROM voice_hubs WHERE channel_id = ?'),
		insertHub: db.prepare('INSERT INTO voice_hubs (guild_id, channel_id, config, created_at) VALUES (?, ?, ?, ?)'),
		updateHub: db.prepare('UPDATE voice_hubs SET config = ? WHERE id = ?'),
		deleteHub: db.prepare('DELETE FROM voice_hubs WHERE id = ?'),
		deleteHubByChannel: db.prepare('DELETE FROM voice_hubs WHERE channel_id = ?'),
		rooms: db.prepare('SELECT * FROM voice_rooms WHERE guild_id = ? ORDER BY created_at'),
		allRooms: db.prepare('SELECT * FROM voice_rooms'),
		room: db.prepare('SELECT * FROM voice_rooms WHERE channel_id = ?'),
		roomsOf: db.prepare('SELECT COUNT(*) AS n FROM voice_rooms WHERE guild_id = ? AND owner_id = ?'),
		insertRoom: db.prepare('INSERT INTO voice_rooms (channel_id, guild_id, hub_id, owner_id, state, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
		updateRoom: db.prepare('UPDATE voice_rooms SET owner_id = ?, state = ? WHERE channel_id = ?'),
		deleteRoom: db.prepare('DELETE FROM voice_rooms WHERE channel_id = ?'),
		prefs: db.prepare('SELECT prefs FROM voice_prefs WHERE user_id = ? AND guild_id = ?'),
		savePrefs: db.prepare(`
			INSERT INTO voice_prefs (user_id, guild_id, prefs) VALUES (?, ?, ?)
			ON CONFLICT(user_id, guild_id) DO UPDATE SET prefs = excluded.prefs
		`),
	};

	const toHub = row => row && ({ id: row.id, guildId: row.guild_id, channelId: row.channel_id, config: normalizeHub(JSON.parse(row.config)) });
	const toRoom = row => row && ({ channelId: row.channel_id, guildId: row.guild_id, hubId: row.hub_id, ownerId: row.owner_id, state: normalizeState(JSON.parse(row.state)), createdAt: row.created_at });
	// channelId -> pending deletion timer of empty rooms
	const pendingDeletes = new Map();
	// guildId:userId whose room is being created
	const creating = new Set();

	function requireManage(actor, guildId) {
		if (!actor.can('voice.manage')) throw new ForbiddenError('Permission manquante : voice.manage');
		if (guildId && network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
	}

	function getRoom(channelId) {
		const room = toRoom(q.room.get(channelId));
		if (!room) throw new NotFoundError('Ce salon n’est pas un vocal personnel.');
		return room;
	}

	async function persist(room, state) {
		q.updateRoom.run(room.ownerId, JSON.stringify(state), room.channelId);
		const hub = room.hubId ? toHub(q.hub.get(room.hubId)) : null;
		if (hub?.config.rememberSettings) q.savePrefs.run(room.ownerId, room.guildId, JSON.stringify(state));
		await executor.applyVoiceRoom(room.channelId, { ...state, ownerId: room.ownerId }).catch(error => logger.warn(`Voice room ${room.channelId} not updated:`, error.message));
		return { ...room, state };
	}

	// The owner (or, for "claim", anyone in the room when the owner has left) changes the room
	async function control(userId, channelId, option) {
		const room = getRoom(channelId);
		const hub = room.hubId ? toHub(q.hub.get(room.hubId)) : null;
		if (hub && !hub.config.options[option]) throw new ForbiddenError('Cette option est désactivée sur ce serveur.');
		if (option !== 'claim' && room.ownerId !== userId) throw new ForbiddenError('Seul le propriétaire du salon peut faire ça.');
		return { room, hub };
	}

	function scheduleDelete(room, delaySeconds) {
		if (pendingDeletes.has(room.channelId)) return;
		const timer = setTimer(async () => {
			pendingDeletes.delete(room.channelId);
			const members = await executor.voiceChannelMembers(room.channelId).catch(() => null);
			if (members && members.length) return;
			q.deleteRoom.run(room.channelId);
			await executor.deleteChannel(room.channelId, 'Vocal personnel vide').catch(() => null);
		}, delaySeconds * 1000);
		timer?.unref?.();
		pendingDeletes.set(room.channelId, timer);
	}

	// A room for this member (hub config checks, channel, panel)
	async function createRoom(guildId, member, hub, to) {
		const { config } = hub;
		if (config.allowedRoleIds.length) {
			const roles = await executor.getMemberRoleIds(guildId, member.id) ?? [];
			if (!config.allowedRoleIds.some(r => roles.includes(r))) {
				await executor.voiceDisconnect(guildId, member.id, 'Pas le droit de créer un vocal').catch(() => null);
				return;
			}
		}
		if (q.roomsOf.get(guildId, member.id).n >= config.maxPerUser) {
			// Already has a room: sent back into it instead
			const own = q.rooms.all(guildId).map(toRoom).find(r => r.ownerId === member.id);
			if (own) await executor.voiceMove(guildId, member.id, own.channelId, 'Retour dans son vocal').catch(() => null);
			return;
		}
		const saved = config.rememberSettings ? q.prefs.get(member.id, guildId) : null;
		const state = normalizeState({
			userLimit: config.userLimit,
			bitrate: config.bitrate,
			...(saved ? JSON.parse(saved.prefs) : {}),
		});
		const name = state.name ?? config.nameTemplate.replace(/\{user\}/g, member.globalName ?? member.username ?? 'membre').slice(0, 100);
		state.name = name;
		const channelId = await executor.createVoiceRoom(guildId, { parentId: config.categoryId ?? await executor.parentOf(to), ownerId: member.id, ...state });
		q.insertRoom.run(channelId, guildId, hub.id, member.id, JSON.stringify(state), now());
		await executor.voiceMove(guildId, member.id, channelId, 'Vocal personnel').catch(() => null);
		// Left the voice meanwhile: nobody will ever leave this room, so it is deleted like an empty one
		if (!(await executor.voiceChannelMembers(channelId).catch(() => [null])).length) scheduleDelete(toRoom(q.room.get(channelId)), config.deleteAfterSeconds ?? 5);
		await executor.sendRoomPanel(channelId, { ownerId: member.id, options: config.options }).catch(error => logger.warn('Voice room panel not sent:', error.message));
		audit.record({ actorId: member.id, source: 'bot', action: 'voice.room_create', guildId, target: channelId, details: { name } });
		return getRoom(channelId);
	}

	const service = {
		hubs: guildId => q.hubs.all(guildId).map(toHub),
		rooms: guildId => q.rooms.all(guildId).map(toRoom),
		getRoom,
		isRoom: channelId => Boolean(q.room.get(channelId)),

		async createHub(actor, guildId, { channelId = null, categoryId = null, name = '➕ Créer un salon', config = {} }) {
			requireManage(actor, guildId);
			if (q.hubs.all(guildId).length >= 5) throw new ValidationError('5 salons « créer un vocal » maximum par serveur.');
			const id = channelId ?? await executor.createHubChannel(guildId, { name: String(name).slice(0, 100), categoryId });
			if (q.hubByChannel.get(id)) throw new ValidationError('Ce salon est déjà un salon « créer un vocal ».');
			const hubId = Number(q.insertHub.run(guildId, id, JSON.stringify(normalizeHub({ categoryId, ...config })), now()).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'voice.hub_add', guildId, target: id });
			return toHub(q.hub.get(hubId));
		},

		updateHub(actor, id, config) {
			const hub = toHub(q.hub.get(id));
			if (!hub) throw new NotFoundError('Salon « créer un vocal » introuvable.');
			requireManage(actor, hub.guildId);
			q.updateHub.run(JSON.stringify(normalizeHub(config)), id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'voice.hub_update', guildId: hub.guildId, target: hub.channelId });
			return toHub(q.hub.get(id));
		},

		async deleteHub(actor, id, { deleteChannel = false } = {}) {
			const hub = toHub(q.hub.get(id));
			if (!hub) throw new NotFoundError('Salon « créer un vocal » introuvable.');
			requireManage(actor, hub.guildId);
			q.deleteHub.run(id);
			if (deleteChannel) await executor.deleteChannel(hub.channelId, 'Salon « créer un vocal » supprimé').catch(() => null);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'voice.hub_delete', guildId: hub.guildId, target: hub.channelId });
		},

		// Voice moves: joining a hub creates a room; leaving a room may empty it
		async voiceMoved(guildId, member, { from, to }) {
			if (network.find(guildId)?.status !== 'active' || member.bot) return;
			if (from && q.room.get(from)) {
				const room = getRoom(from);
				const members = await executor.voiceChannelMembers(from).catch(() => []);
				if (!members.length) {
					const hub = room.hubId ? toHub(q.hub.get(room.hubId)) : null;
					scheduleDelete(room, hub?.config.deleteAfterSeconds ?? 5);
				}
			}
			if (to && q.room.get(to) && pendingDeletes.has(to)) {
				clearTimeout(pendingDeletes.get(to));
				pendingDeletes.delete(to);
			}
			const hub = to ? toHub(q.hubByChannel.get(to)) : null;
			if (!hub) return;
			const key = `${guildId}:${member.id}`;
			// Hopping in and out of the hub while the first room is being created must not create two
			if (creating.has(key)) return;
			creating.add(key);
			try {
				return await createRoom(guildId, member, hub, to);
			}
			finally {
				creating.delete(key);
			}
		},

		// --- Owner controls -------------------------------------------------------------------------
		async rename(userId, channelId, name) {
			const { room } = await control(userId, channelId, 'rename');
			const clean = String(name ?? '').trim().slice(0, 100);
			if (!clean) throw new ValidationError('Nom vide.');
			return persist(room, { ...room.state, name: clean });
		},

		async setLimit(userId, channelId, limit) {
			const { room } = await control(userId, channelId, 'limit');
			if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new ValidationError('Limite entre 0 (aucune) et 99.');
			return persist(room, { ...room.state, userLimit: limit });
		},

		async setLocked(userId, channelId, locked) {
			const { room } = await control(userId, channelId, 'lock');
			return persist(room, { ...room.state, locked });
		},

		async setHidden(userId, channelId, hidden) {
			const { room } = await control(userId, channelId, 'hide');
			return persist(room, { ...room.state, hidden });
		},

		async permit(userId, channelId, targetIds) {
			const { room } = await control(userId, channelId, 'permit');
			const ids = targetIds.filter(id => id !== room.ownerId);
			return persist(room, { ...room.state, permitted: [...new Set([...room.state.permitted, ...ids])], rejected: room.state.rejected.filter(id => !ids.includes(id)) });
		},

		async reject(userId, channelId, targetIds) {
			const { room } = await control(userId, channelId, 'reject');
			const ids = targetIds.filter(id => id !== room.ownerId);
			const updated = await persist(room, { ...room.state, rejected: [...new Set([...room.state.rejected, ...ids])], permitted: room.state.permitted.filter(id => !ids.includes(id)) });
			const inside = await executor.voiceChannelMembers(channelId).catch(() => []);
			for (const id of ids.filter(i => inside.includes(i))) await executor.voiceDisconnect(room.guildId, id, 'Bloqué du vocal').catch(() => null);
			return updated;
		},

		async kick(userId, channelId, targetId) {
			const { room } = await control(userId, channelId, 'kick');
			if (targetId === room.ownerId) throw new ValidationError('Tu ne peux pas t’expulser toi-même.');
			const inside = await executor.voiceChannelMembers(channelId).catch(() => []);
			if (!inside.includes(targetId)) throw new ValidationError('Cette personne n’est pas dans ton salon.');
			await executor.voiceDisconnect(room.guildId, targetId, 'Expulsé du vocal par son propriétaire');
		},

		async transfer(userId, channelId, targetId) {
			const { room } = await control(userId, channelId, 'transfer');
			const inside = await executor.voiceChannelMembers(channelId).catch(() => []);
			if (!inside.includes(targetId)) throw new ValidationError('Le nouveau propriétaire doit être dans le salon.');
			// Read again after waiting on Discord: a change made meanwhile is kept, a transfer made meanwhile wins
			const fresh = getRoom(channelId);
			if (fresh.ownerId !== userId) throw new ForbiddenError('Seul le propriétaire du salon peut faire ça.');
			audit.record({ actorId: userId, source: 'bot', action: 'voice.room_transfer', guildId: room.guildId, target: channelId, details: { to: `<@${targetId}>` } });
			return persist({ ...fresh, ownerId: targetId }, fresh.state);
		},

		// The owner left: someone still in the room takes it
		async claim(userId, channelId) {
			const { room } = await control(userId, channelId, 'claim');
			if (room.ownerId === userId) throw new ValidationError('Tu es déjà le propriétaire.');
			const inside = await executor.voiceChannelMembers(channelId).catch(() => []);
			if (!inside.includes(userId)) throw new ValidationError('Rejoins d’abord le salon.');
			if (inside.includes(room.ownerId)) throw new ValidationError('Le propriétaire est toujours là.');
			// Two people claiming at once: the first one keeps it
			const fresh = getRoom(channelId);
			if (fresh.ownerId !== room.ownerId) throw new ValidationError('Quelqu’un d’autre vient de prendre le salon.');
			return persist({ ...fresh, ownerId: userId }, fresh.state);
		},

		async setBitrate(userId, channelId, kbps) {
			const { room } = await control(userId, channelId, 'bitrate');
			return persist(room, { ...room.state, bitrate: kbps });
		},

		async setRegion(userId, channelId, region) {
			const { room } = await control(userId, channelId, 'region');
			if (region && !REGIONS.includes(region)) throw new ValidationError('Région inconnue.');
			return persist(room, { ...room.state, region: region || null });
		},

		async reset(userId, channelId) {
			const { room, hub } = await control(userId, channelId, 'rename');
			const state = normalizeState({ userLimit: hub?.config.userLimit ?? 0, bitrate: hub?.config.bitrate ?? null });
			state.name = room.state.name;
			return persist(room, state);
		},

		// From the panel: closes a room
		async closeRoom(actor, channelId) {
			const room = getRoom(channelId);
			requireManage(actor, room.guildId);
			q.deleteRoom.run(channelId);
			await executor.deleteChannel(channelId, `Vocal fermé depuis le panel par ${actor.id}`).catch(() => null);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'voice.room_close', guildId: room.guildId, target: channelId });
		},

		channelDeleted(channelId) {
			q.deleteRoom.run(channelId);
			q.deleteHubByChannel.run(channelId);
		},

		// On startup: rooms whose channel is gone are forgotten, empty ones are deleted
		async cleanup() {
			for (const room of q.allRooms.all().map(toRoom)) {
				const members = await executor.voiceChannelMembers(room.channelId).catch(() => null);
				if (members === null) q.deleteRoom.run(room.channelId);
				else if (!members.length) scheduleDelete(room, 1);
			}
		},
	};
	return service;
}
