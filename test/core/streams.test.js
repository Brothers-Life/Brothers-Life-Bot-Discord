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
		<media:thumbnail url="https://i.ytimg.com/vi/${v.id}/hq.jpg"/></entry>`).join('')}</feed>`;
}

async function setup() {
	let clock = Date.UTC(2026, 9, 1, 18, 0);
	const world = { twitch: [], videos: [], tiktok: null, tokenCalls: 0, tiktokCalls: 0 };
	const fetchImpl = async (url) => {
		if (url.startsWith('https://id.twitch.tv/')) {
			world.tokenCalls++;
			return json({ access_token: 'tok', expires_in: 3600 });
		}
		if (url.startsWith('https://api.twitch.tv/helix/streams')) return json({ data: world.twitch });
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
