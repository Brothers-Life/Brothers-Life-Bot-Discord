import { Events } from 'discord.js';
import { memberJoined } from '../eventLog.js';
import { memberFacts } from '../memberFacts.js';

export const name = Events.GuildMemberAdd;
// The used invite can only be found once (the counters are refreshed): the log and the welcome share it
export async function execute(member) {
	const { antiraid, onboarding } = member.client.core;
	const facts = memberFacts(member);
	const invite = await memberJoined(member);
	// A raid or a too recent account may remove the member: no welcome then
	const { blocked } = await antiraid.handleJoin(member.guild.id, facts);
	if (!blocked) await onboarding.memberJoined(member.guild.id, facts, { inviterId: invite?.inviterId ?? null });
}
