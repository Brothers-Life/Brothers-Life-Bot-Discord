import { Events } from 'discord.js';
import { memberLeft } from '../eventLog.js';
import { memberFacts } from '../memberFacts.js';

export const name = Events.GuildMemberRemove;
export async function execute(member) {
	memberLeft(member);
	await member.client.core.onboarding.memberLeft(member.guild.id, memberFacts(member));
}
