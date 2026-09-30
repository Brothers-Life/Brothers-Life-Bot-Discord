import { Events } from 'discord.js';
import { memberLeft } from '../eventLog.js';

export const name = Events.GuildMemberRemove;
export function execute(member) {
	memberLeft(member);
}
