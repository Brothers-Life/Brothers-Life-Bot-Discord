import { AuditLogEvent, ChannelType } from 'discord.js';
import { findUsedInvite } from './invites.js';

// Turns Discord events into network events (stored + posted in the log channel of their category).
// Every function is safe to call for any server: the events service ignores servers outside the network.

const clip = (text, max = 1000) => {
	if (!text) return '*vide*';
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const ts = (ms, style = 'R') => `<t:${Math.round(ms / 1000)}:${style}>`;
const who = (user) => (user ? `<@${user.id}> (${user.username ?? user.id})` : 'inconnu');

function record(guild, event) {
	return guild.client.core.events.record({ guildId: guild.id, ...event });
}

// --- Messages ---------------------------------------------------------------------------
export function messageEdited(oldMessage, message) {
	if (!message.guild || message.author?.bot || message.webhookId) return;
	const before = oldMessage.partial ? null : oldMessage.content;
	if (before === message.content) return;
	record(message.guild, {
		category: 'messages',
		type: 'message_edit',
		userId: message.author?.id,
		channelId: message.channelId,
		summary: `Message modifié par ${message.author?.username ?? 'inconnu'} dans #${message.channel?.name}`,
		details: { before, after: message.content, url: message.url },
		message: {
			title: 'Message modifié',
			description: `${who(message.author)} dans <#${message.channelId}> · [voir le message](${message.url})`,
			fields: [
				{ name: 'Avant', value: before === null ? '*contenu inconnu (message ancien)*' : clip(before) },
				{ name: 'Après', value: clip(message.content) },
			],
			color: 'info',
		},
	});
}

export function messageDeleted(message) {
	if (!message.guild || message.author?.bot || message.webhookId) return;
	const attachments = message.attachments?.map(a => a.name) ?? [];
	const content = message.partial ? null : message.content;
	record(message.guild, {
		category: 'messages',
		type: 'message_delete',
		userId: message.author?.id ?? null,
		channelId: message.channelId,
		summary: `Message supprimé${message.author ? ` de ${message.author.username}` : ''} dans #${message.channel?.name}`,
		details: { content, attachments, createdAt: message.createdTimestamp ?? null },
		message: {
			title: 'Message supprimé',
			description: `${message.author ? who(message.author) : 'Auteur inconnu'} dans <#${message.channelId}>`,
			fields: [
				{ name: 'Contenu', value: content === null ? '*contenu inconnu (message ancien)*' : clip(content) },
				...(attachments.length ? [{ name: 'Pièces jointes', value: clip(attachments.join('\n')) }] : []),
			],
			color: 'danger',
		},
	});
}

export function messagesBulkDeleted(messages, channel) {
	if (!channel.guild) return;
	const authors = [...new Set(messages.map(m => m.author?.username).filter(Boolean))];
	record(channel.guild, {
		category: 'messages',
		type: 'message_bulk_delete',
		channelId: channel.id,
		summary: `${messages.size} messages supprimés en masse dans #${channel.name}`,
		details: { count: messages.size, authors },
		message: {
			title: 'Suppression en masse',
			description: `${messages.size} messages supprimés dans <#${channel.id}>`,
			fields: authors.length ? [{ name: 'Auteurs', value: clip(authors.join(', ')) }] : [],
			color: 'danger',
		},
	});
}

// --- Members ------------------------------------------------------------------------------
export async function memberJoined(member) {
	const invite = await findUsedInvite(member.guild).catch(() => null);
	const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
	const fields = [{ name: 'Compte créé', value: `${ts(member.user.createdTimestamp)}${ageDays < 7 ? ' ⚠️ compte récent' : ''}`, inline: true }];
	if (invite) fields.push({ name: 'Invitation', value: invite.vanity ? `lien personnalisé ${invite.code}` : `${invite.code}${invite.inviterId ? ` de <@${invite.inviterId}>` : ''}`, inline: true });
	fields.push({ name: 'Membres', value: String(member.guild.memberCount), inline: true });
	record(member.guild, {
		category: 'members',
		type: 'member_join',
		userId: member.id,
		actorId: invite?.inviterId ?? null,
		summary: `Arrivée de ${member.user.username}`,
		details: { accountCreatedAt: member.user.createdTimestamp, invite: invite?.code ?? null, inviterId: invite?.inviterId ?? null },
		message: { title: 'Arrivée', description: who(member.user), fields, color: ageDays < 7 ? 'warning' : 'success' },
	});
}

export function memberLeft(member) {
	const roles = member.roles?.cache.filter(r => r.id !== member.guild.id).map(r => r.name) ?? [];
	record(member.guild, {
		category: 'members',
		type: 'member_leave',
		userId: member.id,
		summary: `Départ de ${member.user?.username ?? member.id}`,
		details: { roles, joinedAt: member.joinedTimestamp ?? null },
		message: {
			title: 'Départ',
			description: who(member.user),
			fields: [
				...(member.joinedTimestamp ? [{ name: 'Arrivé', value: ts(member.joinedTimestamp), inline: true }] : []),
				...(roles.length ? [{ name: 'Rôles', value: clip(roles.join(', ')) }] : []),
			],
			color: 'warning',
		},
	});
}

export function memberUpdated(oldMember, member) {
	if (oldMember.partial || oldMember.nickname === member.nickname) return;
	record(member.guild, {
		category: 'members',
		type: 'member_nickname',
		userId: member.id,
		summary: `Pseudo de ${member.user.username} : ${oldMember.nickname ?? 'aucun'} → ${member.nickname ?? 'aucun'}`,
		details: { before: oldMember.nickname, after: member.nickname },
		message: {
			title: 'Pseudo modifié',
			description: who(member.user),
			fields: [
				{ name: 'Avant', value: oldMember.nickname ?? '*aucun*', inline: true },
				{ name: 'Après', value: member.nickname ?? '*aucun*', inline: true },
			],
		},
	});
}

// --- Voice --------------------------------------------------------------------------------
export function voiceChanged(oldState, state) {
	if (oldState.channelId === state.channelId) return;
	const user = state.member?.user;
	const [type, summary, description] = !oldState.channelId
		? ['voice_join', 'a rejoint', `a rejoint <#${state.channelId}>`]
		: !state.channelId
			? ['voice_leave', 'a quitté', `a quitté <#${oldState.channelId}>`]
			: ['voice_move', 'a changé de salon', `<#${oldState.channelId}> → <#${state.channelId}>`];
	record(state.guild, {
		category: 'voice',
		type,
		userId: state.id,
		channelId: state.channelId ?? oldState.channelId,
		summary: `${user?.username ?? state.id} ${summary} ${state.channel?.name ?? oldState.channel?.name ?? ''}`.trim(),
		details: { from: oldState.channelId, to: state.channelId },
		message: { title: 'Vocal', description: `${who(user)} ${description}`, color: type === 'voice_leave' ? 'warning' : 'info' },
	});
}

// --- Invites --------------------------------------------------------------------------------
export function inviteCreated(invite) {
	if (!invite.guild) return;
	record(invite.guild, {
		category: 'invites',
		type: 'invite_create',
		userId: invite.inviter?.id ?? null,
		channelId: invite.channelId,
		summary: `Invitation ${invite.code} créée par ${invite.inviter?.username ?? 'inconnu'}`,
		details: { code: invite.code, maxUses: invite.maxUses, maxAge: invite.maxAge },
		message: {
			title: 'Invitation créée',
			description: `${who(invite.inviter)} · \`${invite.code}\` vers <#${invite.channelId}>`,
			fields: [
				{ name: 'Utilisations max', value: invite.maxUses ? String(invite.maxUses) : 'illimité', inline: true },
				{ name: 'Expire', value: invite.maxAge ? ts(Date.now() + invite.maxAge * 1000) : 'jamais', inline: true },
			],
		},
	});
}

export function inviteDeleted(invite) {
	if (!invite.guild) return;
	record(invite.guild, {
		category: 'invites',
		type: 'invite_delete',
		channelId: invite.channelId,
		summary: `Invitation ${invite.code} supprimée`,
		details: { code: invite.code },
		message: { title: 'Invitation supprimée', description: `\`${invite.code}\``, color: 'warning' },
	});
}

// --- Audit log entries: roles, channels, member roles, server ------------------------------
const AUDIT = {
	[AuditLogEvent.MemberRoleUpdate]: ['member_roles', 'member_roles_update', 'Rôles d’un membre modifiés'],
	[AuditLogEvent.RoleCreate]: ['roles', 'role_create', 'Rôle créé'],
	[AuditLogEvent.RoleUpdate]: ['roles', 'role_update', 'Rôle modifié'],
	[AuditLogEvent.RoleDelete]: ['roles', 'role_delete', 'Rôle supprimé'],
	[AuditLogEvent.ChannelCreate]: ['channels', 'channel_create', 'Salon créé'],
	[AuditLogEvent.ChannelUpdate]: ['channels', 'channel_update', 'Salon modifié'],
	[AuditLogEvent.ChannelDelete]: ['channels', 'channel_delete', 'Salon supprimé'],
	[AuditLogEvent.ChannelOverwriteCreate]: ['channels', 'channel_permissions', 'Permissions d’un salon modifiées'],
	[AuditLogEvent.ChannelOverwriteUpdate]: ['channels', 'channel_permissions', 'Permissions d’un salon modifiées'],
	[AuditLogEvent.ChannelOverwriteDelete]: ['channels', 'channel_permissions', 'Permissions d’un salon modifiées'],
	[AuditLogEvent.GuildUpdate]: ['server', 'guild_update', 'Serveur modifié'],
	[AuditLogEvent.EmojiCreate]: ['server', 'emoji_create', 'Émoji ajouté'],
	[AuditLogEvent.EmojiUpdate]: ['server', 'emoji_update', 'Émoji modifié'],
	[AuditLogEvent.EmojiDelete]: ['server', 'emoji_delete', 'Émoji supprimé'],
};

const CHANGE_LABELS = { name: 'Nom', color: 'Couleur', permissions: 'Permissions', hoist: 'Affiché séparément', mentionable: 'Mentionnable', topic: 'Sujet', nsfw: 'NSFW', rate_limit_per_user: 'Mode lent', parent_id: 'Catégorie', position: 'Position', bitrate: 'Débit', user_limit: 'Limite d’utilisateurs', icon_hash: 'Icône', verification_level: 'Niveau de vérification', allow: 'Autorisé', deny: 'Refusé' };

function formatValue(value) {
	if (value === undefined || value === null || value === '') return '—';
	if (Array.isArray(value)) return value.map(v => v?.name ?? v?.id ?? JSON.stringify(v)).join(', ') || '—';
	if (typeof value === 'object') return JSON.stringify(value).slice(0, 200);
	return String(value).slice(0, 200);
}

function targetName(entry) {
	const target = entry.target;
	const fromChanges = entry.changes.find(c => c.key === 'name');
	if (target?.name) return target.name;
	if (target?.username) return target.username;
	return fromChanges?.old ?? fromChanges?.new ?? entry.targetId ?? '';
}

export function auditEntry(entry, guild) {
	const mapping = AUDIT[entry.action];
	if (!mapping) return;
	const [category, type, title] = mapping;
	const name = targetName(entry);
	const executor = entry.executor ?? (entry.executorId ? { id: entry.executorId } : null);

	let description = `Par ${who(executor)}`;
	let fields = [];
	let summary = `${title} : ${name}`;

	if (entry.action === AuditLogEvent.MemberRoleUpdate) {
		const added = entry.changes.find(c => c.key === '$add')?.new ?? [];
		const removed = entry.changes.find(c => c.key === '$remove')?.new ?? [];
		description = `${who(entry.target)} · par ${who(executor)}`;
		fields = [
			...(added.length ? [{ name: 'Ajoutés', value: added.map(r => `<@&${r.id}>`).join(' ') }] : []),
			...(removed.length ? [{ name: 'Retirés', value: removed.map(r => `<@&${r.id}>`).join(' ') }] : []),
		];
		summary = `Rôles de ${name} : ${[...added.map(r => `+${r.name}`), ...removed.map(r => `-${r.name}`)].join(' ')}`;
	}
	else {
		if (category === 'channels' && entry.target?.type !== undefined && entry.target.type !== ChannelType.GuildCategory && entry.action !== AuditLogEvent.ChannelDelete) {
			description = `<#${entry.targetId}> · par ${who(executor)}`;
		}
		fields = entry.changes
			.filter(c => !c.key.startsWith('$'))
			.slice(0, 10)
			.map(c => ({ name: CHANGE_LABELS[c.key] ?? c.key, value: `${formatValue(c.old)} → ${formatValue(c.new)}`.slice(0, 1000), inline: true }));
		if (entry.reason) fields.push({ name: 'Raison', value: clip(entry.reason, 500) });
	}

	record(guild, {
		category,
		type,
		userId: entry.action === AuditLogEvent.MemberRoleUpdate ? entry.targetId : null,
		actorId: entry.executorId ?? null,
		channelId: category === 'channels' ? entry.targetId : null,
		summary,
		details: { targetId: entry.targetId, changes: entry.changes, reason: entry.reason ?? null },
		message: { title: `${title}${name && entry.action !== AuditLogEvent.MemberRoleUpdate ? ` : ${name}` : ''}`, description, fields, color: type.endsWith('_delete') ? 'danger' : 'info' },
	});
}
