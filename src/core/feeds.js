import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload, normalizeTargets } from './announcements.js';
import { fillPayload } from './onboarding.js';
import { parseFeed } from './feedParser.js';
import { blockedHost, blockedUrl } from './netGuard.js';
import { createVariables } from './variables.js';

// Content feeds announced on Discord: any RSS / Atom feed, and TikTok through an RSS bridge (TikTok has no
// public API: its pages need signed requests, so a bridge such as RSSHub's /tiktok/user/@name route is used).
// Same permissions as the stream notifications (notifications.view / notifications.manage, defined in streams.js).

export const FEED_KINDS = { rss: 'Flux RSS / Atom', tiktok: 'TikTok' };
const COLORS = { rss: '#ff9628', tiktok: '#ff0050' };
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_PER_CHECK = 3;
const PER_TICK = 10;
const MAX_BACKOFF = 6 * 3_600_000;
const SEEN_KEEP = 90 * 86_400_000;
// An item dated well before the feed was first read is old news (reordered feed, item that came back)
const BACKDATED = 2 * 86_400_000;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; BrothersLifeBot/1.0; +feeds)', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' };

export const FEED_VARIABLES = [
	{ group: 'Publication', key: 'item.titre', label: 'Titre de la publication' },
	{ group: 'Publication', key: 'item.lien', label: 'Lien de la publication' },
	{ group: 'Publication', key: 'item.image', label: 'Image ou miniature' },
	{ group: 'Publication', key: 'item.description', label: 'Résumé (300 caractères max)' },
	{ group: 'Publication', key: 'item.auteur', label: 'Auteur' },
	{ group: 'Publication', key: 'item.date', label: 'Date de publication' },
	{ group: 'Vidéo (TikTok)', key: 'video.titre', label: 'Titre / légende de la vidéo' },
	{ group: 'Vidéo (TikTok)', key: 'video.lien', label: 'Lien de la vidéo' },
	{ group: 'Vidéo (TikTok)', key: 'video.image', label: 'Miniature de la vidéo' },
	{ group: 'Vidéo (TikTok)', key: 'chaine.nom', label: 'Nom du compte' },
	{ group: 'Flux', key: 'flux.nom', label: 'Nom affiché du flux' },
	{ group: 'Flux', key: 'flux.titre', label: 'Titre du flux (donné par le site)' },
	{ group: 'Flux', key: 'flux.lien', label: 'Site du flux' },
];

export function defaultFeedPayload(kind) {
	if (kind === 'tiktok') {
		return { content: '🎵 Nouvelle vidéo TikTok de **{chaine.nom}** !', embed: { title: '{video.titre}', url: '{video.lien}', imageUrl: '{video.image}', color: COLORS.tiktok, timestamp: true } };
	}
	return { content: '📰 Nouveau sur **{flux.nom}**', embed: { title: '{item.titre}', url: '{item.lien}', description: '{item.description}', imageUrl: '{item.image}', color: COLORS.rss, timestamp: true } };
}

