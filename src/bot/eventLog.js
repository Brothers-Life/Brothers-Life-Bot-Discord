import { AuditLogEvent, ChannelType } from 'discord.js';
import { findUsedInvite } from './invites.js';

// Turns Discord events into network events (stored + posted in the log channel of their category).
// Every function is safe to call for any server: the events service ignores servers outside the network.
// Posted logs carry as much as possible: the person as author (avatar), dates, links, images, IDs.

const clip = (text, max = 1000) => {
	if (!text) return '*vide*';
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const ts = (ms, style = 'R') => `<t:${Math.round(ms / 1000)}:${style}>`;
// Full date and "il y a…"
const when = ms => `${ts(ms, 'f')} · ${ts(ms)}`;
const who = (user) => (user ? `<@${user.id}> (${user.username ?? user.id})` : 'inconnu');
const avatar = (user, size = 256) => user?.displayAvatarURL?.({ size }) ?? null;
// The person as the embed author, their avatar as thumbnail
const person = user => (user?.id ? { author: { name: `${user.globalName ?? user.username ?? user.id}${user.username ? ` (@${user.username})` : ''}`, iconUrl: avatar(user, 128) }, thumbnail: avatar(user) } : {});
const IMAGE = /\.(png|jpe?g|gif|webp)(\?|$)/i;

// "2 ans 3 mois", "5 j 4 h", "12 min"
export function duration(ms) {
	if (!Number.isFinite(ms) || ms < 0) return '—';
	const minutes = Math.floor(ms / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days >= 365) return `${Math.floor(days / 365)} an${days >= 730 ? 's' : ''}${days % 365 >= 30 ? ` ${Math.floor((days % 365) / 30)} mois` : ''}`;
	if (days >= 30) return `${Math.floor(days / 30)} mois${days % 30 ? ` ${days % 30} j` : ''}`;
	if (days >= 1) return `${days} j${hours % 24 ? ` ${hours % 24} h` : ''}`;
	if (hours >= 1) return `${hours} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, '0')}` : ''}`;
	return `${Math.max(1, minutes)} min`;
}

const size = bytes => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`);

function record(guild, event) {
	return guild.client.core.events.record({ guildId: guild.id, ...event });
}

// --- Messages ---------------------------------------------------------------------------
export function messageEdited(oldMessage, message) {
	if (!message.guild || message.author?.bot || message.webhookId) return;
	const before = oldMessage.partial ? null : oldMessage.content;
	if (before === message.content) return;
	const fields = [
		{ name: 'Avant', value: before === null ? '*contenu inconnu (message ancien)*' : clip(before) },
		{ name: 'Après', value: clip(message.content) },
		{ name: 'Salon', value: `<#${message.channelId}>`, inline: true },
	];
	if (message.createdTimestamp) fields.push({ name: 'Écrit', value: when(message.createdTimestamp), inline: true });
	if (before !== null) fields.push({ name: 'Taille', value: `${before.length} → ${message.content?.length ?? 0} caractères`, inline: true });
	record(message.guild, {
		category: 'messages',
		type: 'message_edit',
		userId: message.author?.id,
		channelId: message.channelId,
		summary: `Message modifié par ${message.author?.username ?? 'inconnu'} dans #${message.channel?.name}`,
		details: { before, after: message.content, url: message.url },
		message: {
			...person(message.author),
			title: 'Message modifié',
			url: message.url,
			description: `${who(message.author)} dans <#${message.channelId}> · [voir le message](${message.url})`,
			fields,
			color: 'info',
			footer: `Membre ${message.author?.id ?? '?'} · message ${message.id ?? '?'}`,
		},
	});
}

