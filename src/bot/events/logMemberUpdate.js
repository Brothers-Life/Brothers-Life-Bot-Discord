import { Events } from 'discord.js';
import { memberUpdated } from '../eventLog.js';

export const name = Events.GuildMemberUpdate;
export async function execute(oldMember, member) {
	await memberUpdated(oldMember, member);
}
