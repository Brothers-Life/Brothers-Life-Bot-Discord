import { Events } from 'discord.js';
import { memberJoined } from '../eventLog.js';
import { memberFacts } from '../memberFacts.js';

export const name = Events.GuildMemberAdd;
// The used invite can only be found once (the counters are refreshed): the log and the welcome share it
export async function execute(member) {
	const invite = await memberJoined(member);
	await member.client.core.onboarding.memberJoined(member.guild.id, memberFacts(member), { inviterId: invite?.inviterId ?? null });
}
