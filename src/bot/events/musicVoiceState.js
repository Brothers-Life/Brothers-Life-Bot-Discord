import { Events } from 'discord.js';

export const name = Events.VoiceStateUpdate;
// The bot moved to another voice channel (or disconnected) by someone: the music follows
export async function execute(oldState, state) {
	if (state.id !== state.client.user?.id || oldState.channelId === state.channelId) return;
	await state.client.core.music.moved(state.guild.id, state.channelId);
}
