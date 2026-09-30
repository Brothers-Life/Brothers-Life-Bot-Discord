import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload, normalizeTargets } from './announcements.js';
import { fillPayload } from './onboarding.js';
import { createTokenCache, kickLive, twitchLive, youtubeChannelId, youtubeLive, youtubeVideos } from './streamProviders.js';

definePermission('notifications.view', { label: 'Voir les notifications de streams et vidéos', category: 'Communauté' });
definePermission('notifications.manage', { label: 'Gérer les notifications de streams et vidéos (et les clés des plateformes)', category: 'Communauté' });

const SNOWFLAKE = /^\d{17,20}$/;
const YOUTUBE_EVERY = 5 * 60_000;
const COLORS = { twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18' };
export const PLATFORMS = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' };

export function defaultPayloads(platform) {
	const color = COLORS[platform];
	return {
		live: { content: '🔴 **{streamer}** est en live !', embed: { title: '{title}', url: '{url}', description: '🎮 {game}\n👀 {viewers} spectateurs', imageUrl: '{thumbnail}', color, timestamp: true } },
		video: { content: '📺 Nouvelle vidéo de **{streamer}** !', embed: { title: '{title}', url: '{url}', imageUrl: '{thumbnail}', color, timestamp: true } },
	};
}

function words(list) {
	return [...new Set((Array.isArray(list) ? list : []).map(w => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 20).map(w => w.slice(0, 50));
}

export function normalizeStreamConfig(input = {}) {
	const role = input.liveRole ?? {};
	const roles = {};
	for (const [guildId, roleId] of Object.entries(role.roleByGuild ?? {})) if (SNOWFLAKE.test(guildId) && SNOWFLAKE.test(roleId)) roles[guildId] = roleId;
	return {
		lives: input.lives !== false,
		videos: input.videos !== false,
		shorts: Boolean(input.shorts),
		requireWords: words(input.requireWords),
		excludeWords: words(input.excludeWords),
		endAction: ['edit', 'delete', 'none'].includes(input.endAction) ? input.endAction : 'edit',
		liveRole: { userId: SNOWFLAKE.test(role.userId ?? '') ? role.userId : null, roleByGuild: roles },
	};
}

function passes(config, title) {
	const t = String(title ?? '').toLowerCase();
	if (config.requireWords.length && !config.requireWords.some(w => t.includes(w))) return false;
	return !config.excludeWords.some(w => t.includes(w));
}

function durationText(ms) {
	const minutes = Math.max(1, Math.round(ms / 60_000));
	const h = Math.floor(minutes / 60);
	return h ? `${h} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

export function createStreams({ db, network, audit, executor, settings, logs, fetchImpl = fetch, logger = console, now = Date.now }) {
	logs.registerCategory('stream', 'Notifications de streams et vidéos');
	const token = createTokenCache({ fetchImpl, now });

	const q = {
		all: db.prepare('SELECT * FROM stream_subscriptions ORDER BY platform, display_name COLLATE NOCASE'),
		get: db.prepare('SELECT * FROM stream_subscriptions WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO stream_subscriptions (platform, channel, display_name, targets, payloads, config, enabled, created_by, created_at, updated_at)
			VALUES (@platform, @channel, @displayName, @targets, @payloads, @config, @enabled, @by, @at, @at)
		`),
		update: db.prepare('UPDATE stream_subscriptions SET channel = @channel, display_name = @displayName, targets = @targets, payloads = @payloads, config = @config, enabled = @enabled, updated_at = @at WHERE id = @id'),
		delete: db.prepare('DELETE FROM stream_subscriptions WHERE id = ?'),
		state: db.prepare('SELECT * FROM stream_state WHERE subscription_id = ?'),
		ensureState: db.prepare('INSERT OR IGNORE INTO stream_state (subscription_id) VALUES (?)'),
		history: db.prepare('INSERT INTO stream_history (subscription_id, kind, title, url, channels, at) VALUES (?, ?, ?, ?, ?, ?)'),
		recent: db.prepare(`
			SELECT h.*, s.display_name, s.platform FROM stream_history h JOIN stream_subscriptions s ON s.id = h.subscription_id
			ORDER BY h.at DESC LIMIT ?
		`),
	};

	function setState(id, patch) {
		q.ensureState.run(id);
		const keys = Object.keys(patch);
		db.prepare(`UPDATE stream_state SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE subscription_id = @id`).run({ ...patch, id });
	}

	function toState(row) {
		if (!row) return { live: false, liveId: null, title: null, game: null, peakViewers: 0, startedAt: null, messages: [], roleHolders: [], lastVideoId: null, lastVideoAt: null, checkedAt: null, error: null };
		return {
			live: row.live_started_at !== null, liveId: row.live_id, title: row.live_title, game: row.live_game, peakViewers: row.peak_viewers, startedAt: row.live_started_at,
			messages: JSON.parse(row.live_messages), roleHolders: JSON.parse(row.role_holders), lastVideoId: row.last_video_id, lastVideoAt: row.last_video_at,
			checkedAt: Math.max(row.checked_at ?? 0, row.videos_checked_at ?? 0) || null, error: row.error,
		};
	}

	function toSubscription(row) {
		if (!row) return null;
		return {
			id: row.id, platform: row.platform, channel: row.channel, displayName: row.display_name, targets: JSON.parse(row.targets),
			payloads: JSON.parse(row.payloads), config: normalizeStreamConfig(JSON.parse(row.config)), enabled: Boolean(row.enabled),
			createdBy: row.created_by, createdAt: row.created_at, state: toState(q.state.get(row.id)),
		};
	}

	function getOrThrow(id) {
		const s = toSubscription(q.get.get(id));
		if (!s) throw new NotFoundError('Abonnement introuvable.');
		return s;
	}

	function requireManage(actor) {
		if (!actor.can('notifications.manage')) throw new ForbiddenError('Permission manquante : notifications.manage');
	}

	function credentials() {
		return settings.get('streams.credentials', {});
	}

	function record(actor, action, s, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(s.id), details: { channel: `${PLATFORMS[s.platform]} · ${s.displayName}`, ...details } });
	}

	const system = { id: 'system', source: 'system' };

	// Message of a live or a video, sent to every channel of the subscription
	// `logAs`: kind written in the history (a test uses the live message)
	async function notify(s, kind, data, logAs = kind) {
		const payload = fillPayload(s.payloads[kind === 'live' ? 'live' : 'video'], {
			streamer: data.name || s.displayName, title: data.title, game: data.game || '—', url: data.url, thumbnail: data.thumbnail, viewers: data.viewers ?? 0,
		});
		const messages = [];
		for (const target of s.targets) {
			try {
				messages.push({ channelId: target.channelId, messageId: await executor.sendAnnouncement(target.channelId, payload, target) });
			}
			catch (error) {
				logger.warn(`Stream notification #${s.id} not sent to ${target.channelId}:`, error.message);
			}
		}
		q.history.run(s.id, logAs, data.title ?? null, data.url ?? null, messages.length, now());
		return { messages, payload };
	}

	async function liveStarted(s, live) {
		let messages = [];
		const shown = s.config.lives && passes(s.config, live.title);
		if (shown) {
			({ messages } = await notify(s, 'live', live));
			record(system, 'stream.live', s, { title: live.title, url: live.url });
		}
		const holders = [];
		if (shown && s.config.liveRole.userId) {
			for (const [guildId, roleId] of Object.entries(s.config.liveRole.roleByGuild)) {
				if (network.find(guildId)?.status !== 'active') continue;
				await executor.addRole(guildId, s.config.liveRole.userId, roleId, `En live sur ${PLATFORMS[s.platform]}`).then(() => holders.push({ guildId, roleId })).catch(() => null);
			}
		}
		setState(s.id, {
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
		if (st.messages.length) q.history.run(s.id, 'end', st.title, null, st.messages.length, now());
		// The live id is kept: the same live coming back (a short cut) is not announced twice
		setState(s.id, { live_started_at: null, live_messages: '[]', role_holders: '[]' });
	}

	async function handleLive(s, live) {
		if (live && live.id !== s.state.liveId) {
			if (s.state.live) await liveEnded(s);
			await liveStarted(s, live);
		}
		else if (live) {
			// Same live: keep the peak, or it came back after a short cut (not announced again)
			setState(s.id, s.state.live ? { peak_viewers: Math.max(s.state.peakViewers, live.viewers ?? 0), live_title: live.title } : { live_started_at: live.startedAt ?? now() });
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
			setState(s.id, { last_video_id: newest.id, last_video_at: newest.publishedAt });
			return;
		}
		const fresh = videos.filter(v => v.publishedAt > s.state.lastVideoAt && v.id !== s.state.lastVideoId).reverse().slice(-3);
		for (const v of fresh) {
			if (v.short ? !s.config.shorts : !s.config.videos) continue;
			if (!passes(s.config, v.title)) continue;
			await notify(s, v.short ? 'short' : 'video', v);
			record(system, 'stream.video', s, { title: v.title, url: v.url });
		}
		if (newest.publishedAt >= s.state.lastVideoAt) setState(s.id, { last_video_id: newest.id, last_video_at: newest.publishedAt });
	}

	async function validate(actor, input, current) {
		const platform = current?.platform ?? input.platform;
		if (!PLATFORMS[platform]) throw new ValidationError('Plateforme inconnue.');
		let channel = String(input.channel ?? current?.channel ?? '').trim().replace(/^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\//i, '').replace(/\/.*$/, '').toLowerCase();
		if (platform === 'twitch' && !/^[a-z0-9_]{3,25}$/.test(channel)) throw new ValidationError('Nom de chaîne Twitch invalide.');
		if (platform === 'kick' && !/^[a-z0-9_-]{2,25}$/.test(channel)) throw new ValidationError('Nom de chaîne Kick invalide.');
		if (platform === 'youtube') channel = await youtubeChannelId({ fetchImpl }, input.channel ?? current.channel).catch((error) => { throw new ValidationError(error.message); });
		const targets = normalizeTargets(input.targets ?? current?.targets ?? []);
		if (!targets.length) throw new ValidationError('Choisis au moins un salon.');
		for (const t of targets) {
			if (network.find(t.guildId)?.status !== 'active') throw new ValidationError('Un des serveurs choisis ne fait pas partie du réseau.');
			if ((t.ping === 'everyone' || t.ping === 'here') && !actor.can('announcements.everyone')) throw new ForbiddenError('Permission manquante pour mentionner @everyone ou @here.');
		}
		const defaults = defaultPayloads(platform);
		const payloads = {
			live: normalizePayload(input.payloads?.live ?? current?.payloads.live ?? defaults.live),
			video: normalizePayload(input.payloads?.video ?? current?.payloads.video ?? defaults.video),
		};
		const displayName = String(input.displayName ?? current?.displayName ?? '').trim().slice(0, 100) || channel;
		return { platform, channel, displayName, targets, payloads, config: normalizeStreamConfig(input.config ?? current?.config ?? {}), enabled: input.enabled ?? current?.enabled ?? true };
	}

	return {
		list: () => q.all.all().map(toSubscription),
		get: getOrThrow,
		history: (limit = 100) => q.recent.all(limit).map(h => ({ id: h.id, subscriptionId: h.subscription_id, displayName: h.display_name, platform: h.platform, kind: h.kind, title: h.title, url: h.url, channels: h.channels, at: h.at })),

		async save(actor, input) {
			requireManage(actor);
			const current = input.id ? getOrThrow(input.id) : null;
			const c = await validate(actor, input, current);
			const row = { ...c, targets: JSON.stringify(c.targets), payloads: JSON.stringify(c.payloads), config: JSON.stringify(c.config), enabled: c.enabled ? 1 : 0, at: now() };
			let id = current?.id;
			if (current) q.update.run({ ...row, id });
			else id = Number(q.insert.run({ ...row, by: actor.id }).lastInsertRowid);
			const s = getOrThrow(id);
			record(actor, current ? 'stream.update' : 'stream.create', s);
			return s;
		},

		async remove(actor, id) {
			requireManage(actor);
			const s = getOrThrow(id);
			if (s.state.live) await liveEnded(s).catch(() => null);
			q.delete.run(id);
			record(actor, 'stream.delete', s);
		},

		// Sample message in the subscription's channels
		async test(actor, id) {
			requireManage(actor);
			const s = getOrThrow(id);
			const { messages } = await notify(s, 'live', {
				name: s.displayName, title: 'Live de test · ceci est un exemple', game: 'Grand Theft Auto V', viewers: 42,
				url: s.platform === 'youtube' ? `https://www.youtube.com/channel/${s.channel}` : `https://${s.platform === 'twitch' ? 'twitch.tv' : 'kick.com'}/${s.channel}`,
				thumbnail: 'https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg',
			}, 'test');
			record(actor, 'stream.test', s, { channels: messages.length });
			return { sent: messages.length, total: s.targets.length };
		},

		// Keys are never sent back: only whether they are set
		credentials() {
			const c = credentials();
			return {
				twitch: { clientId: c.twitch?.clientId ?? '', hasSecret: Boolean(c.twitch?.clientSecret) },
				kick: { clientId: c.kick?.clientId ?? '', hasSecret: Boolean(c.kick?.clientSecret) },
				youtube: { hasApiKey: Boolean(c.youtubeApiKey) },
			};
		},

		// Empty secret = keep the saved one; null = remove it
		setCredentials(actor, input = {}) {
			requireManage(actor);
			const c = credentials();
			const pair = (key) => {
				const next = input[key];
				if (next === undefined) return c[key];
				if (next === null) return undefined;
				const clientId = String(next.clientId ?? '').trim().slice(0, 100);
				const secret = next.clientSecret === null ? undefined : String(next.clientSecret ?? '').trim() || c[key]?.clientSecret;
				return clientId ? { clientId, clientSecret: secret?.slice(0, 200) } : undefined;
			};
			const youtubeApiKey = input.youtubeApiKey === undefined ? c.youtubeApiKey : input.youtubeApiKey === null ? undefined : String(input.youtubeApiKey).trim().slice(0, 200) || c.youtubeApiKey;
			settings.set('streams.credentials', { twitch: pair('twitch'), kick: pair('kick'), youtubeApiKey });
			audit.record({ actorId: actor.id, source: 'panel', action: 'stream.credentials', target: 'streams', details: {} });
			return this.credentials();
		},

		// Every minute: Twitch and Kick in batches, YouTube every 5 minutes per channel
		async tick() {
			const subs = q.all.all().map(toSubscription).filter(s => s.enabled);
			const c = credentials();
			for (const [platform, check, pair] of [['twitch', twitchLive, c.twitch], ['kick', kickLive, c.kick]]) {
				const list = subs.filter(s => s.platform === platform);
				if (!list.length) continue;
				if (!pair?.clientId || !pair?.clientSecret) {
					for (const s of list) setState(s.id, { error: `Identifiants ${PLATFORMS[platform]} manquants.` });
					continue;
				}
				try {
					const live = await check({ fetchImpl, token, ...pair }, [...new Set(list.map(s => s.channel))]);
					for (const s of list) {
						await handleLive(s, live.get(s.channel) ?? null);
						setState(s.id, { checked_at: now(), error: null });
					}
				}
				catch (error) {
					logger.warn(`${platform} check failed:`, error.message);
					for (const s of list) setState(s.id, { checked_at: now(), error: error.message });
				}
			}
			for (const s of subs.filter(x => x.platform === 'youtube')) {
				const row = q.state.get(s.id);
				if (row?.videos_checked_at && now() - row.videos_checked_at < YOUTUBE_EVERY) continue;
				try {
					if (s.config.videos || s.config.shorts) await handleVideos(s, await youtubeVideos({ fetchImpl }, s.channel));
					if (s.config.lives) await handleLive(getOrThrow(s.id), await youtubeLive({ fetchImpl, apiKey: c.youtubeApiKey }, s.channel));
					setState(s.id, { videos_checked_at: now(), error: null });
				}
				catch (error) {
					setState(s.id, { videos_checked_at: now(), error: error.message });
				}
			}
		},
	};
}
