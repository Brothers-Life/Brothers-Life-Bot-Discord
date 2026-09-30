import fs from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../../core/errors.js';
import { FILTERS, LOOPS, SPEEDS } from '../../core/music/index.js';
import { resolveNames, snowflake } from './helpers.js';

const guildParam = { type: 'object', properties: { guildId: snowflake }, required: ['guildId'] };

export function registerMusicRoutes(app, { core }) {
	const { music, network, executor, audit } = core;
	// Cookies of a YouTube account (Netscape format) read by yt-dlp: servers in datacenters are often asked to sign in
	const cookiesFile = path.join(core.config.DATA_DIR, 'youtube-cookies.txt');
	const ctxOf = (request) => ({ actorId: request.actor.id, source: 'panel', can: request.actor.can });
	const withNames = async (state) => {
		if (!state.connected) return state;
		const names = await resolveNames(executor, state.queue.map(t => t.requestedBy));
		return { ...state, queue: state.queue.map(t => ({ ...t, requester: names.get(t.requestedBy) ?? null })) };
	};

	app.get('/api/music', { config: { permission: 'music.use' } }, async (request) => {
		const guilds = network.list().filter(g => g.status === 'active' && g.botPresent);
		const manage = request.actor.can('music.manage');
		return {
			guilds: await Promise.all(guilds.map(async g => ({
				id: g.id, name: g.name, icon: g.icon ?? null,
				voiceChannels: await executor.listVoiceChannels(g.id),
				roles: manage ? (await executor.listRoles(g.id)).filter(r => r.id !== g.id).map(({ id, name, color }) => ({ id, name, color })) : [],
				state: await withNames(music.state(g.id)),
			}))),
			config: music.config(),
			filters: FILTERS,
			speeds: SPEEDS,
			cookies: fs.existsSync(cookiesFile),
		};
	});

	app.get('/api/music/:guildId', { config: { permission: 'music.use' }, schema: { params: guildParam } }, async (request) => withNames(music.state(request.params.guildId)));

	app.get('/api/music/search', {
		config: { permission: 'music.use' },
		schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 2, maxLength: 200 } } } },
	}, async (request) => music.search(request.query.q, 8));

	app.post('/api/music/:guildId/play', {
		config: { permission: 'music.use' },
		schema: {
			params: guildParam,
			body: { type: 'object', required: ['query'], properties: { query: { type: 'string', maxLength: 500 }, channelId: snowflake, when: { type: 'string', enum: ['end', 'next', 'now'] } } },
		},
	}, async (request) => {
		const { query, channelId, when = 'end' } = request.body;
		const result = await music.play(ctxOf(request), request.params.guildId, query, { channelId, next: when === 'next', now: when === 'now' });
		return { added: result.tracks.length, playlist: result.playlist, truncated: result.truncated, first: result.tracks[0]?.title ?? null };
	});

	app.post('/api/music/:guildId/control', {
		config: { permission: 'music.use' },
		schema: {
			params: guildParam,
			body: {
				type: 'object',
				required: ['action'],
				properties: {
					action: { type: 'string', enum: ['pause', 'resume', 'skip', 'previous', 'stop', 'seek', 'volume', 'speed', 'filters', 'loop', 'shuffle', 'remove', 'move', 'jump', 'clear'] },
					value: {},
					to: { type: 'integer' },
				},
			},
		},
	}, async (request) => {
		const { guildId } = request.params;
		const { action, value, to } = request.body;
		const ctx = ctxOf(request);
		const number = () => {
			if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError('Valeur invalide.');
			return value;
		};
		switch (action) {
		case 'pause': await music.pause(ctx, guildId, true); break;
		case 'resume': await music.pause(ctx, guildId, false); break;
		case 'skip': await music.skip(ctx, guildId); break;
		case 'previous': await music.previous(ctx, guildId); break;
		case 'stop': await music.stop(ctx, guildId); break;
		case 'seek': await music.seek(ctx, guildId, number()); break;
		case 'volume': await music.setVolume(ctx, guildId, number()); break;
		case 'speed': await music.setSpeed(ctx, guildId, number()); break;
		case 'filters': await music.setFilters(ctx, guildId, Array.isArray(value) ? value.map(String) : []); break;
		case 'loop': music.setLoop(ctx, guildId, LOOPS.includes(value) ? value : undefined); break;
		case 'shuffle': music.shuffle(ctx, guildId); break;
		case 'remove': await music.remove(ctx, guildId, number()); break;
		case 'move': music.move(ctx, guildId, number(), to); break;
		case 'jump': await music.jump(ctx, guildId, number()); break;
		case 'clear': music.clear(ctx, guildId); break;
		}
		return withNames(music.state(guildId));
	});

	app.put('/api/music/cookies', {
		config: { permission: 'music.manage' },
		schema: { body: { type: 'object', required: ['content'], properties: { content: { type: 'string', maxLength: 500_000 } } } },
	}, async (request) => {
		const { content } = request.body;
		const lines = content.split(/\r?\n/).filter(l => l && !l.startsWith('#'));
		if (!lines.length || !lines.some(l => l.split('\t').length >= 7 && /youtube\.com/.test(l))) {
			throw new ValidationError('Ce n’est pas un fichier de cookies YouTube (format Netscape, « cookies.txt »).');
		}
		fs.mkdirSync(path.dirname(cookiesFile), { recursive: true });
		fs.writeFileSync(cookiesFile, content, { mode: 0o600 });
		audit.record({ actorId: request.actor.id, source: 'panel', action: 'music.config', details: { cookies: 'ajoutés' } });
		return { ok: true };
	});

	app.delete('/api/music/cookies', { config: { permission: 'music.manage' } }, async (request) => {
		fs.rmSync(cookiesFile, { force: true });
		audit.record({ actorId: request.actor.id, source: 'panel', action: 'music.config', details: { cookies: 'retirés' } });
		return { ok: true };
	});

	app.put('/api/music/config', { config: { permission: 'music.manage' }, schema: { body: { type: 'object' } } }, async (request) => music.setConfig(request.actor, request.body));
}