export function messageDeleted(message) {
	if (!message.guild || message.author?.bot || message.webhookId) return;
	const files = [...(message.attachments?.values?.() ?? [])];
	const attachments = files.map(a => a.name);
	const content = message.partial ? null : message.content;
	const picture = files.find(a => a.contentType?.startsWith('image/') || IMAGE.test(a.name ?? ''));
	const fields = [{ name: 'Contenu', value: content === null ? '*contenu inconnu (message ancien)*' : clip(content) }];
	if (files.length) fields.push({ name: `Pièces jointes (${files.length})`, value: clip(files.map(a => `[${a.name}](${a.url})${a.size ? ` · ${size(a.size)}` : ''}`).join('\n')) });
	const stickers = [...(message.stickers?.values?.() ?? [])].map(s => s.name);
	if (stickers.length) fields.push({ name: 'Autocollants', value: stickers.join(', '), inline: true });
	if (message.embeds?.length) fields.push({ name: 'Embeds', value: String(message.embeds.length), inline: true });
	fields.push({ name: 'Salon', value: `<#${message.channelId}>`, inline: true });
	if (message.createdTimestamp) fields.push({ name: 'Écrit', value: when(message.createdTimestamp), inline: true });
	if (message.reference?.messageId) fields.push({ name: 'En réponse à', value: `[un message](https://discord.com/channels/${message.guild.id}/${message.reference.channelId ?? message.channelId}/${message.reference.messageId})`, inline: true });
	const mentions = message.mentions?.users?.size ?? 0;
	if (mentions) fields.push({ name: 'Mentions', value: String(mentions), inline: true });
	record(message.guild, {
		category: 'messages',
		type: 'message_delete',
		userId: message.author?.id ?? null,
		channelId: message.channelId,
		summary: `Message supprimé${message.author ? ` de ${message.author.username}` : ''} dans #${message.channel?.name}`,
		details: { content, attachments, createdAt: message.createdTimestamp ?? null },
		message: {
			...person(message.author),
			title: 'Message supprimé',
			description: `${message.author ? who(message.author) : 'Auteur inconnu'} dans <#${message.channelId}>`,
			fields,
			// The deleted image, while Discord still serves it
			image: picture?.proxyURL ?? picture?.url ?? null,
			color: 'danger',
			footer: `Membre ${message.author?.id ?? '?'} · message ${message.id ?? '?'}`,
		},
	});
}

export function messagesBulkDeleted(messages, channel) {
	if (!channel.guild) return;
	const counts = new Map();
	for (const m of messages.values()) if (m.author) counts.set(m.author.id, { user: m.author, n: (counts.get(m.author.id)?.n ?? 0) + 1 });
	const authors = [...counts.values()].map(c => c.user.username);
	const top = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 10);
	const known = [...messages.values()].filter(m => !m.partial && m.content);
	const sample = known.slice(-5).map(m => `**${m.author?.username ?? '?'}** : ${clip(m.content, 150)}`).join('\n');
	record(channel.guild, {
		category: 'messages',
		type: 'message_bulk_delete',
		channelId: channel.id,
		summary: `${messages.size} messages supprimés en masse dans #${channel.name}`,
		details: { count: messages.size, authors },
		message: {
			title: 'Suppression en masse',
			description: `**${messages.size}** messages supprimés dans <#${channel.id}>`,
			fields: [
				...(top.length ? [{ name: 'Auteurs', value: clip(top.map(c => `<@${c.user.id}> × ${c.n}`).join('\n')) }] : []),
				...(sample ? [{ name: 'Derniers messages connus', value: clip(sample) }] : []),
			],
			color: 'danger',
			footer: `Salon ${channel.id}`,
		},
	});
}

// --- Members ------------------------------------------------------------------------------
const BADGES = {
	Staff: 'Staff Discord', Partner: 'Partenaire', Hypesquad: 'HypeSquad Events', BugHunterLevel1: 'Chasseur de bugs', BugHunterLevel2: 'Chasseur de bugs (or)',
	HypeSquadOnlineHouse1: 'Bravery', HypeSquadOnlineHouse2: 'Brilliance', HypeSquadOnlineHouse3: 'Balance', PremiumEarlySupporter: 'Soutien de la première heure',
	VerifiedDeveloper: 'Développeur de bot vérifié', CertifiedModerator: 'Modérateur certifié', ActiveDeveloper: 'Développeur actif', VerifiedBot: 'Bot vérifié',
};

