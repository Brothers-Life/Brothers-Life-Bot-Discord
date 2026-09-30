import { Events } from 'discord.js';
import { messageEdited } from '../eventLog.js';

export const name = Events.MessageUpdate;
export function execute(oldMessage, message) {
	messageEdited(oldMessage, message);
}
