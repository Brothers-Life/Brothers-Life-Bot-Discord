import { Events } from 'discord.js';
import { voiceChanged } from '../eventLog.js';

export const name = Events.VoiceStateUpdate;
export async function execute(oldState, state) {
	await voiceChanged(oldState, state);
}
