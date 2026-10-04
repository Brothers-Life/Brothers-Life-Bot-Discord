import { spawn } from 'node:child_process';
import {
	AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus,
	createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
} from '@discordjs/voice';
import { humanError } from './ytdlp.js';

// ffmpeg audio filters (speed is added as atempo)
const FILTERS = {
	bassboost: 'bass=g=10',
	nightcore: 'aresample=48000,asetrate=48000*1.25,aresample=48000',
	vaporwave: 'aresample=48000,asetrate=48000*0.8,aresample=48000',
	'8d': 'apulsator=hz=0.08',
	karaoke: 'stereotools=mlev=0.015625',
	echo: 'aecho=0.8:0.88:60:0.4',
	tremolo: 'tremolo=f=6:d=0.5',
	normalize: 'dynaudnorm',
};

function rateOf(speed, filters) {
	return speed * (filters.includes('nightcore') ? 1.25 : 1) * (filters.includes('vaporwave') ? 0.8 : 1);
}

// The voice side of the music: one connection + audio player per server.
// The sound comes from yt-dlp (downloading) piped into ffmpeg (seek, speed, filters, 48 kHz PCM).
export function createMusicBackend(client, { ytdlp, ffmpeg, logger = console }) {
	const sessions = new Map();
	const handlers = { onEnd: () => undefined, onLeft: () => undefined };

	function kill(processes) {
		for (const child of processes ?? []) {
			try {
				child.kill('SIGTERM');
			}
			catch {
				// already gone
			}
		}
	}

	function session(guildId) {
		const s = sessions.get(guildId);
		if (!s) throw new Error('Le bot n’est pas en vocal sur ce serveur.');
		return s;
	}

	return {
		// Set by the bot once the core exists
		setHandlers(next) {
			Object.assign(handlers, next);
		},

		async join(guildId, channelId) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) throw new Error('Le bot n’est pas sur ce serveur.');
			const channel = guild.channels.cache.get(channelId);
			if (!channel?.isVoiceBased()) throw new Error('Salon vocal introuvable.');
			const me = guild.members.me;
			if (!channel.permissionsFor(me)?.has(['Connect', 'Speak'])) throw new Error(`Le bot ne peut pas parler dans ${channel.name}.`);
			// Already there (should not happen): the old player and its processes go first
			const old = sessions.get(guildId);
			if (old) {
				sessions.delete(guildId);
				old.stopping = true;
				old.player.stop(true);
				kill(old.processes);
			}
			const connection = joinVoiceChannel({ channelId, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
			try {
				await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
			}
			catch {
				connection.destroy();
				throw new Error('Impossible de rejoindre le salon vocal.');
			}
			const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
			connection.subscribe(player);
			const s = { connection, player, resource: null, processes: [], seekMs: 0, rate: 1, volume: 100, stopping: false, lastError: null };
			sessions.set(guildId, s);

			player.on('stateChange', (before, after) => {
				if (after.status !== AudioPlayerStatus.Idle || before.status === AudioPlayerStatus.Idle) return;
				if (s.stopping) {
					s.stopping = false;
					return;
				}
				const error = s.lastError;
				s.lastError = null;
				handlers.onEnd(guildId, error);
			});
			player.on('error', (error) => {
				s.lastError = error.message;
			});
			// Kicked or moved: Discord gives a few seconds to reconnect, otherwise it is over
			connection.on(VoiceConnectionStatus.Disconnected, async () => {
				try {
					await Promise.race([
						entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
						entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
					]);
				}
				catch {
					if (sessions.get(guildId) === s) {
						kill(s.processes);
						sessions.delete(guildId);
						connection.destroy();
						handlers.onLeft(guildId);
					}
				}
			});
		},

		async play(guildId, { target, live = false, seekMs = 0, speed = 1, filters = [], volume = 100 }) {
			const s = session(guildId);
			// Only the last play counts: two quick changes, the slower start must not replace the newer one
			const token = s.playToken = (s.playToken ?? 0) + 1;
			const [spawned, located] = await Promise.allSettled([ytdlp.spawnAudio(target), ffmpeg.path()]);
			// No ffmpeg: the yt-dlp already started would download for nobody
			if (spawned.status === 'fulfilled' && located.status === 'rejected') kill([spawned.value]);
			const failed = [spawned, located].find(r => r.status === 'rejected');
			if (failed) throw new Error(`Lecture impossible : ${failed.reason?.message ?? failed.reason}`);
			const [source, ffmpegPath] = [spawned.value, located.value];
			source.on('error', (error) => {
				s.lastError = `yt-dlp ne démarre pas (${error.code ?? error.message}).`;
			});
			if (sessions.get(guildId) !== s || s.playToken !== token) {
				kill([source]);
				if (sessions.get(guildId) !== s) throw new Error('Le bot n’est plus en vocal sur ce serveur.');
				return;
			}
			const af = [...filters.map(f => FILTERS[f]).filter(Boolean), speed !== 1 ? `atempo=${speed}` : null].filter(Boolean).join(',');
			const args = [
				'-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
				// Output seeking: the audio before the position is decoded and dropped
				...(seekMs && !live ? ['-ss', (seekMs / 1000).toFixed(2)] : []),
				'-vn', ...(af ? ['-af', af] : []), '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
			];
			const encoder = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
			encoder.on('error', (error) => {
				s.lastError = `ffmpeg ne démarre pas (${error.code ?? error.message}).`;
				logger.warn('ffmpeg spawn failed:', error.message);
				kill([source]);
			});
			source.stdout.pipe(encoder.stdin);
			// A killed pipe is expected when skipping: not an error
			for (const stream of [encoder.stdin, source.stdout, encoder.stdout]) stream.on('error', () => undefined);
			let stderr = '';
			source.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
			source.on('close', (code) => {
				if (code && !encoder.killed && sessions.get(guildId) === s && s.processes.includes(source)) {
					s.lastError = humanError(stderr.split('\n').find(l => l.startsWith('ERROR')) ?? stderr.trim().split('\n').at(-1));
					logger.warn(`yt-dlp exited with ${code}:`, s.lastError);
				}
			});

			const resource = createAudioResource(encoder.stdout, { inputType: StreamType.Raw, inlineVolume: true });
			resource.volume.setVolume(volume / 100);
			const previous = s.processes;
			// Replacing a playing resource does not go through "idle": no false end of track
			s.stopping = false;
			s.player.play(resource);
			kill(previous);
			Object.assign(s, { resource, processes: [source, encoder], seekMs: live ? 0 : seekMs, rate: rateOf(speed, filters), volume });
		},

		async stop(guildId) {
			const s = sessions.get(guildId);
			if (!s) return;
			// A play still starting must not start after this stop
			s.playToken = (s.playToken ?? 0) + 1;
			s.stopping = s.player.state.status !== AudioPlayerStatus.Idle;
			s.player.stop(true);
			kill(s.processes);
			s.processes = [];
			s.resource = null;
		},

		async pause(guildId) {
			session(guildId).player.pause(true);
		},

		async resume(guildId) {
			session(guildId).player.unpause();
		},

		async setVolume(guildId, volume) {
			const s = session(guildId);
			s.volume = volume;
			s.resource?.volume?.setVolume(volume / 100);
		},

		// Where the track is (ms of the original track, whatever the speed)
		position(guildId) {
			const s = sessions.get(guildId);
			if (!s?.resource) return 0;
			return s.seekMs + s.resource.playbackDuration * s.rate;
		},

		async leave(guildId) {
			const s = sessions.get(guildId);
			if (!s) return;
			sessions.delete(guildId);
			s.stopping = true;
			s.player.stop(true);
			kill(s.processes);
			s.connection.destroy();
		},

		// People (not bots) in the bot's voice channel
		// Counted from the voice states: channel.members only sees cached members, so someone already in the
		// channel when the bot started was missed and the bot thought it was alone. Unknown users count as people.
		// null when the channel is not known: the caller must not take it for "nobody".
		async listeners(guildId, channelId = null) {
			const guild = client.guilds.cache.get(guildId);
			const target = channelId ?? guild?.members.me?.voice.channelId;
			if (!guild || !target) return null;
			return guild.voiceStates.cache.filter(state => state.channelId === target && state.id !== client.user.id && !client.users.cache.get(state.id)?.bot).size;
		},

		voiceChannelOf(guildId) {
			return client.guilds.cache.get(guildId)?.members.me?.voice.channelId ?? null;
		},

		destroyAll() {
			for (const guildId of [...sessions.keys()]) this.leave(guildId);
		},
	};
}
