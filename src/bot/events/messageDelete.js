import { Events } from 'discord.js';
import { messageDeleted } from '../eventLog.js';

export const name = Events.MessageDelete;
export function execute(message) {
	messageDeleted(message);
}
