import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN } from '../helpers.js';
import { createStreams } from '../../src/core/streams.js';

const CHANNEL = '610000000000000001';
const STREAMER = '300000000000000009';
const LIVE_ROLE = '800000000000000055';
const UC = 'UCabcdefghijklmnopqrstuv';

function json(data, status = 200) {
	return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}
function text(body, status = 200) {
	return { ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body) };
}

function feed(videos) {
	return `<feed><author><name>Chaîne BRL</name></author>${videos.map(v => `<entry><yt:videoId>${v.id}</yt:videoId><title>${v.title}</title>
		<link rel="alternate" href="https://www.youtube.com/${v.short ? 'shorts/' : 'watch?v='}${v.id}"/><published>${new Date(v.at).toISOString()}</published>
		<media:thumbnail url="https://i.ytimg.com/vi/${v.id}/hq.jpg"/>${v.description ? `<media:group><media:description>${v.description}</media:description></media:group>` : ''}</entry>`).join('')}</feed>`;
}

async function setup() {
	let clock = Date.UTC(2026, 9, 1, 18, 0);
	const world = { twitch: [], videos: [], clips: [], tiktok: null, tokenCalls: 0, tiktokCalls: 0, clipCalls: [], userCalls: 0 };
	const fetchImpl = async (url) => {
		if (url.startsWith('https://id.twitch.tv/')) {
			world.tokenCalls++;
			return json({ access_token: 'tok', expires_in: 3600 });
		}
		if (url.startsWith('https://api.twitch.tv/helix/streams')) return json({ data: world.twitch });
		if (url.startsWith('https://api.twitch.tv/helix/users')) {
			world.userCalls++;
			return json({ data: [{ id: '777', login: 'brl_tv' }] });
		}
		if (url.startsWith('https://api.twitch.tv/helix/clips')) {
			world.clipCalls.push(url);
			return world.clipsDown ? json({}, 503) : json({ data: world.clips });
		}
		if (url.startsWith('https://www.youtube.com/feeds/')) return text(feed(world.videos));
		if (url.startsWith('https://www.tiktok.com/api-live/user/room/')) {
			world.tiktokCalls++;
			return json(world.tiktok);
		}
		if (url.includes('/live')) return text('<html>offline</html>');
		return json({}, 404);
	};
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	executor.channels.set(CHANNEL, { guildId: MAIN, name: 'streams' });
	executor.memberRoles.set(`${MAIN}:${STREAMER}`, []);
	const streams = createStreams({ db: core.db, network: core.network, audit: core.audit, executor, settings: core.settings, logs: core.logs, fetchImpl, logger: { warn: () => undefined }, now: () => clock });
	return { ...ctx, streams, world, advance: (ms) => { clock += ms; } };
}

const target = { guildId: MAIN, channelId: CHANNEL, ping: 'none' };
const twitchStream = (id, extra = {}) => ({ id, user_login: 'brl_tv', user_name: 'BRL_TV', title: 'Soirée RP', game_name: 'GTA V', viewer_count: 120, started_at: '2026-10-01T17:55:00Z', thumbnail_url: 'https://thumb/{width}x{height}.jpg', ...extra });

