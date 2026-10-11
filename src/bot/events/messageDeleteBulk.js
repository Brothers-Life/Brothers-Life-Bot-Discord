import { Events } from 'discord.js';
import { messagesBulkDeleted } from '../eventLog.js';

export const name = Events.MessageBulkDelete;
export async function execute(messages, channel) {
	await messagesBulkDeleted(messages, channel);
}
