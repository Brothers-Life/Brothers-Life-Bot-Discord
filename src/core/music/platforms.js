// Where a typed search (not a link) is looked up. yt-dlp searches each of them.
export const SEARCH_PLATFORMS = {
	youtube: 'YouTube',
	ytmusic: 'YouTube Music',
	soundcloud: 'SoundCloud',
	// Through the Spotify Web API (keys set in the music settings); played from the same song on YouTube
	spotify: 'Spotify',
};

// Short prefixes typed before a search, on Discord or in the panel: "sc: daft punk"
const PREFIXES = { yt: 'youtube', youtube: 'youtube', ytm: 'ytmusic', ytmusic: 'ytmusic', sc: 'soundcloud', soundcloud: 'soundcloud', sp: 'spotify', spotify: 'spotify' };

export const isPlatform = value => Object.hasOwn(SEARCH_PLATFORMS, value);

// Text of a search -> { platform, text }: a prefix wins, then the chosen platform, then the fallback
export function parseSearch(input, { platform = null, fallback = 'youtube' } = {}) {
	const raw = String(input ?? '').trim();
	const prefixed = /^([a-z]+)\s*:\s*(\S.*)$/is.exec(raw);
	const fromPrefix = prefixed ? PREFIXES[prefixed[1].toLowerCase()] : null;
	if (fromPrefix) return { platform: fromPrefix, text: prefixed[2].trim() };
	return { platform: isPlatform(platform) ? platform : isPlatform(fallback) ? fallback : 'youtube', text: raw };
}
