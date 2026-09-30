// What the core needs to know about a member (welcome messages, cards, anti-raid)
export function memberFacts(member) {
	return {
		id: member.id,
		username: member.user?.username ?? null,
		globalName: member.user?.globalName ?? null,
		avatarUrl: member.user?.displayAvatarURL({ extension: 'png', size: 256 }) ?? null,
		bot: Boolean(member.user?.bot),
		createdAt: member.user?.createdTimestamp ?? null,
		joinedAt: member.joinedTimestamp ?? null,
	};
}
