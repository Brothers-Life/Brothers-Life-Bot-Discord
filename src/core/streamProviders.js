// Stream platforms: who is live, latest videos. Each function returns plain data, errors are thrown with a French message.

import { findNode, nodeText, parseFeed } from './feedParser.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; BrothersLifeBot/1.0)', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' };
// YouTube pages asked from the EU may first redirect to a consent wall: this cookie declines the optional cookies
const YT = { ...UA, Cookie: 'SOCS=CAI' };

function chunk(list, size) {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

function decode(text) {
	return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
}

// App tokens (client credentials), kept until shortly before they expire
export function createTokenCache({ fetchImpl, now = Date.now }) {
	const tokens = new Map();
	return async function token(key, url, clientId, clientSecret) {
		const cached = tokens.get(key);
		if (cached && cached.clientId === clientId && cached.expiresAt > now() + 60_000) return cached.value;
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString(),
		});
		if (!response.ok) throw new Error(`Identifiants ${key} refusés (HTTP ${response.status}).`);
		const data = await response.json();
		tokens.set(key, { value: data.access_token, clientId, expiresAt: now() + Number(data.expires_in ?? 3600) * 1000 });
		return data.access_token;
	};
}

// --- Twitch (Helix) ---------------------------------------------------------------------------------
// logins -> Map(login -> { id, title, game, viewers, thumbnail, startedAt, name, url })
export async function twitchLive({ fetchImpl, token, clientId, clientSecret }, logins) {
	const access = await token('twitch', 'https://id.twitch.tv/oauth2/token', clientId, clientSecret);
	const live = new Map();
	for (const part of chunk(logins, 100)) {
		const query = part.map(l => `user_login=${encodeURIComponent(l)}`).join('&');
		const response = await fetchImpl(`https://api.twitch.tv/helix/streams?first=100&${query}`, { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } });
		if (!response.ok) throw new Error(`Twitch a répondu HTTP ${response.status}.`);
		for (const s of (await response.json()).data ?? []) {
			live.set(s.user_login.toLowerCase(), {
				id: s.id, title: s.title ?? '', game: s.game_name ?? '', viewers: s.viewer_count ?? 0, name: s.user_name ?? s.user_login, tags: s.tags ?? [],
				thumbnail: (s.thumbnail_url ?? '').replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`,
				startedAt: Date.parse(s.started_at) || null, url: `https://twitch.tv/${s.user_login}`,
			});
		}
	}
	return live;
}

// --- Kick (public API) ------------------------------------------------------------------------------
export async function kickLive({ fetchImpl, token, clientId, clientSecret }, slugs) {
	const access = await token('Kick', 'https://id.kick.com/oauth/token', clientId, clientSecret);
	const live = new Map();
	for (const part of chunk(slugs, 50)) {
		const query = part.map(s => `slug=${encodeURIComponent(s)}`).join('&');
		const response = await fetchImpl(`https://api.kick.com/public/v1/channels?${query}`, { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } });
		if (!response.ok) throw new Error(`Kick a répondu HTTP ${response.status}.`);
		for (const c of (await response.json()).data ?? []) {
			if (!c.stream?.is_live) continue;
			live.set(c.slug.toLowerCase(), {
				// Kick has no stream id: the start time identifies the live
				id: c.stream.start_time ?? String(c.broadcaster_user_id), title: c.stream_title ?? '', game: c.category?.name ?? '', viewers: c.stream.viewer_count ?? 0,
				name: c.slug, thumbnail: c.stream.thumbnail ?? '', startedAt: Date.parse(c.stream.start_time) || null, url: `https://kick.com/${c.slug}`,
			});
		}
	}
	return live;
}

// --- YouTube ----------------------------------------------------------------------------------------
// "@handle", a channel link (/channel/UC…, /@nom, /c/nom, /user/nom) or "UC…" -> channel id
export async function youtubeChannelId({ fetchImpl }, input) {
	const value = String(input).trim();
	const direct = /(UC[\w-]{22})/.exec(value);
	if (direct) return direct[1];
	const path = /youtube\.com\/((?:c|user)\/[\w.-]+|@[\w.%-]+)/i.exec(value)?.[1] ?? /^@[\w.-]+$/.exec(value)?.[0];
	if (!path) throw new Error('Donne la chaîne YouTube : @nom, lien de la chaîne ou identifiant UC….');
	const response = await fetchImpl(`https://www.youtube.com/${path}`, { headers: YT });
	if (!response.ok) throw new Error(`Chaîne YouTube ${path} introuvable.`);
	const html = await response.text();
	const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1]
		?? /"(?:externalId|channelId)":"(UC[\w-]{22})"/.exec(html)?.[1] ?? /channel\/(UC[\w-]{22})/.exec(html)?.[1];
	if (!id) throw new Error(`Chaîne YouTube ${path} introuvable.`);
	return id;
}

// Latest uploads from the public Atom feed (newest first); Shorts are recognised by their /shorts/ link
export async function youtubeVideos({ fetchImpl }, channelId) {
	const response = await fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: UA });
	if (!response.ok) throw new Error(`Flux YouTube indisponible (HTTP ${response.status}).`);
	const feed = parseFeed(await response.text());
	return feed.items.map((item) => {
		const id = nodeText(findNode(item.node, 'yt:videoId')) || /(?:v=|shorts\/)([\w-]{11})/.exec(item.link ?? '')?.[1];
		const url = item.link ?? `https://www.youtube.com/watch?v=${id}`;
		return {
			id, title: item.title, url, short: url.includes('/shorts/'), name: feed.author || item.author || feed.title,
			description: item.description, publishedAt: item.publishedAt ?? 0,
			thumbnail: item.image ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
			viewers: Number(findNode(item.node, 'media:statistics')?.attrs.views ?? 0),
		};
	}).filter(v => v.id).sort((a, b) => b.publishedAt - a.publishedAt);
}