export async function memberJoined(member) {
	const invite = await findUsedInvite(member.guild).catch(() => null);
	const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
	const badges = member.user.flags?.toArray?.().map(f => BADGES[f]).filter(Boolean) ?? [];
	const fields = [
		{ name: 'Compte créé', value: `${ts(member.user.createdTimestamp, 'D')} · il y a ${duration(Date.now() - member.user.createdTimestamp)}${ageDays < 7 ? '\n⚠️ **compte récent**' : ''}`, inline: true },
		{ name: 'Membre n°', value: String(member.guild.memberCount), inline: true },
	];
	if (invite) fields.push({ name: 'Invitation', value: invite.vanity ? `lien personnalisé \`${invite.code}\`` : `\`${invite.code}\`${invite.inviterId ? ` de <@${invite.inviterId}>` : ''}${invite.uses ? ` · ${invite.uses} utilisations` : ''}`, inline: true });
	if (badges.length) fields.push({ name: 'Badges', value: badges.join(', '), inline: true });
	if (member.user.bot) fields.push({ name: 'Bot', value: '🤖 oui', inline: true });
	if (!member.user.avatar) fields.push({ name: 'Avatar', value: 'par défaut', inline: true });
	record(member.guild, {
		category: 'members',
		type: 'member_join',
		userId: member.id,
		actorId: invite?.inviterId ?? null,
		summary: `Arrivée de ${member.user.username}`,
		details: { accountCreatedAt: member.user.createdTimestamp, invite: invite?.code ?? null, inviterId: invite?.inviterId ?? null },
		message: {
			...person(member.user),
			title: 'Arrivée',
			description: `${who(member.user)} a rejoint le serveur`,
			fields,
			color: ageDays < 7 ? 'warning' : 'success',
			footer: `Membre ${member.id}`,
		},
	});
	return invite;
}

export function memberLeft(member) {
	const roles = member.roles?.cache.filter(r => r.id !== member.guild.id).map(r => r.name) ?? [];
	const roleIds = member.roles?.cache.filter(r => r.id !== member.guild.id).map(r => r.id) ?? [];
	const fields = [];
	if (member.joinedTimestamp) fields.push({ name: 'Arrivé', value: `${ts(member.joinedTimestamp, 'D')} · resté ${duration(Date.now() - member.joinedTimestamp)}`, inline: true });
	if (member.user?.createdTimestamp) fields.push({ name: 'Compte créé', value: ts(member.user.createdTimestamp, 'D'), inline: true });
	if (member.guild.memberCount) fields.push({ name: 'Membres restants', value: String(member.guild.memberCount), inline: true });
	if (roles.length) fields.push({ name: `Rôles (${roles.length})`, value: clip(roleIds.map(id => `<@&${id}>`).join(' ')) });
	if (member.premiumSinceTimestamp) fields.push({ name: 'Boostait depuis', value: ts(member.premiumSinceTimestamp, 'D'), inline: true });
	record(member.guild, {
		category: 'members',
		type: 'member_leave',
		userId: member.id,
		summary: `Départ de ${member.user?.username ?? member.id}`,
		details: { roles, joinedAt: member.joinedTimestamp ?? null },
		message: { ...person(member.user), title: 'Départ', description: `${who(member.user)} a quitté le serveur`, fields, color: 'warning', footer: `Membre ${member.id}` },
	});
}

