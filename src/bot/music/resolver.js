// Links and searches -> tracks. YouTube (and anything yt-dlp reads: SoundCloud, Twitch, Vimeo...) directly;
// Spotify through its public embed page (title, artists), then the same song is looked up on YouTube to be played.

const SPOTIFY = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{10,40})/i;
const URL_LIKE = /^https?:\/\//i;
const SEARCH_TTL = 10 * 60_000;

function thumbnailOf(info) {
	if (info.thumbnail) return info.thumbnail;
	const list = info.thumbnails ?? [];
	return list.at(-1)?.url ?? null;
}

function fromInfo(info, source = 'youtube') {
	const id = info.id;
	const url = info.webpage_url ?? (info.url && URL_LIKE.test(info.url) && !info.url.includes('googlevideo') ? info.url : null) ?? (id ? `https://www.youtube.com/watch?v=${id}` : null);
	return {
		title: info.title ?? 'Sans titre',
		author: info.channel ?? info.uploader ?? info.artist ?? null,
		url,
		durationMs: info.duration ? Math.round(info.duration * 1000) : null,
		thumbnail: thumbnailOf(info) ?? (id && /youtube/.test(url ?? '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
		source: /soundcloud/.test(url ?? '') ? 'soundcloud' : source,
		live: Boolean(info.is_live || info.live_status === 'is_live'),
	};
}

export function createMusicResolver({ ytdlp, fetchImpl = fetch }) {
	const searches = new Map();

	async function spotify(type, id) {
		const response = await fetchImpl(`https://open.spotify.com/embed/${type.toLowerCase()}/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'fr' } });
		if (!response.ok) throw new Error('Lien Spotify introuvable.');
		const html = await response.text();
		const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
		const entity = match ? JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity : null;
		if (!entity) throw new Error('Lien Spotify illisible.');
		const cover = entity.coverArt?.sources?.at(-1)?.url ?? entity.visualIdentity?.image?.at(-1)?.url ?? null;
		const toTrack = (t, artists) => ({
			title: t.title ?? t.name,
			author: artists,
			url: t.uri?.startsWith('spotify:track:') ? `https://open.spotify.com/track/${t.uri.split(':')[2]}` : `https://open.spotify.com/${type}/${id}`,
			durationMs: t.duration ?? null,
			thumbnail: cover,
			source: 'spotify',
			query: `${artists ? `${artists} - ` : ''}${t.title ?? t.name}`,
			live: false,
		});
		if (type.toLowerCase() === 'track') return { playlist: null, tracks: [toTrack(entity, (entity.artists ?? []).map(a => a.name).join(', '))] };
		const tracks = (entity.trackList ?? []).filter(t => t.isPlayable !== false).map(t => toTrack(t, t.subtitle ?? null));
		return { playlist: { title: entity.name ?? entity.title, author: entity.subtitle ?? null, source: 'spotify', count: tracks.length }, tracks };
	}

	const service = {
		async resolve(text) {
			const query = text.trim();
			const sp = SPOTIFY.exec(query);
			if (sp) return spotify(sp[1], sp[2]);
			if (URL_LIKE.test(query)) {
				// A video opened from a playlist: only that video (a /playlist link gives the whole list)
				const single = /[?&]v=|youtu\.be\//.test(query) && !/\/playlist\?/.test(query);
				const info = await ytdlp.json(['--flat-playlist', ...(single ? ['--no-playlist'] : []), query]);
				if (info._type === 'playlist') {
					const tracks = (info.entries ?? []).filter(e => e && e.title !== '[Private video]' && e.title !== '[Deleted video]').map(e => fromInfo(e));
					return { playlist: { title: info.title, author: info.channel ?? info.uploader ?? null, source: 'youtube', count: tracks.length }, tracks };
				}
				return { playlist: null, tracks: [fromInfo(info)] };
			}
			const [first] = await service.search(query, 1);
			return { playlist: null, tracks: first ? [first] : [] };
		},

		// YouTube search (autocomplete of /musique jouer, panel search box)
		async search(text, limit = 5) {
			const key = `${limit}:${text.toLowerCase()}`;
			const cached = searches.get(key);
			if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.results;
			const info = await ytdlp.json(['--flat-playlist', `ytsearch${limit}:${text}`], { timeout: 20_000 });
			const results = (info.entries ?? []).filter(Boolean).map(e => fromInfo(e));
			searches.set(key, { at: Date.now(), results });
			if (searches.size > 300) searches.delete(searches.keys().next().value);
			return results;
		},

		// What to hand to yt-dlp to get the sound: the link itself, or for Spotify the same song found on YouTube
		async stream(track) {
			if (track.source !== 'spotify') return { target: track.url, track: {} };
			if (track.youtubeUrl) return { target: track.youtubeUrl, track: {} };
			const [hit] = await service.search(`${track.query} audio`, 1);
			if (!hit) throw new Error('Titre introuvable sur YouTube.');
			return { target: hit.url, track: { youtubeUrl: hit.url, durationMs: track.durationMs ?? hit.durationMs } };
		},
	};
	return service;
}
