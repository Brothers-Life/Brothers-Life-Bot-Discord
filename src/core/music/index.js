import { definePermission } from '../permissions.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { createPlaylists } from './playlists.js';

definePermission('music.use', { label: 'Piloter la musique depuis le panel (et partout sur Discord, même sans rôle DJ)', category: 'Musique' });
definePermission('music.manage', { label: 'Régler la musique (rôles DJ, limites, départ automatique)', category: 'Musique' });

const SNOWFLAKE = /^\d{17,20}$/;
export const LOOPS = ['off', 'track', 'queue'];
export const FILTERS = {
	bassboost: 'Basses renforcées',
	nightcore: 'Nightcore',
	vaporwave: 'Vaporwave',
	'8d': 'Son 8D',
	karaoke: 'Karaoké (voix atténuée)',
	echo: 'Écho',
	tremolo: 'Trémolo',
	normalize: 'Volume égalisé',
};
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
// Everyone in the voice channel may add music and see the queue; the rest needs a DJ role when there are some
const OPEN_ACTIONS = new Set(['play', 'view']);

export function normalizeMusicConfig(input = {}) {
	const djRoles = {};
	for (const [guildId, ids] of Object.entries(input.djRoles ?? {})) {
		if (!SNOWFLAKE.test(guildId) || !Array.isArray(ids)) continue;
		const clean = [...new Set(ids.filter(id => SNOWFLAKE.test(id)))].slice(0, 20);
		if (clean.length) djRoles[guildId] = clean;
	}
	const clamp = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback);
	return {
		djRoles,
		defaultVolume: clamp(input.defaultVolume, 1, 200, 80),
		maxQueue: clamp(input.maxQueue, 10, 1000, 300),
		maxTrackMinutes: clamp(input.maxTrackMinutes, 0, 24 * 60, 0),
		idleMinutes: clamp(input.idleMinutes, 1, 60, 5),
		announce: input.announce !== false,
	};
}

