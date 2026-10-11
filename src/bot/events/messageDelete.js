import { Events } from 'discord.js';
import { messageDeleted } from '../eventLog.js';

export const name = Events.MessageDelete;
export async function execute(message) {
	await messageDeleted(message);
}