// Current live of a channel: YouTube Data API when a key is given, otherwise the channel's /live page
export async function youtubeLive({ fetchImpl, apiKey }, channelId) {
	if (apiKey) {
		const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${encodeURIComponent(apiKey)}`);
		if (!response.ok) throw new Error(`API YouTube : HTTP ${response.status}.`);
		const item = (await response.json()).items?.[0];
		if (!item) return null;
		const id = item.id.videoId;
		return { id, title: decode(item.snippet.title ?? ''), game: '', viewers: 0, name: item.snippet.channelTitle ?? '', thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault_live.jpg`, startedAt: null, url: `https://www.youtube.com/watch?v=${id}` };
	}
	const response = await fetchImpl(`https://www.youtube.com/channel/${channelId}/live`, { headers: YT });
	if (!response.ok) return null;
	const html = await response.text();
	if (!/"isLiveNow":true/.test(html)) return null;
	const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html)?.[1] ?? /"videoId":"([\w-]{11})"/.exec(html)?.[1];
	if (!id) return null;
	const title = decode(/<meta name="title" content="([^"]*)"/.exec(html)?.[1] ?? '');
	const name = decode(/"ownerChannelName":"([^"]*)"/.exec(html)?.[1] ?? '');
	const viewers = Number(/"concurrentViewers":"(\d+)"/.exec(html)?.[1] ?? 0);
	return { id, title, game: '', viewers, name, thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault_live.jpg`, startedAt: null, url: `https://www.youtube.com/watch?v=${id}` };
}

// TikTok has no public API for lives: the endpoint of its own web site answers without a key, one account per call
// (an empty answer without a browser User-Agent)
const TIKTOK_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Accept: 'application/json', 'Accept-Language': 'fr-FR,fr;q=0.9' };
const TIKTOK_LIVE = 2;

export async function tiktokLive({ fetchImpl }, username) {
	const response = await fetchImpl(`https://www.tiktok.com/api-live/user/room/?aid=1988&app_name=tiktok_web&device_platform=web_pc&sourceType=54&uniqueId=${encodeURIComponent(username)}`, { headers: TIKTOK_HEADERS });
	if (response.status === 429) throw new Error('TikTok limite les requêtes pour le moment : nouvel essai à la prochaine vérification.');
	if (!response.ok) throw new Error(`TikTok a répondu HTTP ${response.status}.`);
	const body = await response.json().catch(() => null);
	if (body?.message === 'user_not_found') throw new Error('Compte TikTok introuvable.');
	const user = body?.data?.user;
	if (!user) throw new Error('TikTok n’a pas donné l’état du compte (réessai à la prochaine vérification).');
	const room = body.data.liveRoom ?? {};
	if (room.status !== TIKTOK_LIVE && user.status !== TIKTOK_LIVE) return null;
	return {
		// One room per live
		id: String(user.roomId || room.startTime), title: room.title ?? '', game: '', viewers: room.liveRoomStats?.userCount ?? 0,
		name: user.nickname || user.uniqueId, thumbnail: room.coverUrl ?? '', startedAt: room.startTime ? room.startTime * 1000 : null,
		url: `https://www.tiktok.com/@${user.uniqueId}/live`,
	};
}

// Latest videos of a TikTok account (the 10 newest), read from the account's public embed page, which holds them in
// its page state: no key, no signed request. -> { title, link, items: [{ id, title, link, description, image, author,
// publishedAt }] } like a parsed feed. Video ids carry their creation time (upper 32 bits, in seconds).
export async function tiktokVideos({ fetchImpl }, username) {
	const response = await fetchImpl(`https://www.tiktok.com/embed/@${encodeURIComponent(username)}`, { headers: TIKTOK_HEADERS });
	if (response.status === 400 || response.status === 404) throw new Error('Compte TikTok introuvable.');
	if (response.status === 429) throw new Error('TikTok limite les requêtes pour le moment : nouvel essai plus tard.');
	if (!response.ok) throw new Error(`TikTok a répondu HTTP ${response.status}.`);
	const html = await response.text();
	const raw = /<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
	let page = null;
	try {
		page = raw ? Object.values(JSON.parse(raw).source?.data ?? {}).find(d => d?.userInfo) : null;
	}
	catch {
		page = null;
	}
	if (!page) throw new Error('TikTok n’a pas donné les vidéos du compte (réessai plus tard).');
	if (page.errorCode || !page.userInfo?.nickname) throw new Error('Compte TikTok introuvable.');
	if (page.userInfo.privateAccount) throw new Error('Ce compte TikTok est privé : ses vidéos ne sont pas visibles.');
	const user = page.userInfo;
	const items = (page.videoList ?? []).filter(v => /^\d+$/.test(String(v.id ?? '')) && !v.privateItem).map(v => ({
		id: String(v.id), title: v.desc ?? '', description: v.desc ?? '', link: `https://www.tiktok.com/@${user.uniqueId}/video/${v.id}`,
		image: v.coverUrl || v.originCoverUrl || null, author: user.nickname, publishedAt: Number(BigInt(v.id) >> 32n) * 1000,
	})).sort((a, b) => b.publishedAt - a.publishedAt);
	return { title: user.nickname, link: `https://www.tiktok.com/@${user.uniqueId}`, items };
}
