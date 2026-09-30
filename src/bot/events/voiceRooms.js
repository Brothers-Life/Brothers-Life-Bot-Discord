import { Events } from 'discord.js';
import { memberFacts } from '../memberFacts.js';

export const name = Events.VoiceStateUpdate;
// "Join to create" channels and personal rooms that become empty
export async function execute(oldState, state) {
	if (oldState.channelId === state.channelId || !state.member) return;
	await state.client.core.voiceRooms.voiceMoved(state.guild.id, memberFacts(state.member), { from: oldState.channelId, to: state.channelId });
}