test('twitch: missing keys reported; a live is announced once, peak kept, message edited and live role removed at the end', async () => {
	const { streams, owner, executor, world, advance } = await setup();
	const sub = await streams.save(owner, { platform: 'twitch', channel: 'https://twitch.tv/BRL_TV', targets: [target], config: { liveRole: { userId: STREAMER, roleByGuild: { [MAIN]: LIVE_ROLE } } } });
	assert.equal(sub.channel, 'brl_tv');
	await streams.tick();
	assert.match((await streams.get(sub.id)).state.error, /manquants/);

	const creds = await streams.setCredentials(owner, { twitch: { clientId: 'abc', clientSecret: 'secret' } });
	assert.deepEqual(creds.twitch, { clientId: 'abc', hasSecret: true });
	await streams.setCredentials(owner, { twitch: { clientId: 'abc', clientSecret: '' } });
	assert.equal((await streams.credentials()).twitch.hasSecret, true, 'an empty secret keeps the saved one');

	world.twitch = [twitchStream('s1')];
	await streams.tick();
	const sent = executor.announcements.at(-1);
	assert.match(sent.payload.content, /BRL_TV\*\* est en live/);
	assert.equal(sent.payload.embed.title, 'Soirée RP');
	assert.equal(sent.payload.embed.url, 'https://twitch.tv/brl_tv');
	assert.ok(executor.memberRoles.get(`${MAIN}:${STREAMER}`).includes(LIVE_ROLE));

	world.twitch = [twitchStream('s1', { viewer_count: 300 })];
	advance(60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 1, 'same live: no second message');
	assert.equal((await streams.get(sub.id)).state.peakViewers, 300);
	assert.equal(world.tokenCalls, 1, 'token reused');

	world.twitch = [];
	advance(2 * 3_600_000);
	await streams.tick();
	const edited = [...executor.posted.get(CHANNEL).values()].at(-1);
	assert.match(edited.embed.description, /Live terminé · 2 h 06 · pic à 300/);
	assert.ok(!executor.memberRoles.get(`${MAIN}:${STREAMER}`).includes(LIVE_ROLE));
	assert.deepEqual((await streams.history()).map(h => h.kind), ['end', 'live']);

	world.twitch = [twitchStream('s1')];
	await streams.tick();
	assert.equal(executor.announcements.length, 1, 'the same live coming back is not announced again');
});

test('title filters: required and excluded words', async () => {
	const { streams, owner, executor, world } = await setup();
	await streams.setCredentials(owner, { twitch: { clientId: 'abc', clientSecret: 'secret' } });
	await streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [target], config: { requireWords: ['RP'], excludeWords: ['rediffusion'] } });
	world.twitch = [twitchStream('s1', { title: 'Rediffusion RP' })];
	await streams.tick();
	assert.equal(executor.announcements.length, 0);
	world.twitch = [twitchStream('s2', { title: 'Nouvelle saison RP' })];
	await streams.tick();
	assert.equal(executor.announcements.length, 1);
});

test('youtube: first look only remembers, then new videos announced, Shorts only when asked, checked every 5 minutes', async () => {
	const { streams, owner, executor, world, advance } = await setup();
	const t0 = Date.UTC(2026, 9, 1, 12, 0);
	world.videos = [{ id: 'old00000001', title: 'Ancienne', at: t0 }];
	const sub = await streams.save(owner, { platform: 'youtube', channel: UC, displayName: 'BRL', targets: [target], config: { lives: false } });
	await streams.tick();
	assert.equal(executor.announcements.length, 0);

	world.videos = [{ id: 'short000001', title: 'Un short', at: t0 + 2000, short: true }, { id: 'new00000001', title: 'Épisode 2', at: t0 + 1000 }, ...world.videos];
	await streams.tick();
	assert.equal(executor.announcements.length, 0, 'not checked again before 5 minutes');
	advance(5 * 60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 1, 'the Short is skipped');
	assert.equal(executor.announcements[0].payload.embed.title, 'Épisode 2');
	assert.equal(executor.announcements[0].payload.embed.imageUrl, 'https://i.ytimg.com/vi/new00000001/hq.jpg');
	assert.equal((await streams.get(sub.id)).state.lastVideoId, 'short000001');
});

test('test message and permissions', async () => {
	const { streams, owner, executor } = await setup();
	const sub = await streams.save(owner, { platform: 'kick', channel: 'brl', targets: [target] });
	assert.deepEqual(await streams.test(owner, sub.id), { sent: 1, total: 1 });
	assert.match(executor.announcements.at(-1).payload.embed.title, /test/);
	// A test pings nobody and is not crossposted
	assert.equal(executor.announcements.at(-1).target.ping, 'none');
	assert.deepEqual(executor.announcements.at(-1).target.roleIds, []);
	assert.equal(executor.announcements.at(-1).target.publish, false);
	const nobody = { id: '1', can: () => false };
	await assert.rejects(streams.save(nobody, { platform: 'kick', channel: 'x2', targets: [target] }), /notifications.manage/);
	await streams.remove(owner, sub.id);
	assert.equal((await streams.list()).length, 0);
});

const tiktokRoom = (status, extra = {}) => ({
	statusCode: 0, message: '',
	data: {
		user: { uniqueId: 'brl.officiel', nickname: 'Brothers Life', roomId: status === 2 ? '7704837379474852622' : '', status },
		liveRoom: { title: 'Course de la bêta', status, startTime: 1793922307, coverUrl: 'https://cover.tiktokcdn/x.webp', liveRoomStats: { userCount: 37 }, ...extra },
	},
});