// Music: one player per server. The queue and every decision live here; `backend` plays the sound
// (voice connection, ffmpeg) and `resolver` turns links or searches into tracks.
export function createMusic({ db, network, audit, settings, backend, resolver, executor, logger = console, now = Date.now }) {
	const players = new Map();
	let nextTrackId = 1;
	const listeners = new Set();
	const playlists = createPlaylists({ db, audit, now });

	function config() {
		return normalizeMusicConfig(settings.get('music.config', {}));
	}

	function emit(guildId) {
		const snapshot = players.has(guildId) ? view(players.get(guildId)) : { guildId, connected: false };
		for (const listener of listeners) {
			try {
				listener(snapshot);
			}
			catch {
				// a closed panel socket must not stop the music
			}
		}
		const player = players.get(guildId);
		if (player) refreshMessage(player);
	}

	function playerOf(guildId) {
		const player = players.get(guildId);
		if (!player) throw new ValidationError('Aucune musique en cours sur ce serveur.');
		return player;
	}

	function current(player) {
		return player.queue[player.index] ?? null;
	}

	function rateOf(player) {
		return player.speed * (player.filters.has('nightcore') ? 1.25 : 1) * (player.filters.has('vaporwave') ? 0.8 : 1);
	}

	function position(player) {
		if (!current(player)) return 0;
		return Math.max(0, Math.round(backend.position(player.guildId) ?? 0));
	}

	function view(player) {
		const track = current(player);
		return {
			guildId: player.guildId,
			connected: true,
			channelId: player.channelId,
			textChannelId: player.textChannelId,
			current: track,
			position: position(player),
			paused: player.paused,
			volume: player.volume,
			speed: player.speed,
			rate: rateOf(player),
			loop: player.loop,
			filters: [...player.filters],
			index: player.index,
			queue: player.queue,
			upcoming: player.queue.slice(player.index + 1),
			history: player.queue.slice(0, Math.max(0, player.index)),
			loading: player.loading,
		};
	}

	// keepPlace: edit the message where it is (periodic refresh) instead of bringing it back to the bottom
	async function refreshMessage(player, { keepPlace = false } = {}) {
		if (!config().announce || !player.textChannelId || !executor.upsertMusicMessage) return;
		clearTimeout(player.messageTimer);
		// Bursts of changes (skip, volume...) end up as one edit
		player.messageTimer = setTimeout(async () => {
			try {
				player.messageId = await executor.upsertMusicMessage(player.textChannelId, player.messageId, view(player), { keepPlace });
			}
			catch (error) {
				logger.warn('Music message failed:', error.message);
				// The chat of the voice channel is not usable: the channel where the music was asked for, once
				const fallback = player.fallbackTextChannelId;
				player.fallbackTextChannelId = null;
				player.textChannelId = fallback && fallback !== player.textChannelId ? fallback : null;
				player.messageId = null;
				if (player.textChannelId) refreshMessage(player);
			}
		}, player.messageId ? 800 : 0);
		player.messageTimer.unref?.();
	}

	// Starts the current track (again) at `seekMs`: used for a new track, a seek, a speed or filter change
	async function start(player, seekMs = 0) {
		const track = current(player);
		if (!track) {
			await backend.stop(player.guildId);
			player.idleSince = now();
			emit(player.guildId);
			return;
		}
		player.loading = true;
		player.idleSince = null;
		try {
			const stream = await resolver.stream(track);
			Object.assign(track, stream.track ?? {});
			const max = config().maxTrackMinutes;
			if (max && track.durationMs > max * 60_000) throw new ValidationError(`Trop long (plus de ${max} min).`);
			await backend.play(player.guildId, { target: stream.target, live: Boolean(track.live), seekMs, speed: player.speed, filters: [...player.filters], volume: player.volume });
			player.paused = false;
			player.errors = 0;
			// The next Spotify track is looked up on YouTube now, so that it starts without waiting
			const upcoming = player.queue[player.index + 1];
			if (upcoming && upcoming.source === 'spotify' && !upcoming.youtubeUrl) resolver.stream(upcoming).then(s => Object.assign(upcoming, s.track)).catch(() => undefined);
		}
		catch (error) {
			player.loading = false;
			logger.warn(`Music: « ${track.title} » unplayable:`, error.message);
			track.error = error.message;
			player.errors = (player.errors ?? 0) + 1;
			// A few broken tracks in a row: stop there instead of looping on errors
			if (player.errors >= 5) {
				await backend.stop(player.guildId);
				player.idleSince = now();
				emit(player.guildId);
				return;
			}
			return advance(player, { auto: true });
		}
		player.loading = false;
		emit(player.guildId);
	}

	// Next track, according to the loop mode (auto = the previous one ended by itself)
	async function advance(player, { auto = false, by = 1 } = {}) {
		if (auto && player.loop === 'track' && !current(player)?.error) return start(player);
		let next = player.index + by;
		if (next >= player.queue.length) {
			if (player.loop === 'queue' && player.queue.length) next = 0;
			else next = player.queue.length;
		}
		player.index = Math.max(0, next);
		return start(player);
	}

	function assertCan(ctx, player, action) {
		if (ctx.can?.('music.use')) return;
		if (ctx.source === 'panel') throw new ForbiddenError('Permission manquante : music.use');
		if (player?.channelId && ctx.voiceChannelId !== player.channelId) throw new ForbiddenError('Rejoins d’abord le salon vocal du bot.');
		if (OPEN_ACTIONS.has(action)) return;
		const dj = config().djRoles[player?.guildId ?? ctx.guildId] ?? [];
		if (dj.length && !(ctx.roleIds ?? []).some(id => dj.includes(id))) throw new ForbiddenError('Il faut un rôle DJ pour ça.');
	}

	function checkBefore(ctx, guildId, { channelId = ctx.voiceChannelId, now: playNow = false } = {}) {
		if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
		const player = players.get(guildId);
		assertCan(ctx, player, playNow ? 'jump' : 'play');
		if (!player && !channelId) throw new ValidationError('Rejoins un salon vocal (ou choisis-en un) pour que le bot vienne.');
	}

	// Adds tracks to the queue (joining the voice channel first if needed). The now-playing message goes
	// into the chat of the voice channel; the channel where the music was asked for is the fallback.
	// The player of this server, joining the voice channel first if the bot is not there yet
	async function ensurePlayer(guildId, channelId, textChannelId) {
		let player = players.get(guildId);
		if (!player) {
			await backend.join(guildId, channelId).catch((error) => { throw new ValidationError(error.message); });
			player = {
				guildId, channelId, textChannelId: channelId, fallbackTextChannelId: textChannelId,
				queue: [], index: 0, loop: 'off', volume: config().defaultVolume, speed: 1, filters: new Set(), paused: false, messageId: null, idleSince: null, loading: false,
			};
			players.set(guildId, player);
		}
		else if (textChannelId && !player.fallbackTextChannelId) {
			player.fallbackTextChannelId = textChannelId;
		}
		return player;
	}

	async function enqueue(ctx, guildId, found, { channelId = ctx.voiceChannelId, textChannelId = ctx.textChannelId ?? null, next = false, now: playNow = false, label = null, playlist = null } = {}) {
		const player = await ensurePlayer(guildId, channelId, textChannelId);
		const cfg = config();
		const room = cfg.maxQueue - (player.queue.length - player.index);
		if (room <= 0) throw new ValidationError(`La file est pleine (${cfg.maxQueue} titres).`);
		// Fresh queue entries (a track coming from a playlist or the history has no id, error or requester of its own)
		const tracks = found.slice(0, room).map((t) => {
			const copy = { ...t, id: nextTrackId++, requestedBy: ctx.actorId, addedAt: now() };
			delete copy.error;
			delete copy.requester;
			return copy;
		});
		const idle = !current(player);
		const at = idle ? player.queue.length : next || playNow ? player.index + 1 : player.queue.length;
		player.queue.splice(at, 0, ...tracks);
		if (idle || playNow) {
			player.index = at;
			await start(player);
		}
		else {
			emit(guildId);
		}
		record(ctx, guildId, 'play', { title: label ?? tracks[0].title, count: tracks.length });
		return { tracks, playlist, truncated: found.length > tracks.length, startedNow: idle || playNow, state: view(player) };
	}

	function record(ctx, guildId, verb, details = {}) {
		audit.record({ actorId: ctx.actorId, source: ctx.source === 'panel' ? 'panel' : 'bot', action: `music.${verb}`, guildId, details });
	}

	const service = {
		config,
		filters: FILTERS,

		setConfig(actor, input) {
			if (!actor.can('music.manage')) throw new ForbiddenError('Permission manquante : music.manage');
			const cfg = normalizeMusicConfig(input);
			settings.set('music.config', cfg);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'music.config' });
			return cfg;
		},

		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		state(guildId) {
			return players.has(guildId) ? view(players.get(guildId)) : { guildId, connected: false };
		},

		list: () => [...players.values()].map(view),

		search: (text, limit = 5) => resolver.search(text, limit).catch((error) => { throw new ValidationError(error.message); }),

		// ctx: { actorId, source: 'bot'|'panel', guildId, voiceChannelId, textChannelId, roleIds, can }
		async play(ctx, guildId, query, options = {}) {
			const text = String(query ?? '').trim();
			if (!text) throw new ValidationError('Donne un lien ou une recherche.');
			checkBefore(ctx, guildId, options);
			const found = await resolver.resolve(text).catch((error) => { throw error instanceof ValidationError ? error : new ValidationError(error.message); });
			if (!found.tracks.length) throw new ValidationError('Rien trouvé pour cette recherche.');
			return enqueue(ctx, guildId, found.tracks, { ...options, label: found.playlist?.title, playlist: found.playlist ?? null });
		},

		// The bot comes into the voice channel with an empty queue and posts its player, to search and add from there.
		// Already there: the player message comes back to the bottom of the chat.
		async join(ctx, guildId, { channelId = ctx.voiceChannelId, textChannelId = ctx.textChannelId ?? null } = {}) {
			checkBefore(ctx, guildId, { channelId });
			const existing = players.get(guildId);
			const player = await ensurePlayer(guildId, channelId, textChannelId);
			if (!existing) {
				// Nothing asked within the idle delay: it leaves like after the end of a queue
				player.idleSince = now();
				record(ctx, guildId, 'join');
			}
			emit(guildId);
			return { joined: !existing, state: view(player) };
		},

		// A saved playlist, in the queue
		async playPlaylist(ctx, guildId, id, { shuffle = false, ...options } = {}) {
			const list = playlists.get(id, ctx.actorId, { forPlay: true });
			if (!list.tracks.length) throw new ValidationError('Cette playlist est vide.');
			checkBefore(ctx, guildId, options);
			const tracks = [...list.tracks];
			if (shuffle) {
				for (let i = tracks.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[tracks[i], tracks[j]] = [tracks[j], tracks[i]];
				}
			}
			return enqueue(ctx, guildId, tracks, { ...options, label: list.name, playlist: { title: list.name, source: 'playlist', count: tracks.length } });
		},

		playlists,

		// The whole queue (history included) saved as a playlist
		saveQueue(ctx, guildId, { name, shared = true, id = null } = {}) {
			const player = playerOf(guildId);
			const tracks = player.queue.filter(t => !t.error);
			if (!tracks.length) throw new ValidationError('La file est vide.');
			return id ? playlists.addTracks(ctx, id, tracks) : playlists.create(ctx, { name, shared, tracks });
		},

		// A link (track, YouTube or Spotify playlist...) added to a saved playlist
		async addToPlaylist(ctx, id, query) {
			const text = String(query ?? '').trim();
			if (!text) throw new ValidationError('Donne un lien ou une recherche.');
			const found = await resolver.resolve(text).catch((error) => { throw error instanceof ValidationError ? error : new ValidationError(error.message); });
			if (!found.tracks.length) throw new ValidationError('Rien trouvé.');
			return playlists.addTracks(ctx, id, found.tracks);
		},

		// The track playing now, added to a playlist
		addCurrentTo(ctx, guildId, id) {
			const track = current(playerOf(guildId));
			if (!track) throw new ValidationError('Rien en cours.');
			return playlists.addTracks(ctx, id, [track]);
		},

		async pause(ctx, guildId, paused) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'pause');
			const target = paused ?? !player.paused;
			if (target) await backend.pause(guildId);
			else await backend.resume(guildId);
			player.paused = target;
			emit(guildId);
			return view(player);
		},

		async skip(ctx, guildId, count = 1) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'skip');
			if (!current(player)) throw new ValidationError('Rien à passer.');
			await advance(player, { by: Math.max(1, Math.floor(count)) });
			record(ctx, guildId, 'skip', { count });
			return view(player);
		},

		async previous(ctx, guildId) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'previous');
			// Past the first seconds, "previous" restarts the track
			if (current(player) && position(player) > 5000) {
				await start(player, 0);
				return view(player);
			}
			if (player.index === 0) throw new ValidationError('Pas de titre précédent.');
			player.index -= 1;
			await start(player);
			return view(player);
		},

		async jump(ctx, guildId, index) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'jump');
			if (!Number.isInteger(index) || index < 0 || index >= player.queue.length) throw new ValidationError('Position invalide dans la file.');
			player.index = index;
			await start(player);
			return view(player);
		},

		async seek(ctx, guildId, ms) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'seek');
			const track = current(player);
			if (!track) throw new ValidationError('Rien en cours.');
			if (track.live) throw new ValidationError('Impossible d’avancer dans un direct.');
			const target = Math.max(0, Math.round(ms));
			if (track.durationMs && target >= track.durationMs) return service.skip(ctx, guildId);
			await start(player, target);
			return view(player);
		},

		async setVolume(ctx, guildId, volume) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'volume');
			const value = Math.min(200, Math.max(0, Math.round(volume)));
			player.volume = value;
			await backend.setVolume(guildId, value);
			emit(guildId);
			return view(player);
		},

		// Speed and filters restart ffmpeg where the track is
		async setSpeed(ctx, guildId, speed) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'speed');
			if (!SPEEDS.includes(Number(speed))) throw new ValidationError(`Vitesse possible : ${SPEEDS.join(', ')}.`);
			const at = position(player);
			player.speed = Number(speed);
			if (current(player)) await start(player, at);
			else emit(guildId);
			return view(player);
		},

		async setFilters(ctx, guildId, filters) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'filters');
			const next = new Set(filters.filter(f => FILTERS[f]));
			if (next.has('nightcore') && next.has('vaporwave')) next.delete(player.filters.has('nightcore') ? 'nightcore' : 'vaporwave');
			const at = position(player);
			player.filters = next;
			if (current(player)) await start(player, at);
			else emit(guildId);
			return view(player);
		},

		setLoop(ctx, guildId, loop) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'loop');
			player.loop = LOOPS.includes(loop) ? loop : LOOPS[(LOOPS.indexOf(player.loop) + 1) % LOOPS.length];
			emit(guildId);
			return view(player);
		},

		// Upcoming tracks only: the current one keeps playing
		shuffle(ctx, guildId) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'shuffle');
			const upcoming = player.queue.splice(player.index + 1);
			for (let i = upcoming.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
			}
			player.queue.push(...upcoming);
			emit(guildId);
			return view(player);
		},

		// Indexes are positions in the whole queue (history included)
		async remove(ctx, guildId, index) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'remove');
			if (!Number.isInteger(index) || index < 0 || index >= player.queue.length) throw new ValidationError('Position invalide dans la file.');
			const [removed] = player.queue.splice(index, 1);
			if (index < player.index) player.index -= 1;
			else if (index === player.index) await start(player);
			emit(guildId);
			return { removed, state: view(player) };
		},

		move(ctx, guildId, from, to) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'move');
			const size = player.queue.length;
			if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < size)) throw new ValidationError('Position invalide dans la file.');
			const playing = player.queue[player.index];
			const [track] = player.queue.splice(from, 1);
			player.queue.splice(to, 0, track);
			player.index = player.queue.indexOf(playing);
			emit(guildId);
			return view(player);
		},

		// Upcoming tracks removed; the current one goes on
		clear(ctx, guildId) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'clear');
			player.queue.splice(player.index + 1);
			emit(guildId);
			return view(player);
		},

		async stop(ctx, guildId) {
			const player = playerOf(guildId);
			assertCan(ctx, player, 'stop');
			await service.leave(guildId);
			record(ctx, guildId, 'stop');
		},

		// The bot leaves the voice channel (also called when it is moved out or kicked)
		async leave(guildId, { reason = null } = {}) {
			const player = players.get(guildId);
			if (!player) return;
			players.delete(guildId);
			clearTimeout(player.messageTimer);
			await backend.leave(guildId).catch(() => undefined);
			if (player.textChannelId && player.messageId && executor.upsertMusicMessage) {
				await executor.upsertMusicMessage(player.textChannelId, player.messageId, { ...view(player), connected: false, ended: true, reason }).catch(() => undefined);
			}
			emit(guildId);
		},

		// The backend reports the end of a track (or an error while playing it)
		async trackEnded(guildId, { error = null } = {}) {
			const player = players.get(guildId);
			if (!player) return;
			if (error) {
				const track = current(player);
				if (track) track.error = error;
			}
			await advance(player, { auto: true });
		},

		// The bot was moved to another channel by someone
		moved(guildId, channelId) {
			const player = players.get(guildId);
			if (!player) return;
			if (!channelId) return service.leave(guildId, { reason: 'déconnecté' });
			const followed = player.textChannelId === player.channelId;
			if (followed && player.messageId) {
				executor.upsertMusicMessage?.(player.textChannelId, player.messageId, { ...view(player), connected: false, ended: true, reason: 'déplacé dans un autre salon' }).catch(() => undefined);
			}
			player.channelId = channelId;
			if (followed) {
				player.textChannelId = channelId;
				player.messageId = null;
			}
			emit(guildId);
		},

		// Every 30 s: leaves after a while alone in the channel, or with nothing to play
		async tick() {
			const limit = config().idleMinutes * 60_000;
			for (const player of [...players.values()]) {
				// Keeps the progress bar of the now-playing message roughly right
				if (current(player) && !player.paused) refreshMessage(player, { keepPlace: true });
				const alone = (await backend.listeners(player.guildId).catch(() => 1)) === 0;
				if (alone) player.aloneSince ??= now();
				else player.aloneSince = null;
				if ((player.aloneSince && now() - player.aloneSince >= limit) || (player.idleSince && now() - player.idleSince >= limit)) {
					await service.leave(player.guildId, { reason: player.aloneSince ? 'plus personne dans le salon' : 'file terminée' });
				}
			}
		},
	};
	return service;
}
