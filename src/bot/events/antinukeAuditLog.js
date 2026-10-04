import { AuditLogEvent, Events } from 'discord.js';
import { addsDangerousPermissions, hasDangerousPermissions } from '../../core/antinuke.js';

export const name = Events.GuildAuditLogEntryCreate;

const SIMPLE = {
	[AuditLogEvent.ChannelDelete]: 'channel_delete',
	[AuditLogEvent.ChannelCreate]: 'channel_create',
	[AuditLogEvent.RoleDelete]: 'role_delete',
	[AuditLogEvent.RoleCreate]: 'role_create',
	[AuditLogEvent.MemberBanAdd]: 'member_ban',
	[AuditLogEvent.MemberKick]: 'member_kick',
	[AuditLogEvent.MemberPrune]: 'member_prune',
	[AuditLogEvent.WebhookCreate]: 'webhook_create',
	[AuditLogEvent.EmojiDelete]: 'emoji_delete',
	[AuditLogEvent.StickerDelete]: 'sticker_delete',
	[AuditLogEvent.BotAdd]: 'bot_add',
};

// Which anti-nuke action an audit log entry is (null: not watched)
function actionOf(entry, guild) {
	const change = key => entry.changes?.find(c => c.key === key);
	switch (entry.action) {
	case AuditLogEvent.MemberRoleUpdate: {
		const added = change('$add')?.new ?? [];
		return added.some(r => hasDangerousPermissions(guild.roles.cache.get(r.id)?.permissions.bitfield)) ? 'dangerous_role' : null;
	}
	case AuditLogEvent.RoleUpdate: {
		const permissions = change('permissions');
		return permissions && addsDangerousPermissions(permissions.old, permissions.new) ? 'dangerous_role' : null;
	}
	case AuditLogEvent.GuildUpdate:
		return change('name') || change('vanity_url_code') ? 'guild_update' : null;
	default: {
		const type = SIMPLE[entry.action] ?? null;
		// Emojis and stickers share one limit
		return type === 'sticker_delete' ? 'emoji_delete' : type;
	}
	}
}

// Destructive actions done directly in Discord, counted per author by the anti-nuke
export async function execute(entry, guild) {
	const { core } = guild.client;
	if (!entry.executorId || entry.executorId === guild.client.user.id) return;
	const type = actionOf(entry, guild);
	if (!type) return;
	const target = entry.target;
	const targetName = target?.name ?? target?.username ?? entry.changes?.find(c => c.key === 'name')?.old ?? null;
	await core.antinuke.record(guild.id, { type, executorId: entry.executorId, targetId: entry.targetId ?? null, targetName });
}
