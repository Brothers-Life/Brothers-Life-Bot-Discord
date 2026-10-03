// Links and searches -> tracks. YouTube (and anything yt-dlp reads: SoundCloud, Twitch, Vimeo...) directly;
// searches on YouTube, YouTube Music or SoundCloud;
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
	// Spotify app tokens (client credentials, about 1 h), per client id
	const spotifyTokens = new Map();

	async function spotifyToken({ clientId, clientSecret }) {
		const cached = spotifyTokens.get(clientId);
		if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
		const response = await fetchImpl('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
			body: 'grant_type=client_credentials',
		});
		if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? 'Clés Spotify refusées : vérifie le Client ID et le Client Secret dans les réglages musique.' : `Spotify ne répond pas (${response.status}).`);
		const { access_token: token, expires_in: expiresIn = 3600 } = await response.json();
		spotifyTokens.set(clientId, { token, expiresAt: Date.now() + expiresIn * 1000 });
		return token;
	}

	// Spotify Web API search: tracks keep their Spotify link, the sound comes from YouTube (see stream)
	async function spotifySearch(text, limit, keys) {
		const url = `https://api.spotify.com/v1/search?${new URLSearchParams({ q: text, type: 'track', limit: String(Math.min(Math.max(limit, 1), 10)), market: 'FR' })}`;
		let response = await fetchImpl(url, { headers: { Authorization: `Bearer ${await spotifyToken(keys)}` } });
		if (response.status === 401) {
			spotifyTokens.delete(keys.clientId);
			response = await fetchImpl(url, { headers: { Authorization: `Bearer ${await spotifyToken(keys)}` } });
		}
		if (response.status === 429) throw new Error('Spotify limite les recherches : réessaie dans un instant.');
		if (!response.ok) throw new Error(`Recherche Spotify impossible (${response.status}).`);
		const data = await response.json();
		return (data.tracks?.items ?? []).filter(Boolean).map((t) => {
			const artists = (t.artists ?? []).map(a => a.name).join(', ');
			return {
				title: t.name,
				author: artists || null,
				url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
				durationMs: t.duration_ms ?? null,
				thumbnail: t.album?.images?.[0]?.url ?? null,
				source: 'spotify',
				query: `${artists ? `${artists} - ` : ''}${t.name}`,
				live: false,
			};
		});
	}

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
		async resolve(text, platform = 'youtube', options = {}) {
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
			const [first] = await service.search(query, 1, platform, options);
			return { playlist: null, tracks: first ? [first] : [] };
		},

		// Search on a platform (autocomplete of /musique jouer, panel search box, player button)
		async search(text, limit = 5, platform = 'youtube', options = {}) {
			const key = `${platform}:${limit}:${text.toLowerCase()}`;
			const cached = searches.get(key);
			if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.results;
			if (platform === 'spotify') {
				if (!options.spotify) throw new Error('La recherche Spotify n’est pas configurée.');
				const results = await spotifySearch(text, limit, options.spotify);
				searches.set(key, { at: Date.now(), results });
				return results;
			}
			const target = {
				soundcloud: [`scsearch${limit}:${text}`],
				// Its "songs" tab: official audio rather than clips (flat results only give the title)
				ytmusic: ['--playlist-end', String(limit), `https://music.youtube.com/search?q=${encodeURIComponent(text)}#songs`],
			}[platform] ?? [`ytsearch${limit}:${text}`];
			const info = await ytdlp.json(['--flat-playlist', ...target], { timeout: 20_000 });
			const results = (info.entries ?? []).filter(Boolean).slice(0, limit).map(e => fromInfo(e));
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
