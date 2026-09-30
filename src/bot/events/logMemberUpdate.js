import { Events } from 'discord.js';
import { memberUpdated } from '../eventLog.js';

export const name = Events.GuildMemberUpdate;
export function execute(oldMember, member) {
	memberUpdated(oldMember, member);
}