function words(list) {
	return [...new Set((Array.isArray(list) ? list : []).map(w => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 20).map(w => w.slice(0, 50));
}

export function normalizeFeedConfig(input = {}, kind = 'rss') {
	const minutes = Math.round(Number(input.intervalMinutes));
	return {
		intervalMinutes: Number.isFinite(minutes) ? Math.min(1440, Math.max(5, minutes)) : kind === 'tiktok' ? 30 : 15,
		requireWords: words(input.requireWords),
		excludeWords: words(input.excludeWords),
	};
}

function passes(config, text) {
	const t = String(text ?? '').toLowerCase();
	if (config.requireWords.length && !config.requireWords.some(w => t.includes(w))) return false;
	return !config.excludeWords.some(w => t.includes(w));
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const keyOf = item => createHash('sha1').update(String(item.id ?? item.link ?? item.title)).digest('hex');
const httpsOrNull = value => (typeof value === 'string' && /^https?:\/\/\S+$/.test(value) ? value : null);

// A filled message still has to fit Discord: URLs that are not URLs are dropped, texts are cut
function fitPayload(payload) {
	const e = payload.embed;
	return {
		content: cut(payload.content ?? '', 2000),
		embed: {
			...e,
			title: cut(e.title ?? '', 256), description: cut(e.description ?? '', 4096), authorName: cut(e.authorName ?? '', 256), footerText: cut(e.footerText ?? '', 2048),
			url: httpsOrNull(e.url), imageUrl: httpsOrNull(e.imageUrl), thumbnailUrl: httpsOrNull(e.thumbnailUrl), authorIconUrl: httpsOrNull(e.authorIconUrl), footerIconUrl: httpsOrNull(e.footerIconUrl),
			fields: e.fields.map(f => ({ ...f, name: cut(f.name, 256), value: cut(f.value, 1024) })).filter(f => f.name.trim() && f.value.trim()),
		},
	};
}

function charsetOf(contentType, bytes) {
	const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
	const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(Buffer.from(bytes.subarray(0, 200)).toString('latin1'))?.[1];
	return (fromHeader ?? fromXml ?? 'utf-8').toLowerCase();
}

// Body of the response, refused past `max` bytes (the size given in advance or counted while reading)
async function readCapped(response, max) {
	const announced = Number(response.headers?.get?.('content-length'));
	if (announced > max) throw new Error('Flux trop volumineux (2 Mo maximum).');
	if (!response.body?.getReader) {
		const text = await response.text();
		if (text.length > max) throw new Error('Flux trop volumineux (2 Mo maximum).');
		return text;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => null);
			throw new Error('Flux trop volumineux (2 Mo maximum).');
		}
		chunks.push(value);
	}
	const bytes = Buffer.concat(chunks.map(c => Buffer.from(c)));
	try {
		return new TextDecoder(charsetOf(response.headers?.get?.('content-type'), bytes)).decode(bytes);
	}
	catch {
		return new TextDecoder('utf-8').decode(bytes);
	}
}

// fetchImpl(url, init) like fetch; lookup(host) -> [{ address }] (DNS, replaced in tests)
export function createFeedFetcher({ fetchImpl = fetch, lookup = host => dnsLookup(host, { all: true }) } = {}) {
	// Only public http(s) addresses: the panel user types the URL, the bot must not be used to reach its own network
	async function assertPublic(raw) {
		let url;
		try {
			url = new URL(raw);
		}
		catch {
			throw new ValidationError('Adresse du flux invalide.');
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ValidationError('Le flux doit être une adresse http:// ou https://.');
		if (url.username || url.password) throw new ValidationError('Pas d’identifiants dans l’adresse du flux.');
		const blocked = blockedUrl(url.href);
		if (blocked) throw new ValidationError(`Adresse du flux refusée (${blocked}).`);
		const host = url.hostname.replace(/^\[|\]$/g, '');
		if (isIP(host)) return url;
		let addresses;
		try {
			addresses = await lookup(host);
		}
		catch {
			throw new ValidationError(`Nom de domaine introuvable : ${host}.`);
		}
		for (const { address } of addresses ?? []) {
			const reason = blockedHost(address);
			if (reason) throw new ValidationError(`Adresse du flux refusée (${reason}).`);
		}
		return url;
	}

	// -> { notModified: true } or { text, etag, lastModified, url }
	return async function fetchFeed(raw, { etag = null, lastModified = null } = {}) {
		let current = raw;
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			const url = await assertPublic(current);
			const headers = { ...HEADERS };
			if (etag) headers['If-None-Match'] = etag;
			if (lastModified) headers['If-Modified-Since'] = lastModified;
			let response;
			try {
				response = await fetchImpl(url.href, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
			}
			catch (error) {
				throw new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'Le flux ne répond pas (10 s).' : `Flux injoignable (${error?.cause?.code ?? error?.message ?? 'erreur réseau'}).`);
			}
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				const location = response.headers?.get?.('location');
				if (!location) throw new Error('Le flux redirige sans adresse.');
				current = new URL(location, url).href;
				continue;
			}
			if (response.status === 304) return { notModified: true };
			if (!response.ok) throw new Error(`Le flux a répondu HTTP ${response.status}.`);
			const text = await readCapped(response, MAX_BYTES);
			return { text, etag: response.headers?.get?.('etag') ?? null, lastModified: response.headers?.get?.('last-modified') ?? null, url: url.href };
		}
		throw new Error('Trop de redirections.');
	};
}

