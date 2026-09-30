import { AuditLogEvent, Events } from 'discord.js';
import { auditEntry } from '../eventLog.js';

export const name = Events.GuildAuditLogEntryCreate;

// Moderation done directly in Discord (right click > Ban, timeout...): handed to the sanctions service,
// which propagates it to the network if the author's rank allows it.
export async function execute(entry, guild) {
	const { core } = guild.client;
	// Role, channel and server changes go to the event logs (with their author)
	auditEntry(entry, guild);

	if (!entry.executorId || entry.executorId === guild.client.user.id || !entry.targetId) return;

	const base = { guildId: guild.id, userId: entry.targetId, executorId: entry.executorId, reason: entry.reason ?? null };

	switch (entry.action) {
	case AuditLogEvent.MemberBanAdd:
		return core.sanctions.handleNative({ ...base, kind: 'ban' });
	case AuditLogEvent.MemberBanRemove:
		return core.sanctions.handleNative({ ...base, kind: 'unban' });
	case AuditLogEvent.MemberKick:
		return core.sanctions.handleNative({ ...base, kind: 'kick' });
	case AuditLogEvent.MemberUpdate: {
		const change = entry.changes.find(c => c.key === 'communication_disabled_until');
		if (!change) return;
		const until = change.new ? Date.parse(change.new) : null;
		if (until && until > Date.now()) return core.sanctions.handleNative({ ...base, kind: 'timeout', until });
		if (!change.new && change.old) return core.sanctions.handleNative({ ...base, kind: 'untimeout' });
	}
	}
}
