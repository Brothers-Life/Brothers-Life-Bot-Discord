import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';

const MAX_TRACKS = 500;
const MAX_PER_OWNER = 50;

// What is kept of a track in a playlist (no queue state: id, requester, errors...)
function keep(t) {
	return {
		title: String(t.title ?? 'Sans titre').slice(0, 200),
		author: t.author ? String(t.author).slice(0, 120) : null,
		url: t.url ?? null,
		durationMs: Number.isFinite(t.durationMs) ? t.durationMs : null,
		thumbnail: t.thumbnail ?? null,
		source: t.source ?? 'youtube',
		live: Boolean(t.live),
		...(t.query ? { query: t.query } : {}),
		...(t.youtubeUrl ? { youtubeUrl: t.youtubeUrl } : {}),
	};
}

// Saved playlists. ctx: { actorId, can }. Everyone who plays music may make their own;
// a shared one can be played by anyone, but only changed by its owner (or music.manage).
export function createPlaylists({ db, audit, now = Date.now }) {
	const q = {
		visible: db.prepare('SELECT * FROM music_playlists WHERE shared = 1 OR owner_id = ? ORDER BY updated_at DESC, id DESC'),
		get: db.prepare('SELECT * FROM music_playlists WHERE id = ?'),
		lock: db.prepare('SELECT * FROM music_playlists WHERE id = ? FOR UPDATE'),
		count: db.prepare('SELECT COUNT(*) AS n FROM music_playlists WHERE owner_id = ?'),
		insert: db.prepare('INSERT INTO music_playlists (name, owner_id, shared, tracks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
		update: db.prepare('UPDATE music_playlists SET name = ?, shared = ?, tracks = ?, updated_at = ? WHERE id = ?'),
		played: db.prepare('UPDATE music_playlists SET plays = plays + 1 WHERE id = ?'),
		remove: db.prepare('DELETE FROM music_playlists WHERE id = ?'),
	};

	const toPlaylist = (row) => {
		const tracks = JSON.parse(row.tracks);
		return {
			id: row.id, name: row.name, ownerId: row.owner_id, shared: Boolean(row.shared), plays: row.plays,
			tracks, count: tracks.length, durationMs: tracks.reduce((n, t) => n + (t.durationMs ?? 0), 0),
			cover: tracks.find(t => t.thumbnail)?.thumbnail ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
		};
	};

	function cleanName(name) {
		const text = String(name ?? '').trim();
		if (!text || text.length > 60) throw new ValidationError('Le nom fait entre 1 et 60 caractères.');
		return text;
	}

	// lock: inside a transaction, the row stays locked until it ends (read-change-write of the tracks)
	async function editable(ctx, id, { lock = false } = {}) {
		const list = await load(id, ctx.actorId, { lock });
		if (list.ownerId !== ctx.actorId && !ctx.can?.('music.manage')) throw new ForbiddenError('Seul son créateur peut modifier cette playlist.');
		return list;
	}

	async function load(id, userId, { forPlay = false, lock = false } = {}) {
		const row = await (lock ? q.lock : q.get).get(Number(id));
		if (!row || (!row.shared && row.owner_id !== String(userId))) throw new NotFoundError('Playlist introuvable.');
		if (forPlay) await q.played.run(row.id);
		return toPlaylist(row);
	}

	// Reads the playlist, applies change(list) -> patch and saves it in one transaction: two additions
	// at the same time must not lose one of them
	async function write(ctx, id, change, verb = null) {
		const { list, next } = await db.transaction(async () => {
			const saved = await editable(ctx, id, { lock: true });
			const changed = { ...saved, ...change(saved) };
			if (changed.tracks.length > MAX_TRACKS) throw new ValidationError(`Une playlist contient ${MAX_TRACKS} titres maximum.`);
			await q.update.run(changed.name, changed.shared ? 1 : 0, JSON.stringify(changed.tracks), now(), saved.id);
			return { list: saved, next: changed };
		})();
		if (verb) await audit.record({ actorId: ctx.actorId, source: ctx.source === 'panel' ? 'panel' : 'bot', action: `music.${verb}`, target: String(list.id), details: { playlist: next.name } });
		return service.get(list.id, ctx.actorId);
	}

	const service = {
		// Own playlists and the shared ones; `forPlay` also counts a play
		async list(userId) {
			return (await q.visible.all(String(userId))).map((row) => {
				const list = toPlaylist(row);
				delete list.tracks;
				return list;
			});
		},

		get(id, userId, { forPlay = false } = {}) {
			return load(id, userId, { forPlay });
		},

		// By name (autocomplete of /musique playlist)
		async suggest(userId, typed = '', { ownOnly = false } = {}) {
			const text = String(typed).toLowerCase();
			return (await service.list(userId)).filter(p => (!ownOnly || p.ownerId === String(userId)) && (!text || p.name.toLowerCase().includes(text))).slice(0, 25);
		},

		async create(ctx, { name, shared = true, tracks = [] }) {
			if ((await q.count.get(String(ctx.actorId))).n >= MAX_PER_OWNER) throw new ValidationError(`${MAX_PER_OWNER} playlists maximum par personne.`);
			const list = tracks.map(keep);
			if (list.length > MAX_TRACKS) throw new ValidationError(`Une playlist contient ${MAX_TRACKS} titres maximum.`);
			const at = now();
			const id = Number((await q.insert.run(cleanName(name), String(ctx.actorId), shared ? 1 : 0, JSON.stringify(list), at, at)).lastInsertRowid);
			await audit.record({ actorId: ctx.actorId, source: ctx.source === 'panel' ? 'panel' : 'bot', action: 'music.playlist_create', target: String(id), details: { playlist: String(name).trim(), count: list.length } });
			return service.get(id, ctx.actorId);
		},

		async update(ctx, id, { name, shared }) {
			return write(ctx, id, () => ({ ...(name !== undefined ? { name: cleanName(name) } : {}), ...(shared !== undefined ? { shared: Boolean(shared) } : {}) }), 'playlist_update');
		},

		async addTracks(ctx, id, tracks) {
			const added = tracks.map(keep);
			return write(ctx, id, list => ({ tracks: [...list.tracks, ...added] }));
		},

		async removeTrack(ctx, id, index) {
			return write(ctx, id, (list) => {
				if (!Number.isInteger(index) || index < 0 || index >= list.tracks.length) throw new ValidationError('Titre introuvable dans la playlist.');
				return { tracks: list.tracks.filter((_, i) => i !== index) };
			});
		},

		async moveTrack(ctx, id, from, to) {
			return write(ctx, id, (list) => {
				const tracks = [...list.tracks];
				if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < tracks.length)) throw new ValidationError('Position invalide.');
				const [track] = tracks.splice(from, 1);
				tracks.splice(to, 0, track);
				return { tracks };
			});
		},

		async remove(ctx, id) {
			const list = await editable(ctx, id);
			await q.remove.run(list.id);
			await audit.record({ actorId: ctx.actorId, source: ctx.source === 'panel' ? 'panel' : 'bot', action: 'music.playlist_delete', target: String(list.id), details: { playlist: list.name } });
		},
	};
	return service;
}