export function createFeeds({ db, network, audit, executor, logs, fetchImpl = fetch, lookup, variables = null, logger = console, now = Date.now }) {
	logs.registerCategory('feed', 'Flux RSS et TikTok');
	const fetchFeed = createFeedFetcher({ fetchImpl, lookup });
	const vars = variables ?? createVariables({ executor, logger, now });
	let running = false;

	const q = {
		all: db.prepare('SELECT * FROM feed_subscriptions ORDER BY kind, display_name COLLATE NOCASE'),
		get: db.prepare('SELECT * FROM feed_subscriptions WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO feed_subscriptions (kind, url, display_name, targets, payload, config, enabled, created_by, created_at, updated_at)
			VALUES (@kind, @url, @displayName, @targets, @payload, @config, @enabled, @by, @at, @at)
		`),
		update: db.prepare('UPDATE feed_subscriptions SET url = @url, display_name = @displayName, targets = @targets, payload = @payload, config = @config, enabled = @enabled, updated_at = @at WHERE id = @id'),
		delete: db.prepare('DELETE FROM feed_subscriptions WHERE id = ?'),
		state: db.prepare('SELECT * FROM feed_state WHERE subscription_id = ?'),
		ensureState: db.prepare('INSERT OR IGNORE INTO feed_state (subscription_id) VALUES (?)'),
		resetState: db.prepare('DELETE FROM feed_state WHERE subscription_id = ?'),
		isSeen: db.prepare('SELECT 1 FROM feed_seen WHERE subscription_id = ? AND item_key = ?'),
		seen: db.prepare('INSERT INTO feed_seen (subscription_id, item_key, seen_at) VALUES (?, ?, ?) ON CONFLICT (subscription_id, item_key) DO UPDATE SET seen_at = excluded.seen_at'),
		clearSeen: db.prepare('DELETE FROM feed_seen WHERE subscription_id = ?'),
		pruneSeen: db.prepare('DELETE FROM feed_seen WHERE subscription_id = ? AND seen_at < ?'),
		history: db.prepare('INSERT INTO feed_history (subscription_id, kind, title, url, channels, at) VALUES (?, ?, ?, ?, ?, ?)'),
		recent: db.prepare(`
			SELECT h.*, s.display_name, s.kind AS feed_kind FROM feed_history h JOIN feed_subscriptions s ON s.id = h.subscription_id
			ORDER BY h.at DESC, h.id DESC LIMIT ?
		`),
	};

	function setState(id, patch) {
		q.ensureState.run(id);
		const keys = Object.keys(patch);
		db.prepare(`UPDATE feed_state SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE subscription_id = @id`).run({ ...patch, id });
	}

	function toState(row) {
		return {
			feedTitle: row?.feed_title ?? null, checkedAt: row?.checked_at ?? null, nextCheckAt: row?.next_check_at ?? null,
			failures: row?.failures ?? 0, error: row?.error ?? null, lastItemAt: row?.last_item_at ?? null, ready: Boolean(row?.initialized_at),
		};
	}

	function toSubscription(row) {
		if (!row) return null;
		return {
			id: row.id, kind: row.kind, url: row.url, displayName: row.display_name, targets: JSON.parse(row.targets), payload: JSON.parse(row.payload),
			config: normalizeFeedConfig(JSON.parse(row.config), row.kind), enabled: Boolean(row.enabled), createdBy: row.created_by, createdAt: row.created_at,
			state: toState(q.state.get(row.id)),
		};
	}

	function getOrThrow(id) {
		const s = toSubscription(q.get.get(id));
		if (!s) throw new NotFoundError('Flux introuvable.');
		return s;
	}

	function requireManage(actor) {
		if (!actor.can('notifications.manage')) throw new ForbiddenError('Permission manquante : notifications.manage');
	}

	function record(actor, action, s, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(s.id), details: { feed: `${FEED_KINDS[s.kind]} · ${s.displayName}`, ...details } });
	}
	const system = { id: 'system', source: 'system' };

	function itemVars(s, item, feedTitle, feedLink) {
		const title = cut(item.title || item.description || 'Nouvelle publication', 250);
		const author = item.author || s.displayName;
		return {
			'item.titre': title, 'item.lien': item.link ?? '', 'item.image': item.image ?? '', 'item.description': cut(item.description ?? '', 300),
			'item.auteur': author, 'item.date': item.publishedAt ? new Date(item.publishedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '',
			'video.titre': title, 'video.lien': item.link ?? '', 'video.image': item.image ?? '', 'chaine.nom': author,
			'flux.nom': s.displayName, 'flux.titre': feedTitle ?? s.displayName, 'flux.lien': feedLink ?? '',
		};
	}

	// One message per target channel, with that server's variables
	async function notify(s, item, feed, kind = 'item') {
		const own = itemVars(s, item, feed?.title, feed?.link);
		const servers = new Map();
		let sent = 0;
		for (const target of s.targets) {
			try {
				if (!servers.has(target.guildId)) servers.set(target.guildId, await vars.server(target.guildId).catch(() => ({})));
				const payload = fitPayload(fillPayload(s.payload, { ...servers.get(target.guildId), ...own }));
				await executor.sendAnnouncement(target.channelId, payload, target);
				sent++;
			}
			catch (error) {
				logger.warn(`Feed #${s.id} not sent to ${target.channelId}:`, error.message);
			}
		}
		q.history.run(s.id, kind, own['item.titre'], item.link ?? null, sent, now());
		return sent;
	}

	function markSeen(id, items) {
		const at = now();
		db.transaction(() => {
			for (const item of items) q.seen.run(id, keyOf(item), at);
		})();
	}

	// Remembers what the feed holds now, without announcing anything (first read, new URL)
	function initialize(id, feed, meta = {}) {
		q.clearSeen.run(id);
		markSeen(id, feed.items);
		const at = now();
		const s = toSubscription(q.get.get(id));
		setState(id, {
			feed_title: feed.title || null, initialized_at: at, checked_at: at, next_check_at: at + s.config.intervalMinutes * 60_000, failures: 0, error: null,
			etag: meta.etag ?? null, last_modified: meta.lastModified ?? null, last_item_at: Math.max(0, ...feed.items.map(i => i.publishedAt ?? 0)) || null,
		});
	}

	async function check(s) {
		const row = q.state.get(s.id);
		const result = await fetchFeed(s.url, row?.initialized_at ? { etag: row.etag, lastModified: row.last_modified } : {});
		const interval = s.config.intervalMinutes * 60_000;
		if (result.notModified) {
			setState(s.id, { checked_at: now(), next_check_at: now() + interval, failures: 0, error: null });
			return 0;
		}
		const feed = parseFeed(result.text);
		if (!row?.initialized_at) {
			initialize(s.id, feed, result);
			return 0;
		}
		const fresh = feed.items.filter(item => !q.isSeen.get(s.id, keyOf(item)));
		markSeen(s.id, feed.items);
		q.pruneSeen.run(s.id, now() - SEEN_KEEP);
		// Oldest first; undated items keep the feed order (newest first in feeds, hence the reverse)
		const candidates = fresh
			.filter(item => !(item.publishedAt && item.publishedAt < row.initialized_at - BACKDATED))
			.map((item, index) => ({ item, index }))
			.sort((a, b) => ((a.item.publishedAt ?? 0) - (b.item.publishedAt ?? 0)) || (b.index - a.index))
			.map(x => x.item)
			.slice(-MAX_PER_CHECK);
		let posted = 0;
		for (const item of candidates) {
			if (!passes(s.config, `${item.title} ${item.description}`)) continue;
			await notify(s, item, feed);
			record(system, 'feed.item', s, { title: item.title, url: item.link });
			posted++;
		}
		const newest = Math.max(row.last_item_at ?? 0, ...feed.items.map(i => i.publishedAt ?? 0)) || null;
		setState(s.id, {
			feed_title: feed.title || row.feed_title, checked_at: now(), next_check_at: now() + interval, failures: 0, error: null,
			etag: result.etag, last_modified: result.lastModified, last_item_at: newest,
		});
		return posted;
	}

	function failed(s, error) {
		const row = q.state.get(s.id);
		const failures = (row?.failures ?? 0) + 1;
		// Backoff: the interval doubles at each error in a row, 6 h at most
		const wait = Math.min(MAX_BACKOFF, s.config.intervalMinutes * 60_000 * 2 ** Math.min(failures, 10));
		setState(s.id, { checked_at: now(), next_check_at: now() + wait, failures, error: String(error?.message ?? error).slice(0, 300) });
	}

	async function validate(actor, input, current) {
		const kind = current?.kind ?? input.kind;
		if (!FEED_KINDS[kind]) throw new ValidationError('Type de flux inconnu.');
		const url = String(input.url ?? current?.url ?? '').trim();
		if (url.length > 500) throw new ValidationError('Adresse du flux trop longue.');
		if (!/^https?:\/\//i.test(url)) {
			throw new ValidationError(kind === 'tiktok'
				? 'Pour TikTok, colle l’adresse d’un flux RSS du compte (par exemple une instance RSSHub : https://…/tiktok/user/@pseudo).'
				: 'Colle l’adresse complète du flux (https://…).');
		}
		const targets = normalizeTargets(input.targets ?? current?.targets ?? []);
		if (!targets.length) throw new ValidationError('Choisis au moins un salon.');
		for (const t of targets) {
			if (network.find(t.guildId)?.status !== 'active') throw new ValidationError('Un des serveurs choisis ne fait pas partie du réseau.');
			if ((t.ping === 'everyone' || t.ping === 'here') && !actor.can('announcements.everyone')) throw new ForbiddenError('Permission manquante pour mentionner @everyone ou @here.');
		}
		const payload = normalizePayload(input.payload ?? current?.payload ?? defaultFeedPayload(kind));
		return {
			kind, url, targets, payload,
			displayName: String(input.displayName ?? current?.displayName ?? '').trim().slice(0, 100),
			config: normalizeFeedConfig(input.config ?? current?.config ?? {}, kind),
			enabled: input.enabled ?? current?.enabled ?? true,
		};
	}

	// Reads the feed now: a wrong address is refused at once, and what it holds is not announced
	async function read(url) {
		let result;
		try {
			result = await fetchFeed(url);
			return { feed: parseFeed(result.text), result };
		}
		catch (error) {
			if (error instanceof ValidationError) throw error;
			throw new ValidationError(`Flux illisible : ${error.message}`);
		}
	}

	return {
		list: () => q.all.all().map(toSubscription),
		get: getOrThrow,
		history: (limit = 100) => q.recent.all(limit).map(h => ({ id: h.id, subscriptionId: h.subscription_id, displayName: h.display_name, feedKind: h.feed_kind, kind: h.kind, title: h.title, url: h.url, channels: h.channels, at: h.at })),
		variables: () => {
			const groups = new Map();
			for (const v of FEED_VARIABLES) {
				if (!groups.has(v.group)) groups.set(v.group, { title: v.group, items: [] });
				groups.get(v.group).items.push({ key: v.key, label: v.label });
			}
			return [...groups.values()];
		},

		// Title and latest items of a feed, before following it
		async preview(actor, url) {
			requireManage(actor);
			const { feed } = await read(String(url ?? '').trim());
			return { title: feed.title, link: feed.link, items: feed.items.slice(0, 5).map(i => ({ title: i.title, link: i.link, image: i.image, author: i.author, publishedAt: i.publishedAt })) };
		},

		async save(actor, input) {
			requireManage(actor);
			const current = input.id ? getOrThrow(input.id) : null;
			const c = await validate(actor, input, current);
			const changedUrl = !current || current.url !== c.url;
			const fetched = changedUrl ? await read(c.url) : null;
			const displayName = c.displayName || fetched?.feed.title.slice(0, 100) || current?.displayName || new URL(c.url).hostname;
			const row = { ...c, displayName, targets: JSON.stringify(c.targets), payload: JSON.stringify(c.payload), config: JSON.stringify(c.config), enabled: c.enabled ? 1 : 0, at: now() };
			let id = current?.id;
			if (current) q.update.run({ ...row, id });
			else id = Number(q.insert.run({ ...row, by: actor.id }).lastInsertRowid);
			if (fetched) {
				q.resetState.run(id);
				initialize(id, fetched.feed, fetched.result);
			}
			const s = getOrThrow(id);
			record(actor, current ? 'feed.update' : 'feed.create', s, { url: s.url });
			return s;
		},

		async remove(actor, id) {
			requireManage(actor);
			const s = getOrThrow(id);
			q.delete.run(id);
			record(actor, 'feed.delete', s);
		},

		// Sample message in the feed's channels
		async test(actor, id) {
			requireManage(actor);
			const s = getOrThrow(id);
			const sent = await notify(s, {
				title: s.kind === 'tiktok' ? 'Vidéo de test · ceci est un exemple' : 'Publication de test · ceci est un exemple',
				link: s.url, description: 'Le message des nouvelles publications ressemblera à celui-ci.', author: s.displayName,
				image: 'https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg', publishedAt: now(),
			}, { title: s.state.feedTitle, link: null }, 'test');
			record(actor, 'feed.test', s, { channels: sent });
			return { sent, total: s.targets.length };
		},

		// Every minute: the feeds whose time has come (a few per tick), errors push the next check back
		async tick() {
			if (running) return;
			running = true;
			try {
				const due = q.all.all().map(toSubscription).filter(s => s.enabled && (s.state.nextCheckAt ?? 0) <= now()).slice(0, PER_TICK);
				for (const s of due) {
					try {
						await check(s);
					}
					catch (error) {
						logger.warn(`Feed #${s.id} check failed:`, error.message);
						failed(s, error);
					}
				}
			}
			finally {
				running = false;
			}
		},
	};
}