export function memberUpdated(oldMember, member) {
	if (oldMember.partial) return;
	if (oldMember.avatar !== member.avatar) {
		const before = oldMember.avatar ? oldMember.displayAvatarURL?.({ size: 256 }) : null;
		record(member.guild, {
			category: 'members',
			type: 'member_avatar',
			userId: member.id,
			summary: `Avatar de serveur de ${member.user.username} ${member.avatar ? 'changé' : 'retiré'}`,
			details: { before: oldMember.avatar, after: member.avatar },
			message: {
				...person(member.user),
				title: 'Avatar de serveur modifié',
				description: who(member.user),
				fields: before ? [{ name: 'Ancien', value: `[voir](${before})`, inline: true }] : [],
				thumbnail: before,
				image: member.avatar ? member.displayAvatarURL?.({ size: 512 }) : null,
				color: 'purple',
				footer: `Membre ${member.id}`,
			},
		});
	}
	if (Boolean(oldMember.premiumSinceTimestamp) !== Boolean(member.premiumSinceTimestamp)) {
		const started = Boolean(member.premiumSinceTimestamp);
		record(member.guild, {
			category: 'members',
			type: 'member_boost',
			userId: member.id,
			summary: `${member.user.username} ${started ? 'boost le serveur' : 'ne boost plus le serveur'}`,
			details: { boosting: started },
			message: {
				...person(member.user),
				title: started ? 'Nouveau boost 💎' : 'Boost terminé',
				description: who(member.user),
				fields: [
					{ name: 'Boosts du serveur', value: String(member.guild.premiumSubscriptionCount ?? '?'), inline: true },
					{ name: 'Niveau', value: String(member.guild.premiumTier ?? '?'), inline: true },
					...(!started && oldMember.premiumSinceTimestamp ? [{ name: 'A boosté pendant', value: duration(Date.now() - oldMember.premiumSinceTimestamp), inline: true }] : []),
				],
				color: started ? 'pink' : 'warning',
				footer: `Membre ${member.id}`,
			},
		});
	}
	if (oldMember.nickname === member.nickname) return;
	record(member.guild, {
		category: 'members',
		type: 'member_nickname',
		userId: member.id,
		summary: `Pseudo de ${member.user.username} : ${oldMember.nickname ?? 'aucun'} → ${member.nickname ?? 'aucun'}`,
		details: { before: oldMember.nickname, after: member.nickname },
		message: {
			...person(member.user),
			title: 'Pseudo modifié',
			description: who(member.user),
			fields: [
				{ name: 'Avant', value: oldMember.nickname ?? '*aucun*', inline: true },
				{ name: 'Après', value: member.nickname ?? '*aucun*', inline: true },
			],
			color: 'teal',
			footer: `Membre ${member.id}`,
		},
	});
}

// Pseudo or Discord avatar changed: logged on every server of the network where the person is
export function userUpdated(oldUser, user) {
	if (oldUser.partial || user.bot) return;
	const changes = [];
	if (oldUser.username !== user.username) changes.push({ name: 'Pseudo', value: `${oldUser.username} → ${user.username}` });
	if (oldUser.globalName !== user.globalName) changes.push({ name: 'Nom affiché', value: `${oldUser.globalName ?? '—'} → ${user.globalName ?? '—'}` });
	if (oldUser.avatar !== user.avatar) changes.push({ name: 'Avatar', value: user.avatar ? 'changé' : 'retiré' });
	if (!changes.length) return;
	const avatarChanged = oldUser.avatar !== user.avatar;
	for (const guild of user.client.guilds.cache.values()) {
		if (!guild.members.cache.has(user.id)) continue;
		record(guild, {
			category: 'members',
			type: 'member_username',
			userId: user.id,
			summary: `${oldUser.username} : ${changes.map(c => `${c.name} ${c.value}`).join(', ')}`,
			details: { changes },
			message: {
				...person(user),
				title: 'Profil Discord modifié',
				description: who(user),
				fields: changes.map(c => ({ ...c, inline: true })),
				thumbnail: avatarChanged && oldUser.avatar ? oldUser.displayAvatarURL?.({ size: 256 }) : avatar(user),
				image: avatarChanged && user.avatar ? avatar(user, 512) : null,
				color: 'teal',
				footer: `Membre ${user.id}`,
			},
		});
	}
}

// --- Voice --------------------------------------------------------------------------------
// guildId:userId -> when they came into their current voice channel (to tell how long they stayed)
const voiceSince = new Map();

