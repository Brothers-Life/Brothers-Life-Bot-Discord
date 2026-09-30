import { Events } from 'discord.js';

export const name = Events.VoiceStateUpdate;
export function execute(oldState, state) {
	if (oldState.channelId === state.channelId) return;
	const { stats } = state.client.core;
	stats.voiceState(state.guild.id, state.id, state.channelId, {
		bot: Boolean(state.member?.user?.bot),
		afk: Boolean(state.channelId && state.channelId === state.guild.afkChannelId),
	});
}