test('tiktok: profile link accepted, live announced once (no key), account asked once, unknown account reported', async () => {
	const { streams, owner, executor, world, advance } = await setup();
	const sub = await streams.save(owner, { platform: 'tiktok', channel: 'https://www.tiktok.com/@BRL.Officiel?lang=fr', targets: [target] });
	assert.equal(sub.channel, 'brl.officiel');
	assert.equal(sub.payloads.live.embed.description, '👀 {viewers} spectateurs', 'TikTok gives no game');
	await assert.rejects(streams.save(owner, { platform: 'tiktok', channel: 'pas valide !', targets: [target] }), /TikTok invalide/);
	// The same account followed a second time (other message): one call per check
	await streams.save(owner, { platform: 'tiktok', channel: '@brl.officiel', targets: [target], config: { lives: true } });

	world.tiktok = tiktokRoom(4);
	await streams.tick();
	assert.equal(executor.announcements.length, 0);
	assert.equal((await streams.get(sub.id)).state.error, null);
	assert.equal(world.tiktokCalls, 1);

	world.tiktok = tiktokRoom(2);
	advance(60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 2, 'one message per subscription');
	const sent = executor.announcements[0];
	assert.match(sent.payload.content, /Brothers Life\*\* est en live/);
	assert.equal(sent.payload.embed.title, 'Course de la bêta');
	assert.equal(sent.payload.embed.url, 'https://www.tiktok.com/@brl.officiel/live');
	assert.equal(sent.payload.embed.description, '👀 37 spectateurs');

	advance(60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 2, 'same live: no second message');
	assert.equal((await streams.get(sub.id)).state.live, true);

	world.tiktok = tiktokRoom(4);
	advance(60_000);
	await streams.tick();
	assert.equal((await streams.get(sub.id)).state.live, false);

	world.tiktok = { data: null, message: 'user_not_found', statusCode: 19881007 };
	advance(60_000);
	await streams.tick();
	assert.match((await streams.get(sub.id)).state.error, /introuvable/);
});

test('hashtags: a live is announced only with the tag (title or Twitch tags), a YouTube video when its description has it', async () => {
	const { streams, owner, executor, world, advance } = await setup();
	const tt = await streams.save(owner, { platform: 'tiktok', channel: 'brl.officiel', targets: [target], config: { requireWords: ['#BrothersLife'] } });
	assert.deepEqual(tt.config.requireWords, ['#brotherslife']);
	world.tiktok = tiktokRoom(2, { title: 'Course #BrothersLifeRP' });
	await streams.tick();
	assert.equal(executor.announcements.length, 0, 'another tag');
	await streams.remove(owner, tt.id);

	await streams.save(owner, { platform: 'tiktok', channel: 'brl.officiel', targets: [target], config: { requireWords: ['#BrothersLife'] } });
	world.tiktok = tiktokRoom(2, { title: 'Course de la bêta #brotherslife' });
	advance(60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 1);

	await streams.setCredentials(owner, { twitch: { clientId: 'abc', clientSecret: 'secret' } });
	await streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [target], config: { requireWords: ['#brl'] } });
	world.twitch = [twitchStream('t1', { title: 'Soirée RP', tags: ['BRL', 'Français'] })];
	advance(60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 2, 'tag of the Twitch live');

	const yt = await streams.save(owner, { platform: 'youtube', channel: UC, displayName: 'BRL', targets: [target], config: { lives: false, requireWords: ['#brl'] } });
	world.videos = [{ id: 'old00000001', title: 'Ancienne', at: Date.UTC(2026, 8, 1) }];
	await streams.tick();
	world.videos = [
		{ id: 'tag00000001', title: 'Course folle', description: 'Sur le serveur #BRL', at: Date.UTC(2026, 9, 1, 18, 30) },
		{ id: 'tag00000002', title: 'Autre vidéo', description: 'sans tag', at: Date.UTC(2026, 9, 1, 18, 20) },
		...world.videos,
	];
	advance(10 * 60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 3);
	assert.equal(executor.announcements.at(-1).payload.embed.title, 'Course folle');
	assert.equal((await streams.get(yt.id)).state.lastVideoId, 'tag00000001');
});

