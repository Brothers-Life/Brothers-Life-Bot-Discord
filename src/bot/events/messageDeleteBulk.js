import { Events } from 'discord.js';
import { messagesBulkDeleted } from '../eventLog.js';

export const name = Events.MessageBulkDelete;
export function execute(messages, channel) {
	messagesBulkDeleted(messages, channel);
}