export function voiceChanged(oldState, state) {
	const user = state.member?.user;
	if (oldState.channelId && oldState.channelId === state.channelId) {
		const kinds = [['streaming', 'partage son écran', 'arrête de partager son écran', '🖥️'], ['selfVideo', 'allume sa caméra', 'coupe sa caméra', '📷']];
		for (const [key, on, off, icon] of kinds) {
			if (Boolean(oldState[key]) === Boolean(state[key])) continue;
			const text = state[key] ? on : off;
			record(state.guild, {
				category: 'voice',
				type: 'voice_stream',
				userId: state.id,
				channelId: state.channelId,
				summary: `${user?.username ?? state.id} ${text}`,
				details: { [key]: Boolean(state[key]) },
				message: { ...person(user), title: `Vocal ${icon}`, description: `${who(user)} ${text} dans <#${state.channelId}>`, color: state[key] ? 'purple' : 'neutral', footer: `Membre ${state.id}` },
			});
		}
		return;
	}
	if (oldState.channelId === state.channelId) return;
	const key = `${state.guild.id}:${state.id}`;
	const since = voiceSince.get(key);
	if (state.channelId) voiceSince.set(key, Date.now());
	else voiceSince.delete(key);
	const [type, summary, description] = !oldState.channelId
		? ['voice_join', 'a rejoint', `a rejoint <#${state.channelId}>`]
		: !state.channelId
			? ['voice_leave', 'a quitté', `a quitté <#${oldState.channelId}>`]
			: ['voice_move', 'a changé de salon', `<#${oldState.channelId}> → <#${state.channelId}>`];
	const fields = [];
	if (type !== 'voice_join' && since) fields.push({ name: 'Resté', value: duration(Date.now() - since), inline: true });
	const channel = state.channel ?? oldState.channel;
	const present = channel?.members?.size;
	if (present !== undefined) fields.push({ name: 'Dans le salon', value: `${present} personne${present > 1 ? 's' : ''}`, inline: true });
	record(state.guild, {
		category: 'voice',
		type,
		userId: state.id,
		channelId: state.channelId ?? oldState.channelId,
		summary: `${user?.username ?? state.id} ${summary} ${state.channel?.name ?? oldState.channel?.name ?? ''}`.trim(),
		details: { from: oldState.channelId, to: state.channelId, seconds: since ? Math.round((Date.now() - since) / 1000) : null },
		message: {
			...person(user),
			title: type === 'voice_join' ? 'Vocal : arrivée' : type === 'voice_leave' ? 'Vocal : départ' : 'Vocal : changement de salon',
			description: `${who(user)} ${description}`,
			fields,
			color: type === 'voice_leave' ? 'warning' : type === 'voice_join' ? 'success' : 'info',
			footer: `Membre ${state.id}`,
		},
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
			...person(invite.inviter),
			title: 'Invitation créée',
			url: `https://discord.gg/${invite.code}`,
			description: `${who(invite.inviter)} · \`${invite.code}\` vers <#${invite.channelId}>`,
			fields: [
				{ name: 'Utilisations max', value: invite.maxUses ? String(invite.maxUses) : 'illimité', inline: true },
				{ name: 'Expire', value: invite.maxAge ? when(Date.now() + invite.maxAge * 1000) : 'jamais', inline: true },
				{ name: 'Temporaire', value: invite.temporary ? 'oui (membres expulsés en se déconnectant)' : 'non', inline: true },
			],
			color: 'success',
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
		message: {
			title: 'Invitation supprimée',
			description: `\`${invite.code}\`${invite.channelId ? ` vers <#${invite.channelId}>` : ''}`,
			fields: invite.uses !== undefined && invite.uses !== null ? [{ name: 'Utilisée', value: `${invite.uses} fois`, inline: true }] : [],
			color: 'warning',
		},
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
	[AuditLogEvent.StickerCreate]: ['server', 'sticker_create', 'Autocollant ajouté'],
	[AuditLogEvent.StickerUpdate]: ['server', 'sticker_update', 'Autocollant modifié'],
	[AuditLogEvent.StickerDelete]: ['server', 'sticker_delete', 'Autocollant supprimé'],
	[AuditLogEvent.GuildScheduledEventCreate]: ['server', 'event_create', 'Événement programmé créé'],
	[AuditLogEvent.GuildScheduledEventUpdate]: ['server', 'event_update', 'Événement programmé modifié'],
	[AuditLogEvent.GuildScheduledEventDelete]: ['server', 'event_delete', 'Événement programmé supprimé'],
	[AuditLogEvent.AutoModerationRuleCreate]: ['server', 'automod_rule', 'Règle AutoMod créée'],
	[AuditLogEvent.AutoModerationRuleUpdate]: ['server', 'automod_rule', 'Règle AutoMod modifiée'],
	[AuditLogEvent.AutoModerationRuleDelete]: ['server', 'automod_rule', 'Règle AutoMod supprimée'],
	[AuditLogEvent.ThreadCreate]: ['threads', 'thread_create', 'Fil créé'],
	[AuditLogEvent.ThreadUpdate]: ['threads', 'thread_update', 'Fil modifié'],
	[AuditLogEvent.ThreadDelete]: ['threads', 'thread_delete', 'Fil supprimé'],
	[AuditLogEvent.BotAdd]: ['integrations', 'bot_add', 'Bot ajouté'],
	[AuditLogEvent.IntegrationCreate]: ['integrations', 'integration_create', 'Intégration ajoutée'],
	[AuditLogEvent.IntegrationUpdate]: ['integrations', 'integration_update', 'Intégration modifiée'],
	[AuditLogEvent.IntegrationDelete]: ['integrations', 'integration_delete', 'Intégration retirée'],
	[AuditLogEvent.WebhookCreate]: ['integrations', 'webhook_create', 'Webhook créé'],
	[AuditLogEvent.WebhookUpdate]: ['integrations', 'webhook_update', 'Webhook modifié'],
	[AuditLogEvent.WebhookDelete]: ['integrations', 'webhook_delete', 'Webhook supprimé'],
	[AuditLogEvent.MessagePin]: ['messages', 'message_pin', 'Message épinglé'],
	[AuditLogEvent.MessageUnpin]: ['messages', 'message_pin', 'Message désépinglé'],
	// Moderation done in Discord itself (the bot's own sanctions are logged by the sanctions service)
	[AuditLogEvent.MemberBanAdd]: ['discord_moderation', 'member_ban', 'Membre banni'],
	[AuditLogEvent.MemberBanRemove]: ['discord_moderation', 'member_unban', 'Membre débanni'],
	[AuditLogEvent.MemberKick]: ['discord_moderation', 'member_kick', 'Membre expulsé'],
	[AuditLogEvent.MemberPrune]: ['discord_moderation', 'member_prune', 'Membres inactifs expulsés'],
	[AuditLogEvent.AutoModerationBlockMessage]: ['discord_moderation', 'automod_block', 'Message bloqué par l’AutoMod'],
};

// Kinds of audit entries about a member: their target is a person
const MEMBER_TARGET = new Set([AuditLogEvent.MemberRoleUpdate, AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberBanRemove, AuditLogEvent.MemberKick, AuditLogEvent.MemberUpdate, AuditLogEvent.AutoModerationBlockMessage]);

// MemberUpdate carries timeouts and voice mutes, told apart by the changed key
function memberUpdateMapping(entry) {
	const keys = new Set(entry.changes.map(c => c.key));
	if (keys.has('communication_disabled_until')) {
		const change = entry.changes.find(c => c.key === 'communication_disabled_until');
		return ['discord_moderation', 'member_timeout', change.new ? 'Membre exclu temporairement' : 'Exclusion temporaire levée'];
	}
	if (keys.has('mute')) return ['voice', 'voice_server_mute', entry.changes.find(c => c.key === 'mute').new ? 'Micro coupé par la modération' : 'Micro rendu par la modération'];
	if (keys.has('deaf')) return ['voice', 'voice_server_deaf', entry.changes.find(c => c.key === 'deaf').new ? 'Son coupé par la modération' : 'Son rendu par la modération'];
	return null;
}

const CHANGE_LABELS = { communication_disabled_until: 'Exclu jusqu’au', mute: 'Micro coupé', deaf: 'Son coupé', archived: 'Archivé', locked: 'Verrouillé', auto_archive_duration: 'Archivage auto', channel_id: 'Salon', scheduled_start_time: 'Début', entity_type: 'Type', status: 'Statut', description: 'Description', tags: 'Émoji', enabled: 'Activée', actions: 'Actions', trigger_metadata: 'Déclencheur', name: 'Nom', color: 'Couleur', permissions: 'Permissions', hoist: 'Affiché séparément', mentionable: 'Mentionnable', topic: 'Sujet', nsfw: 'NSFW', rate_limit_per_user: 'Mode lent', parent_id: 'Catégorie', position: 'Position', bitrate: 'Débit', user_limit: 'Limite d’utilisateurs', icon_hash: 'Icône', verification_level: 'Niveau de vérification', allow: 'Autorisé', deny: 'Refusé' };

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

// Roles take their own color; creations green, removals and Discord moderation red, the rest blurple
function auditColor(entry, type, category) {
	if (category === 'roles' || category === 'member_roles') {
		const color = entry.target?.color ?? entry.changes.find(c => c.key === 'color')?.new;
		if (color) return color;
	}
	if (type.endsWith('_delete') || category === 'discord_moderation') return 'danger';
	if (type.endsWith('_create') || type === 'bot_add') return 'success';
	if (type === 'member_unban') return 'success';
	return 'info';
}

export function auditEntry(entry, guild) {
	const mapping = entry.action === AuditLogEvent.MemberUpdate ? memberUpdateMapping(entry) : AUDIT[entry.action];
	if (!mapping) return;
	const [category, type, title] = mapping;
	// The bot's own moderation is already logged (with its reason and author) by the sanctions service
	if (category === 'discord_moderation' && entry.executorId && entry.executorId === guild.client.user?.id) return;
	const name = targetName(entry);
	const executor = entry.executor ?? (entry.executorId ? { id: entry.executorId } : null);
	const aboutMember = MEMBER_TARGET.has(entry.action);

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
	else if (aboutMember || entry.action === AuditLogEvent.MemberPrune) {
		const target = entry.target ?? (entry.targetId ? { id: entry.targetId } : null);
		description = entry.action === AuditLogEvent.MemberPrune
			? `Par ${who(executor)} · ${entry.extra?.removed ?? '?'} membres inactifs depuis ${entry.extra?.days ?? '?'} jours`
			: `${who(target)} · par ${who(executor)}`;
		const until = entry.changes.find(c => c.key === 'communication_disabled_until')?.new;
		fields = [
			...(until ? [{ name: 'Jusqu’au', value: ts(Date.parse(until), 'f'), inline: true }] : []),
			...(entry.action === AuditLogEvent.AutoModerationBlockMessage && entry.extra?.channel ? [{ name: 'Salon', value: `<#${entry.extra.channel.id}>`, inline: true }, { name: 'Règle', value: String(entry.extra.autoModerationRuleName ?? '—'), inline: true }] : []),
			...(entry.reason ? [{ name: 'Raison', value: clip(entry.reason, 500) }] : []),
		];
		summary = `${title} : ${name}`;
	}
	else {
		if (entry.action === AuditLogEvent.MessagePin || entry.action === AuditLogEvent.MessageUnpin) {
			description = `Message de ${who(entry.target)} dans <#${entry.extra?.channel?.id}> · par ${who(executor)}`;
		}
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
		userId: aboutMember ? entry.targetId : null,
		actorId: entry.executorId ?? null,
		channelId: category === 'channels' || category === 'threads' ? entry.targetId : null,
		summary,
		details: { targetId: entry.targetId, changes: entry.changes, reason: entry.reason ?? null },
		message: {
			// Who did it as the author; the member concerned (or the server icon) as thumbnail
			...(executor?.username ? { author: person(executor).author } : { authorId: entry.executorId ?? null }),
			thumbnail: aboutMember ? avatar(entry.target) : category === 'server' ? guild.iconURL?.({ size: 256 }) ?? null : null,
			thumbnailUserId: aboutMember && !entry.target?.displayAvatarURL ? entry.targetId : null,
			title: `${title}${name && !aboutMember ? ` : ${name}` : ''}`,
			description,
			fields: [...fields, ...(fields.length < 24 ? [{ name: 'Quand', value: when(entry.createdTimestamp ?? Date.now()), inline: true }] : [])],
			color: auditColor(entry, type, category),
			footer: [entry.targetId ? `Cible ${entry.targetId}` : null, entry.executorId ? `par ${entry.executorId}` : null].filter(Boolean).join(' · ') || undefined,
		},
	});
}
