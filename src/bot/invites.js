// Invite tracking: compares invite use counters before/after a member joins
const cache = new Map();

export async function cacheGuildInvites(guild) {
	try {
		const invites = await guild.invites.fetch();
		cache.set(guild.id, new Map(invites.map(i => [i.code, { uses: i.uses ?? 0, inviterId: i.inviter?.id ?? null }])));
	}
	catch {
		// Missing "Manage Server": invite tracking is simply unavailable on that server
		cache.delete(guild.id);
	}
}

export function rememberInvite(invite) {
	if (!invite.guild) return;
	const invites = cache.get(invite.guild.id) ?? new Map();
	invites.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
	cache.set(invite.guild.id, invites);
}

export function forgetInvite(invite) {
	if (invite.guild) cache.get(invite.guild.id)?.delete(invite.code);
}

export async function findUsedInvite(guild) {
	const before = cache.get(guild.id);
	await cacheGuildInvites(guild);
	const after = cache.get(guild.id);
	if (!before || !after) return null;

	for (const [code, invite] of after) {
		if (invite.uses > (before.get(code)?.uses ?? 0)) return { code, inviterId: invite.inviterId };
	}
	// A single-use invite disappears once used
	const vanished = [...before.keys()].filter(code => !after.has(code));
	if (vanished.length === 1) return { code: vanished[0], inviterId: before.get(vanished[0]).inviterId };
	if (guild.vanityURLCode) return { code: guild.vanityURLCode, inviterId: null, vanity: true };
	return null;
}
