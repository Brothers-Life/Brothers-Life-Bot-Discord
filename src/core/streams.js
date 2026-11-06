import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload, normalizeTargets } from './announcements.js';
import { fillPayload } from './onboarding.js';
import { filterWords, passesWords } from './wordFilter.js';
import { createTokenCache, kickLive, tiktokLive, twitchClips, twitchLive, youtubeChannelId, youtubeLive, youtubeVideos } from './streamProviders.js';

definePermission('notifications.view', { label: 'Voir les notifications de streams et vidéos', category: 'Communauté' });
definePermission('notifications.manage', { label: 'Gérer les notifications de streams et vidéos (et les clés des plateformes)', category: 'Communauté' });

const SNOWFLAKE = /^\d{17,20}$/;
const YOUTUBE_EVERY = 5 * 60_000;
const CLIPS_EVERY = 5 * 60_000;
// A clip can reach the Twitch API after a newer one: the recent ones are read again, the history tells which are done
const CLIP_WINDOW = 30 * 60_000;
const PER_CHECK = 3;
const COLORS = { twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18', tiktok: '#ff0050' };
export const PLATFORMS = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick', tiktok: 'TikTok' };
// What each platform can announce. `clip` = Twitch clips and YouTube Shorts
export const STREAM_KINDS = { twitch: ['live', 'clip'], youtube: ['live', 'video', 'clip'], kick: ['live'], tiktok: ['live'] };
const KIND_LABELS = { live: 'les lives', video: 'les vidéos', clip: 'les clips' };
const KIND_ENABLED = { live: 'lives', video: 'videos', clip: 'shorts' };
// Stored in stream_history, whose CHECK has one kind for short formats
const HISTORY_KINDS = { clip: 'short' };

// Page of a followed channel
export function channelUrl(platform, channel) {
	if (platform === 'youtube') return `https://www.youtube.com/channel/${channel}`;
	if (platform === 'tiktok') return `https://www.tiktok.com/@${channel}/live`;
	return `https://${platform === 'twitch' ? 'twitch.tv' : 'kick.com'}/${channel}`;
}

export function defaultPayloads(platform) {
	const color = COLORS[platform];
	return {
		live: { content: '🔴 **{streamer}** est en live !', embed: { title: '{title}', url: '{url}', description: platform === 'tiktok' ? '👀 {viewers} spectateurs' : '🎮 {game}\n👀 {viewers} spectateurs', imageUrl: '{thumbnail}', color, timestamp: true } },
		video: { content: '📺 Nouvelle vidéo de **{streamer}** !', embed: { title: '{title}', url: '{url}', imageUrl: '{thumbnail}', color, timestamp: true } },
		clip: { content: `🎬 Nouveau ${platform === 'youtube' ? 'Short' : 'clip'} de **{streamer}** !`, embed: { title: '{title}', url: '{url}', imageUrl: '{thumbnail}', color, timestamp: true } },
	};
}

// Channels of a kind: videos and clips use the lives' channels unless they have their own
function targetsOf(s, kind) {
	return (kind !== 'live' && s.config[`${kind}Targets`]) || s.targets;
}

// Subscriptions saved before clips had a message: Shorts used the video message
function withClipPayload(platform, payloads) {
	return { ...payloads, clip: payloads.clip ?? (platform === 'youtube' ? payloads.video : normalizePayload(defaultPayloads(platform).clip)) };
}

export function normalizeStreamConfig(input = {}) {
	const role = input.liveRole ?? {};
	const roles = {};
	for (const [guildId, roleId] of Object.entries(role.roleByGuild ?? {})) if (SNOWFLAKE.test(guildId) && SNOWFLAKE.test(roleId)) roles[guildId] = roleId;
	return {
		lives: input.lives !== false,
		videos: input.videos !== false,
		shorts: Boolean(input.shorts),
		requireWords: filterWords(input.requireWords),
		excludeWords: filterWords(input.excludeWords),
		endAction: ['edit', 'delete', 'none'].includes(input.endAction) ? input.endAction : 'edit',
		liveRole: { userId: SNOWFLAKE.test(role.userId ?? '') ? role.userId : null, roleByGuild: roles },
		// null = same channels as the lives
		videoTargets: Array.isArray(input.videoTargets) ? normalizeTargets(input.videoTargets.slice(0, 50)) : null,
		clipTargets: Array.isArray(input.clipTargets) ? normalizeTargets(input.clipTargets.slice(0, 50)) : null,
	};
}

// Text checked by the word filters: the title, the live's tags (Twitch) as #tags, the video's description (YouTube,
// where hashtags usually are)
function filterText(item) {
	return [item.title, ...(item.tags ?? []).map(t => `#${t}`), item.description].filter(Boolean).join('\n');
}

function durationText(ms) {
	const minutes = Math.max(1, Math.round(ms / 60_000));
	const h = Math.floor(minutes / 60);
	return h ? `${h} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

export function createStreams({ db, network, audit, executor, settings, logs, variables = null, fetchImpl = fetch, logger = console, now = Date.now }) {
	logs.registerCategory('stream', 'Notifications de streams et vidéos');
	const token = createTokenCache({ fetchImpl, now });
	const twitchIds = new Map();

	const q = {
		all: db.prepare('SELECT * FROM stream_subscriptions ORDER BY platform, lower(display_name), id'),
		get: db.prepare('SELECT * FROM stream_subscriptions WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO stream_subscriptions (platform, channel, display_name, targets, payloads, config, enabled, created_by, created_at, updated_at)
			VALUES (@platform, @channel, @displayName, @targets, @payloads, @config, @enabled, @by, @at, @at)
		`),
		update: db.prepare('UPDATE stream_subscriptions SET channel = @channel, display_name = @displayName, targets = @targets, payloads = @payloads, config = @config, enabled = @enabled, updated_at = @at WHERE id = @id'),
		delete: db.prepare('DELETE FROM stream_subscriptions WHERE id = ?'),
		state: db.prepare('SELECT * FROM stream_state WHERE subscription_id = ?'),
		ensureState: db.prepare('INSERT INTO stream_state (subscription_id) VALUES (?) ON CONFLICT DO NOTHING'),
		history: db.prepare('INSERT INTO stream_history (subscription_id, kind, title, url, channels, at) VALUES (?, ?, ?, ?, ?, ?)'),
		announced: db.prepare('SELECT url FROM stream_history WHERE subscription_id = ? AND at >= ?'),
		recent: db.prepare(`
			SELECT h.*, s.display_name, s.platform FROM stream_history h JOIN stream_subscriptions s ON s.id = h.subscription_id
			ORDER BY h.at DESC, h.id DESC LIMIT ?
		`),
	};

	async function setState(id, patch) {
		await q.ensureState.run(id);
		const keys = Object.keys(patch);
		await db.prepare(`UPDATE stream_state SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE subscription_id = @id`).run({ ...patch, id });
	}

	function toState(row) {
		if (!row) return { live: false, liveId: null, title: null, game: null, peakViewers: 0, startedAt: null, messages: [], roleHolders: [], lastVideoId: null, lastVideoAt: null, checkedAt: null, error: null };
		return {
			live: row.live_started_at !== null, liveId: row.live_id, title: row.live_title, game: row.live_game, peakViewers: row.peak_viewers, startedAt: row.live_started_at,
			messages: JSON.parse(row.live_messages), roleHolders: JSON.parse(row.role_holders), lastVideoId: row.last_video_id, lastVideoAt: row.last_video_at,
			checkedAt: Math.max(row.checked_at ?? 0, row.videos_checked_at ?? 0) || null, error: row.error,
		};
	}

	async function toSubscription(row) {
		if (!row) return null;
		return {
			id: row.id, platform: row.platform, channel: row.channel, displayName: row.display_name, targets: JSON.parse(row.targets),
			payloads: withClipPayload(row.platform, JSON.parse(row.payloads)), config: normalizeStreamConfig(JSON.parse(row.config)), enabled: Boolean(row.enabled),
			createdBy: row.created_by, createdAt: row.created_at, state: toState(await q.state.get(row.id)),
		};
	}

	async function getOrThrow(id) {
		const s = await toSubscription(await q.get.get(id));
		if (!s) throw new NotFoundError('Abonnement introuvable.');
		return s;
	}

	function requireManage(actor) {
		if (!actor.can('notifications.manage')) throw new ForbiddenError('Permission manquante : notifications.manage');
	}

	async function credentials() {
		return settings.get('streams.credentials', {});
	}

	async function record(actor, action, s, details = {}) {
		await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(s.id), details: { channel: `${PLATFORMS[s.platform]} · ${s.displayName}`, ...details } });
	}

	const system = { id: 'system', source: 'system' };

	// Message of a live, a video or a clip, sent to the channels of that kind
	// `logAs`: kind written in the history (`test` for a test)
	async function notify(s, kind, data, logAs = HISTORY_KINDS[kind] ?? kind) {
		const own = {
			streamer: data.name || s.displayName, title: data.title, game: data.game || '—', url: data.url, thumbnail: data.thumbnail, viewers: data.viewers ?? 0,
			// French names shared with the feed messages
			'chaine.nom': data.name || s.displayName, 'video.titre': data.title, 'video.lien': data.url, 'video.image': data.thumbnail, 'clip.auteur': data.creator ?? '',
		};
		const template = s.payloads[kind];
		const servers = new Map();
		let payload = fillPayload(template, own);
		const messages = [];
		for (const target of targetsOf(s, kind)) {
			try {
				// Common server variables ({server}, {date}…) of the target's server
				if (variables) {
					if (!servers.has(target.guildId)) servers.set(target.guildId, await variables.server(target.guildId).catch(() => ({})));
					payload = fillPayload(template, { ...servers.get(target.guildId), ...own });
				}
				// A test pings nobody and is not crossposted
				const sendTo = logAs === 'test' ? { ...target, ping: 'none', roleIds: [], publish: false } : target;
				messages.push({ channelId: target.channelId, messageId: await executor.sendAnnouncement(target.channelId, payload, sendTo) });
			}
			catch (error) {
				logger.warn(`Stream notification #${s.id} not sent to ${target.channelId}:`, error.message);
			}
		}
		await q.history.run(s.id, logAs, data.title ?? null, data.url ?? null, messages.length, now());
		return { messages, payload };
	}

	async function liveStarted(s, live) {
		let messages = [];
		const shown = s.config.lives && passesWords(s.config, filterText(live));
		if (shown) {
			({ messages } = await notify(s, 'live', live));
			await record(system, 'stream.live', s, { title: live.title, url: live.url });
		}
		const holders = [];
		if (shown && s.config.liveRole.userId) {
			for (const [guildId, roleId] of Object.entries(s.config.liveRole.roleByGuild)) {
				if ((await network.find(guildId))?.status !== 'active') continue;
				await executor.addRole(guildId, s.config.liveRole.userId, roleId, `En live sur ${PLATFORMS[s.platform]}`).then(() => holders.push({ guildId, roleId })).catch(() => null);
			}
		}
		await setState(s.id, {
			live_id: live.id, live_started_at: live.startedAt ?? now(), live_title: live.title, live_game: live.game, peak_viewers: live.viewers ?? 0,
			live_messages: JSON.stringify(messages), role_holders: JSON.stringify(holders),
		});
	}

	async function liveEnded(s) {
		const st = s.state;
		const ended = {
			content: '',
			embed: {
				enabled: true, title: (st.title || s.displayName).slice(0, 256), fields: [],
				description: `⚫ Live terminé · ${durationText(now() - st.startedAt)}${st.peakViewers ? ` · pic à ${st.peakViewers} spectateurs` : ''}`,
				color: '#4f545c',
			},
		};
		for (const m of st.messages) {
			if (s.config.endAction === 'edit') await executor.upsertMessage(m.channelId, m.messageId, ended, { repost: false }).catch(() => null);
			if (s.config.endAction === 'delete') await executor.deleteMessage(m.channelId, m.messageId).catch(() => null);
		}
		for (const h of st.roleHolders) await executor.removeRole(h.guildId, s.config.liveRole.userId, h.roleId, 'Fin du live').catch(() => null);
		if (st.messages.length) await q.history.run(s.id, 'end', st.title, null, st.messages.length, now());
		// The live id is kept: the same live coming back (a short cut) is not announced twice
		await setState(s.id, { live_started_at: null, live_messages: '[]', role_holders: '[]' });
	}

	async function handleLive(s, live) {
		if (live && live.id !== s.state.liveId) {
			if (s.state.live) await liveEnded(s);
			await liveStarted(s, live);
		}
		else if (live) {
			// Same live: keep the peak, or it came back after a short cut (not announced again)
			await setState(s.id, s.state.live ? { peak_viewers: Math.max(s.state.peakViewers, live.viewers ?? 0), live_title: live.title } : { live_started_at: live.startedAt ?? now() });
		}
		else if (s.state.live) {
			await liveEnded(s);
		}
	}

	async function handleVideos(s, videos) {
		const newest = videos[0];
		if (!newest) return;
		// First look at the channel: only remember where it stands
		if (s.state.lastVideoAt === null) {
			await setState(s.id, { last_video_id: newest.id, last_video_at: newest.publishedAt });
			return;
		}
		const fresh = videos.filter(v => v.publishedAt > s.state.lastVideoAt && v.id !== s.state.lastVideoId).reverse().slice(-3);
		for (const v of fresh) {
			if (v.short ? !s.config.shorts : !s.config.videos) continue;
			if (!passesWords(s.config, filterText(v))) continue;
			await notify(s, v.short ? 'clip' : 'video', v);
			await record(system, 'stream.video', s, { title: v.title, url: v.url });
		}
		if (newest.publishedAt >= s.state.lastVideoAt) await setState(s.id, { last_video_id: newest.id, last_video_at: newest.publishedAt });
	}

	async function handleClips(s, clips) {
		// First look at the channel: only clips made from now on. This date never moves: a clip can show up late
		if (s.state.lastVideoAt === null) {
			await setState(s.id, { last_video_at: now() });
			return;
		}
		const recent = clips.filter(c => c.publishedAt > s.state.lastVideoAt && passesWords(s.config, filterText(c)));
		if (!recent.length) return;
		const done = new Set((await q.announced.all(s.id, now() - CLIP_WINDOW)).map(h => h.url));
		// Oldest first: what goes over the limit is taken by the next check
		for (const c of recent.filter(x => !done.has(x.url)).reverse().slice(0, PER_CHECK)) {
			await notify(s, 'clip', c);
			await record(system, 'stream.clip', s, { title: c.title, url: c.url });
		}
	}

	async function validate(actor, input, current) {
		const platform = current?.platform ?? input.platform;
		if (!PLATFORMS[platform]) throw new ValidationError('Plateforme inconnue.');
		let channel = String(input.channel ?? current?.channel ?? '').trim().replace(/^https?:\/\/(www\.|m\.)?(twitch\.tv|kick\.com|tiktok\.com)\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '').toLowerCase();
		if (platform === 'twitch' && !/^[a-z0-9_]{3,25}$/.test(channel)) throw new ValidationError('Nom de chaîne Twitch invalide.');
		if (platform === 'kick' && !/^[a-z0-9_-]{2,25}$/.test(channel)) throw new ValidationError('Nom de chaîne Kick invalide.');
		if (platform === 'tiktok' && !/^[a-z0-9_.]{2,24}$/.test(channel)) throw new ValidationError('Nom de compte TikTok invalide (le @nom du profil).');
		if (platform === 'youtube') channel = await youtubeChannelId({ fetchImpl }, input.channel ?? current.channel).catch((error) => { throw new ValidationError(error.message); });
		const targets = normalizeTargets(input.targets ?? current?.targets ?? []);
		const config = normalizeStreamConfig(input.config ?? current?.config ?? {});
		for (const kind of ['video', 'clip']) if (!STREAM_KINDS[platform].includes(kind)) config[`${kind}Targets`] = null;
		const all = [...targets, ...(config.videoTargets ?? []), ...(config.clipTargets ?? [])];
		if (!all.length) throw new ValidationError('Choisis au moins un salon.');
		for (const kind of STREAM_KINDS[platform]) {
			if (config[KIND_ENABLED[kind]] && !targetsOf({ targets, config }, kind).length) throw new ValidationError(`Choisis au moins un salon pour ${KIND_LABELS[kind]}.`);
		}
		for (const t of all) {
			if ((await network.find(t.guildId))?.status !== 'active') throw new ValidationError('Un des serveurs choisis ne fait pas partie du réseau.');
			if ((t.ping === 'everyone' || t.ping === 'here') && !actor.can('announcements.everyone')) throw new ForbiddenError('Permission manquante pour mentionner @everyone ou @here.');
		}
		const defaults = defaultPayloads(platform);
		const payloads = {
			live: normalizePayload(input.payloads?.live ?? current?.payloads.live ?? defaults.live),
			video: normalizePayload(input.payloads?.video ?? current?.payloads.video ?? defaults.video),
			clip: normalizePayload(input.payloads?.clip ?? current?.payloads.clip ?? defaults.clip),
		};
		const displayName = String(input.displayName ?? current?.displayName ?? '').trim().slice(0, 100) || channel;
		return { platform, channel, displayName, targets, payloads, config, enabled: input.enabled ?? current?.enabled ?? true };
	}

	return {
		list: async () => Promise.all((await q.all.all()).map(toSubscription)),
		get: getOrThrow,
		history: async (limit = 100) => (await q.recent.all(limit)).map(h => ({ id: h.id, subscriptionId: h.subscription_id, displayName: h.display_name, platform: h.platform, kind: h.kind, title: h.title, url: h.url, channels: h.channels, at: h.at })),

		async save(actor, input) {
			requireManage(actor);
			const current = input.id ? await getOrThrow(input.id) : null;
			const c = await validate(actor, input, current);
			const row = { ...c, targets: JSON.stringify(c.targets), payloads: JSON.stringify(c.payloads), config: JSON.stringify(c.config), enabled: c.enabled ? 1 : 0, at: now() };
			let id = current?.id;
			if (current) await q.update.run({ ...row, id });
			else id = Number((await q.insert.run({ ...row, by: actor.id })).lastInsertRowid);
			const s = await getOrThrow(id);
			await record(actor, current ? 'stream.update' : 'stream.create', s);
			return s;
		},

		async remove(actor, id) {
			requireManage(actor);
			const s = await getOrThrow(id);
			if (s.state.live) await liveEnded(s).catch(() => null);
			await q.delete.run(id);
			await record(actor, 'stream.delete', s);
		},

		// Sample message of one kind in that kind's channels
		async test(actor, id, kind = 'live') {
			requireManage(actor);
			const s = await getOrThrow(id);
			if (!STREAM_KINDS[s.platform].includes(kind)) throw new ValidationError('Ce type de message n’existe pas pour cette plateforme.');
			const { messages } = await notify(s, kind, {
				name: s.displayName, title: `${{ live: 'Live', video: 'Vidéo', clip: 'Clip' }[kind]} de test · ceci est un exemple`, game: 'Grand Theft Auto V', viewers: 42, creator: 'Un membre',
				url: channelUrl(s.platform, s.channel),
				thumbnail: 'https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg',
			}, 'test');
			await record(actor, 'stream.test', s, { channels: messages.length });
			return { sent: messages.length, total: targetsOf(s, kind).length };
		},

		// Keys are never sent back: only whether they are set
		async credentials() {
			const c = await credentials();
			return {
				twitch: { clientId: c.twitch?.clientId ?? '', hasSecret: Boolean(c.twitch?.clientSecret) },
				kick: { clientId: c.kick?.clientId ?? '', hasSecret: Boolean(c.kick?.clientSecret) },
				youtube: { hasApiKey: Boolean(c.youtubeApiKey) },
			};
		},

		// Empty secret = keep the saved one; null = remove it
		async setCredentials(actor, input = {}) {
			requireManage(actor);
			const c = await credentials();
			const pair = (key) => {
				const next = input[key];
				if (next === undefined) return c[key];
				if (next === null) return undefined;
				const clientId = String(next.clientId ?? '').trim().slice(0, 100);
				const secret = next.clientSecret === null ? undefined : String(next.clientSecret ?? '').trim() || c[key]?.clientSecret;
				return clientId ? { clientId, clientSecret: secret?.slice(0, 200) } : undefined;
			};
			const youtubeApiKey = input.youtubeApiKey === undefined ? c.youtubeApiKey : input.youtubeApiKey === null ? undefined : String(input.youtubeApiKey).trim().slice(0, 200) || c.youtubeApiKey;
			await settings.set('streams.credentials', { twitch: pair('twitch'), kick: pair('kick'), youtubeApiKey });
			await audit.record({ actorId: actor.id, source: 'panel', action: 'stream.credentials', target: 'streams', details: {} });
			return this.credentials();
		},

		// Every minute: Twitch and Kick in batches, TikTok account by account; YouTube and Twitch clips every 5 minutes per channel
		async tick() {
			const subs = (await Promise.all((await q.all.all()).map(toSubscription))).filter(s => s.enabled);
			const c = await credentials();
			for (const [platform, check, pair] of [['twitch', twitchLive, c.twitch], ['kick', kickLive, c.kick]]) {
				const list = subs.filter(s => s.platform === platform);
				if (!list.length) continue;
				if (!pair?.clientId || !pair?.clientSecret) {
					for (const s of list) await setState(s.id, { error: `Identifiants ${PLATFORMS[platform]} manquants.` });
					continue;
				}
				try {
					const live = await check({ fetchImpl, token, ...pair }, [...new Set(list.map(s => s.channel))]);
					for (const s of list) {
						await handleLive(s, live.get(s.channel) ?? null);
						await setState(s.id, { checked_at: now(), error: null });
					}
				}
				catch (error) {
					logger.warn(`${platform} check failed:`, error.message);
					for (const s of list) await setState(s.id, { checked_at: now(), error: error.message });
				}
			}
			if (c.twitch?.clientId && c.twitch?.clientSecret) {
				const clips = new Map();
				for (const s of subs.filter(x => x.platform === 'twitch' && x.config.shorts)) {
					const row = await q.state.get(s.id);
					if (row?.videos_checked_at && now() - row.videos_checked_at < CLIPS_EVERY) continue;
					try {
						if (!clips.has(s.channel)) clips.set(s.channel, await twitchClips({ fetchImpl, token, ids: twitchIds, ...c.twitch }, s.channel, now() - CLIP_WINDOW));
						await handleClips(s, clips.get(s.channel));
						await setState(s.id, { videos_checked_at: now() });
					}
					catch (error) {
						logger.warn('twitch clips check failed:', error.message);
						await setState(s.id, { videos_checked_at: now(), error: error.message });
					}
				}
			}
			// The same account followed twice (other channels, other messages) is asked once
			const tiktok = new Map();
			for (const s of subs.filter(x => x.platform === 'tiktok')) {
				try {
					if (!tiktok.has(s.channel)) tiktok.set(s.channel, await tiktokLive({ fetchImpl }, s.channel));
					await handleLive(s, tiktok.get(s.channel));
					await setState(s.id, { checked_at: now(), error: null });
				}
				catch (error) {
					await setState(s.id, { checked_at: now(), error: error.message });
				}
			}
			for (const s of subs.filter(x => x.platform === 'youtube')) {
				const row = await q.state.get(s.id);
				if (row?.videos_checked_at && now() - row.videos_checked_at < YOUTUBE_EVERY) continue;
				try {
					if (s.config.videos || s.config.shorts) await handleVideos(s, await youtubeVideos({ fetchImpl }, s.channel));
					if (s.config.lives) await handleLive(await getOrThrow(s.id), await youtubeLive({ fetchImpl, apiKey: c.youtubeApiKey }, s.channel));
					await setState(s.id, { videos_checked_at: now(), error: null });
				}
				catch (error) {
					await setState(s.id, { videos_checked_at: now(), error: error.message });
				}
			}
		},
	};
}
