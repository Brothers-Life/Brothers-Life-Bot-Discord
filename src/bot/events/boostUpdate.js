import { Events } from 'discord.js';
import { memberFacts } from '../memberFacts.js';

export const name = Events.GuildMemberUpdate;
// premiumSince appears when someone boosts the server, disappears when the boost ends
export async function execute(oldMember, member) {
	if (oldMember.partial) return;
	const { onboarding } = member.client.core;
	if (!oldMember.premiumSinceTimestamp && member.premiumSinceTimestamp) await onboarding.boostStarted(member.guild.id, memberFacts(member));
	if (oldMember.premiumSinceTimestamp && !member.premiumSinceTimestamp) await onboarding.boostEnded(member.guild.id, memberFacts(member));
}