const CLIPS_CHANNEL = '610000000000000002';
const VIDEOS_CHANNEL = '610000000000000003';
const twitchClip = (id, at, extra = {}) => ({ id, url: `https://clips.twitch.tv/${id}`, broadcaster_name: 'BRL_TV', creator_name: 'Spectateur', title: `Clip ${id}`, view_count: 3, created_at: new Date(at).toISOString(), thumbnail_url: 'https://clips/x.jpg', ...extra });

test('routes: lives, videos and Shorts each go to their channels with their message, the old setup keeps working', async () => {
	const { core, streams, owner, executor, world, advance } = await setup();
	executor.channels.set(CLIPS_CHANNEL, { guildId: MAIN, name: 'clips' });
	executor.channels.set(VIDEOS_CHANNEL, { guildId: MAIN, name: 'videos' });

	const sub = await streams.save(owner, {
		platform: 'youtube', channel: UC, displayName: 'BRL', targets: [target],
		config: { shorts: true, videoTargets: [{ guildId: MAIN, channelId: VIDEOS_CHANNEL, ping: 'none' }], clipTargets: [{ guildId: MAIN, channelId: CLIPS_CHANNEL, ping: 'none' }] },
		payloads: { clip: { content: 'Short de {streamer}', embed: { title: '{title}' } } },
	});
	world.videos = [{ id: 'old00000001', title: 'Ancienne', at: Date.UTC(2026, 8, 1) }];
	await streams.tick();
	world.videos = [
		{ id: 'sho00000001', title: 'Un short', short: true, at: Date.UTC(2026, 9, 1, 18, 2) },
		{ id: 'vid00000001', title: 'Une vidéo', at: Date.UTC(2026, 9, 1, 18, 1) },
		...world.videos,
	];
	advance(10 * 60_000);
	await streams.tick();
	const [video, short] = executor.announcements;
	assert.equal(video.channelId, VIDEOS_CHANNEL);
	assert.match(video.payload.content, /Nouvelle vidéo/);
	assert.equal(short.channelId, CLIPS_CHANNEL);
	assert.equal(short.payload.content, 'Short de Chaîne BRL');
	assert.deepEqual((await streams.history()).map(h => h.kind).sort(), ['short', 'video']);

	// Test of one kind: its channels, its message
	assert.deepEqual(await streams.test(owner, sub.id, 'clip'), { sent: 1, total: 1 });
	assert.equal(executor.announcements.at(-1).channelId, CLIPS_CHANNEL);
	await assert.rejects(streams.test(owner, sub.id, 'autre'), /type/);

	// Saved before the split: no routes, no clip message. Videos and Shorts keep the lives' channels and the video message
	const old = await streams.save(owner, { platform: 'youtube', channel: UC, displayName: 'Ancienne', targets: [target], config: { shorts: true }, payloads: { video: { content: 'Message perso', embed: {} } } });
	const payloads = (await streams.get(old.id)).payloads;
	await core.db.prepare('UPDATE stream_subscriptions SET payloads = ? WHERE id = ?').run(JSON.stringify({ live: payloads.live, video: payloads.video }), old.id);
	const loaded = await streams.get(old.id);
	assert.equal(loaded.config.clipTargets, null);
	assert.equal(loaded.payloads.clip.content, 'Message perso');
	assert.deepEqual(await streams.test(owner, old.id, 'clip'), { sent: 1, total: 1 });
	assert.equal(executor.announcements.at(-1).channelId, CHANNEL);
});

test('routes: every announced kind needs a channel, a kind may go alone, unused routes are dropped', async () => {
	const { streams, owner } = await setup();
	const clipRoute = [{ guildId: MAIN, channelId: CLIPS_CHANNEL, ping: 'none' }];
	await assert.rejects(streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [] }), /au moins un salon/);
	await assert.rejects(streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [], config: { clipTargets: clipRoute, shorts: true } }), /les lives/);
	await assert.rejects(streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [target], config: { clipTargets: [], shorts: true } }), /les clips/);
	const alone = await streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [], config: { lives: false, shorts: true, clipTargets: clipRoute } });
	assert.equal(alone.config.clipTargets[0].channelId, CLIPS_CHANNEL);
	const kick = await streams.save(owner, { platform: 'kick', channel: 'brl', targets: [target], config: { clipTargets: clipRoute } });
	assert.equal(kick.config.clipTargets, null);
	const nobody = { id: '1', can: (p) => p === 'notifications.manage' };
	await assert.rejects(streams.save(nobody, { platform: 'twitch', channel: 'other', targets: [target], config: { clipTargets: [{ ...clipRoute[0], ping: 'everyone' }] } }), /everyone/);
});

