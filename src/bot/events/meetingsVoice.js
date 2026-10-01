import { Events } from 'discord.js';

export const name = Events.VoiceStateUpdate;
// Attendance of meetings: who comes into or leaves the voice channel of a meeting in progress
export function execute(oldState, state) {
	if (oldState.channelId === state.channelId || state.member?.user.bot) return;
	state.client.core.meetings.voiceChanged(state.guild.id, state.id, oldState.channelId, state.channelId);
}
