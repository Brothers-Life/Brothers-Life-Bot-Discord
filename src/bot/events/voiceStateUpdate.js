import { Events } from 'discord.js';
import { voiceChanged } from '../eventLog.js';

export const name = Events.VoiceStateUpdate;
export function execute(oldState, state) {
	voiceChanged(oldState, state);
}