test('twitch clips: first look remembers, then each clip announced once, late ones included, 3 per check, every 5 minutes', async () => {
	const { streams, owner, executor, world, advance } = await setup();
	executor.channels.set(CLIPS_CHANNEL, { guildId: MAIN, name: 'clips' });
	await streams.setCredentials(owner, { twitch: { clientId: 'abc', clientSecret: 'secret' } });
	const start = Date.UTC(2026, 9, 1, 18, 0);
	const sub = await streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [target], config: { lives: false, shorts: true, clipTargets: [{ guildId: MAIN, channelId: CLIPS_CHANNEL, ping: 'none' }], excludeWords: ['#test'] } });
	assert.match(sub.payloads.clip.content, /Nouveau clip/);

	world.clips = [twitchClip('old', start - 60_000)];
	await streams.tick();
	assert.equal(executor.announcements.length, 0, 'clips older than the first look');

	// Twitch sorts by views: the date decides
	world.clips = [twitchClip('old', start - 60_000), twitchClip('b', start + 120_000, { view_count: 50 }), twitchClip('a', start + 60_000)];
	advance(60_000);
	await streams.tick();
	assert.equal(world.clipCalls.length, 1, 'not asked again before 5 minutes');
	advance(4 * 60_000);
	await streams.tick();
	assert.match(world.clipCalls.at(-1), /broadcaster_id=777/);
	assert.deepEqual(executor.announcements.map(a => a.payload.embed.title), ['Clip a', 'Clip b']);
	const sent = executor.announcements[0];
	assert.equal(sent.channelId, CLIPS_CHANNEL);
	assert.equal(sent.payload.embed.url, 'https://clips.twitch.tv/a');
	assert.equal(world.userCalls, 1);

	// Same clips again, plus one that showed up late with an older date, plus a filtered one
	world.clips.push(twitchClip('late', start + 90_000), twitchClip('tagged', start + 100_000, { title: 'Essai #test' }));
	advance(5 * 60_000);
	await streams.tick();
	assert.deepEqual(executor.announcements.map(a => a.payload.embed.title), ['Clip a', 'Clip b', 'Clip late']);
	assert.equal(world.userCalls, 1, 'broadcaster id kept');

	// A burst: 3 per check, the rest at the next one
	const later = start + 11 * 60_000;
	world.clips = [1, 2, 3, 4].map(n => twitchClip(`n${n}`, later + n * 1000));
	advance(5 * 60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 6);
	advance(5 * 60_000);
	await streams.tick();
	assert.equal(executor.announcements.length, 7);
	assert.equal(executor.announcements.at(-1).payload.embed.title, 'Clip n4');
	assert.ok((await streams.history()).some(h => h.kind === 'short' && h.url === 'https://clips.twitch.tv/n4'));
});

test('twitch clips: off by default, and an API error stays on the channel without blocking', async () => {
	const { streams, owner, world, advance, executor } = await setup();
	await streams.setCredentials(owner, { twitch: { clientId: 'abc', clientSecret: 'secret' } });
	const sub = await streams.save(owner, { platform: 'twitch', channel: 'brl_tv', targets: [target] });
	await streams.tick();
	assert.equal(world.clipCalls.length, 0);
	assert.equal(world.userCalls, 0);

	await streams.save(owner, { id: sub.id, config: { shorts: true } });
	world.clipsDown = true;
	advance(60_000);
	await streams.tick();
	assert.equal(world.clipCalls.length, 1);
	assert.match((await streams.get(sub.id)).state.error, /503/);

	// The channel is checked again 5 minutes later, its live still followed in between
	world.clipsDown = false;
	world.twitch = [twitchStream('s1')];
	advance(60_000);
	await streams.tick();
	assert.equal(world.clipCalls.length, 1);
	assert.equal(executor.announcements.length, 1);
	advance(4 * 60_000);
	await streams.tick();
	assert.equal(world.clipCalls.length, 2);
	assert.equal((await streams.get(sub.id)).state.error, null);
});
