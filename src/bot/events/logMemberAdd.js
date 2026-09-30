import { Events } from 'discord.js';
import { memberJoined } from '../eventLog.js';

export const name = Events.GuildMemberAdd;
export async function execute(member) {
	await memberJoined(member);
}