// Saved playlists (anyone who can pilot the music from the panel; changes by their owner or music.manage)
export function registerPlaylistRoutes(app, { core }) {
	const { music, executor } = core;
	const lists = music.playlists;
	const ctxOf = (request) => ({ actorId: request.actor.id, source: 'panel', can: request.actor.can });
	const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
	const withOwners = async (items) => {
		const names = await resolveNames(executor, items.map(p => p.ownerId));
		return items.map(p => ({ ...p, owner: names.get(p.ownerId) ?? null }));
	};

	app.get('/api/music/playlists', { config: { permission: 'music.use' } }, async (request) => withOwners(lists.list(request.actor.id)));

	app.get('/api/music/playlists/:id', { config: { permission: 'music.use' }, schema: { params: idParam } }, async (request) => (await withOwners([lists.get(request.params.id, request.actor.id)]))[0]);

	app.post('/api/music/playlists', {
		config: { permission: 'music.use' },
		schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 60 }, shared: { type: 'boolean' }, fromGuildId: snowflake } } },
	}, async (request) => {
		const { name, shared = true, fromGuildId } = request.body;
		return fromGuildId ? music.saveQueue(ctxOf(request), fromGuildId, { name, shared }) : lists.create(ctxOf(request), { name, shared });
	});

	app.patch('/api/music/playlists/:id', {
		config: { permission: 'music.use' },
		schema: { params: idParam, body: { type: 'object', properties: { name: { type: 'string', maxLength: 60 }, shared: { type: 'boolean' } } } },
	}, async (request) => lists.update(ctxOf(request), request.params.id, request.body));

	app.delete('/api/music/playlists/:id', { config: { permission: 'music.use' }, schema: { params: idParam } }, async (request) => {
		lists.remove(ctxOf(request), request.params.id);
		return { ok: true };
	});

	app.post('/api/music/playlists/:id/tracks', {
		config: { permission: 'music.use' },
		schema: { params: idParam, body: { type: 'object', required: ['query'], properties: { query: { type: 'string', maxLength: 500 } } } },
	}, async (request) => music.addToPlaylist(ctxOf(request), request.params.id, request.body.query));

	app.delete('/api/music/playlists/:id/tracks/:index', {
		config: { permission: 'music.use' },
		schema: { params: { type: 'object', properties: { id: { type: 'integer' }, index: { type: 'integer' } }, required: ['id', 'index'] } },
	}, async (request) => lists.removeTrack(ctxOf(request), request.params.id, request.params.index));

	app.post('/api/music/playlists/:id/move', {
		config: { permission: 'music.use' },
		schema: { params: idParam, body: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'integer' }, to: { type: 'integer' } } } },
	}, async (request) => lists.moveTrack(ctxOf(request), request.params.id, request.body.from, request.body.to));

	app.post('/api/music/:guildId/playlist/:id', {
		config: { permission: 'music.use' },
		schema: {
			params: { type: 'object', properties: { guildId: snowflake, id: { type: 'integer' } }, required: ['guildId', 'id'] },
			body: { type: 'object', properties: { channelId: snowflake, when: { type: 'string', enum: ['end', 'next', 'now'] }, shuffle: { type: 'boolean' } } },
		},
	}, async (request) => {
		const { channelId, when = 'end', shuffle = false } = request.body ?? {};
		const result = await music.playPlaylist(ctxOf(request), request.params.guildId, request.params.id, { channelId, shuffle, next: when === 'next', now: when === 'now' });
		return { added: result.tracks.length, playlist: result.playlist, truncated: result.truncated };
	});
}
