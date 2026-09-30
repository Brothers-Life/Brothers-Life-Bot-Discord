import { Events } from 'discord.js';
import { runKeywordCommands } from '../customCommands.js';

// Custom commands triggered by a keyword in a message
export const name = Events.MessageCreate;
export async function execute(message) {
	await runKeywordCommands(message);
}
