// Scam detection: known domains, lookalikes of Discord/Steam, and the usual bait sentences.
// Kept deliberately conservative: a false positive can ban a legit member on the whole network.

export const KNOWN_SCAM_DOMAINS = [
	'discord-nitro.gift', 'discordnitro.gift', 'discord-gift.com', 'discordgift.site', 'dlscord.gift', 'discorcl.gift',
	'discord-app.gift', 'discordapp.gift', 'nitro-discord.com', 'discord-airdrop.com', 'dicsord.gift', 'discrod.gift',
	'steamcommunnity.com', 'steamcomunity.com', 'stearncommunity.com', 'steamcommunity.gift', 'steam-gift.com',
	'steampowered.gift', 'stemcommunity.com', 'streamcommunity.com',
];

const OFFICIAL = new Set([
	'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discord.gift', 'discordstatus.com', 'discord.dev', 'discord.new',
	'steamcommunity.com', 'steampowered.com', 'store.steampowered.com', 'help.steampowered.com',
]);

// Lookalikes ("dlscord", "disc0rd", "discrod", "steamcomnmunity"...): a part of the host close to,
// but different from, a brand name. Distance = optimal string alignment (a swap counts as one edit).
const BRANDS = [
	{ name: 'discord', maxDistance: 1 },
	{ name: 'steamcommunity', maxDistance: 2 },
	{ name: 'steampowered', maxDistance: 2 },
];
const LEET = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', '$': 's', '!': 'i' };

function distance(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
	}
	return d[a.length][b.length];
}

function isLookalike(host) {
	const flat = host.replace(/\.[a-z]+$/, '').replace(/[-.]/g, '');
	const normalized = [...flat].map(c => LEET[c] ?? c).join('');
	for (const { name, maxDistance } of BRANDS) {
		// The real name spelled correctly (discordbotlist.com, steamcommunity-fans.net) is not a lookalike
		if (flat.includes(name)) continue;
		for (let size = name.length - 1; size <= name.length + 1; size++) {
			for (let start = 0; start + size <= normalized.length; start++) {
				const window = normalized.slice(start, start + size);
				// Leet spelling of the exact name (disc0rd, 5team...) or a near miss (dlscord, discrod)
				if (window === name || distance(window, name) <= maxDistance) return true;
			}
		}
	}
	return false;
}

const BAIT = [
	/free\s*nitro/i,
	/nitro\s*(gratuit|offert)/i,
	/discord\s*nitro\s*(for\s*)?free/i,
	/steam\s*(gift|cadeau)/i,
	/\bairdrop\b/i,
	/claim\s*(your|ton|votre)\s*(reward|gift|nft|nitro|prize)/i,
	/(crypto|bitcoin|btc|eth(ereum)?|usdt)\s*(giveaway|gratuit|free)/i,
	/double\s*(your|ton|vos)\s*(btc|eth|crypto|bitcoin)/i,
	/(i\s*(am|'m)\s*leaving\s*(cs|csgo|cs2|steam)|je\s*quitte\s*(cs|csgo|cs2))/i,
	/who\s*(is\s*)?first\s*\?.*(gift|nitro)/i,
];

const URL = /https?:\/\/([^\s/<>"')]+)/gi;
const BARE = /\b((?:[a-z0-9-]+\.)+(?:gift|gg|com|net|org|ru|xyz|site|online|fun|click|link|io|me|app|shop|store|top))(?:\/\S*)?/gi;

export function extractHosts(content) {
	const hosts = new Set();
	for (const [, host] of content.matchAll(URL)) hosts.add(host.toLowerCase().replace(/^www\./, '').split(':')[0]);
	for (const [, host] of content.matchAll(BARE)) hosts.add(host.toLowerCase().replace(/^www\./, ''));
	return [...hosts];
}

function isOfficial(host) {
	return [...OFFICIAL].some(domain => host === domain || host.endsWith(`.${domain}`));
}

function matchesDomain(host, domain) {
	return host === domain || host.endsWith(`.${domain}`);
}

// Returns a reason string when the message looks like a scam, otherwise null
export function detectScam(content, { customDomains = [], customPatterns = [], hasEveryone = false, blockEveryoneLinks = true } = {}) {
	const hosts = extractHosts(content);
	const suspiciousHosts = hosts.filter(h => !isOfficial(h));

	for (const host of suspiciousHosts) {
		const known = [...KNOWN_SCAM_DOMAINS, ...customDomains.map(d => d.toLowerCase().trim()).filter(Boolean)].find(d => matchesDomain(host, d));
		if (known) return `lien d’arnaque connu (${host})`;
		if (isLookalike(host)) return `faux lien Discord/Steam (${host})`;
	}

	const text = content.toLowerCase();
	const custom = customPatterns.filter(Boolean).find(p => text.includes(p.toLowerCase()));
	if (custom && hosts.length) return `motif interdit avec un lien (« ${custom} »)`;

	const bait = BAIT.find(re => re.test(content));
	if (bait && suspiciousHosts.length) return 'message d’appât avec un lien (nitro, steam, crypto…)';

	if (blockEveryoneLinks && hasEveryone && suspiciousHosts.length) return '@everyone avec un lien';
	return null;
}

const INVITE = /(discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/([a-z0-9-]+)/gi;

export function extractInvites(content) {
	return [...content.matchAll(INVITE)].map(m => m[2]);
}
