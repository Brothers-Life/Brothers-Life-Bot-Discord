import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, GuildVerificationLevel, PermissionFlagsBits, PermissionsBitField, RESTJSONErrorCodes } from 'discord.js';
import { noticePayload, panelPayload, ratingPayload, welcomePayload } from './ticketsUi.js';
import { buildEmbeds, emojiOf } from './messages.js';
import { roomPanel } from './voiceUi.js';
import { pollPayload, pollResultsPayload } from './pollsUi.js';
import { giveawayPayload, winnersPayload } from './giveawaysUi.js';
import { boxPanelPayload, feedbackPayload, reviewPayload } from './feedbackUi.js';

const COLORS = {
	info: 0x5865f2,
	success: 0x57f287,
	warning: 0xfee75c,
	danger: 0xed4245,
};

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
// Roles carrying these can moderate or administrate: only the owner may hand them out from the panel
const DANGEROUS_PERMISSIONS = [
	PermissionFlagsBits.Administrator,
	PermissionFlagsBits.ManageGuild,
	PermissionFlagsBits.ManageRoles,
	PermissionFlagsBits.ManageChannels,
	PermissionFlagsBits.ManageWebhooks,
	PermissionFlagsBits.BanMembers,
	PermissionFlagsBits.KickMembers,
	PermissionFlagsBits.ModerateMembers,
	PermissionFlagsBits.ManageMessages,
	PermissionFlagsBits.MentionEveryone,
];
const LOG_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

export function toEmbed(message) {
	const embed = new EmbedBuilder().setColor(COLORS[message.color] ?? COLORS.info);
	if (message.title) embed.setTitle(message.title.slice(0, 256));
	if (message.description) embed.setDescription(message.description.slice(0, 4096));
	if (message.fields?.length) {
		embed.addFields(message.fields.slice(0, 25).map(f => ({
			name: String(f.name).slice(0, 256),
			value: String(f.value || '—').slice(0, 1024),
			inline: Boolean(f.inline),
		})));
	}
	if (message.footer) embed.setFooter({ text: message.footer.slice(0, 2048) });
	embed.setTimestamp(message.timestamp ? new Date(message.timestamp) : new Date());
	return embed;
}

// [{ name, content }] -> attachments
function toFiles(files = []) {
	return files.map(f => new AttachmentBuilder(Buffer.from(f.content, 'utf8'), { name: f.name }));
}

const TICKET_MEMBER = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];

function canSend(channel) {
	const me = channel.guild.members.me;
	return Boolean(me && channel.permissionsFor(me)?.has(LOG_PERMISSIONS));
}

// Permissions of a personal voice channel from its state
function roomOverwrites(guild, { ownerId, locked, hidden, permitted = [], rejected = [] }) {
	const everyone = { id: guild.id, allow: [], deny: [] };
	if (locked) everyone.deny.push(PermissionFlagsBits.Connect);
	if (hidden) everyone.deny.push(PermissionFlagsBits.ViewChannel);
	const people = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];
	return [
		everyone,
		{ id: guild.client.user.id, allow: [...people, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.SendMessages] },
		{ id: ownerId, allow: [...people, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream] },
		...permitted.filter(id => id !== ownerId).map(id => ({ id, allow: people })),
		...rejected.filter(id => id !== ownerId).map(id => ({ id, deny: people })),
	];
}

function notInGuild(guildId) {
	const error = new Error(`The bot is not on server ${guildId}`);
	error.code = 'NO_GUILD';
	return error;
}

// The only piece of code that talks to Discord on behalf of src/core
export function createExecutor(client) {
	// channelId -> webhook used to answer tickets from the panel
	const ticketWebhooks = new Map();

	function guildOf(guildId) {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) throw notInGuild(guildId);
		return guild;
	}

	async function memberOf(guild, userId) {
		try {
			return guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
		}
		catch (error) {
			if (error.code === RESTJSONErrorCodes.UnknownMember || error.code === RESTJSONErrorCodes.UnknownUser) return null;
			throw error;
		}
	}

	return {
		botUserId() {
			return client.user?.id ?? null;
		},

		// --- Moderation (a return value of 'not_member' means "nothing to do there") -------
		async ban(guildId, userId, { reason, deleteMessageSeconds = 0 } = {}) {
			await guildOf(guildId).bans.create(userId, { reason, deleteMessageSeconds });
		},

		async unban(guildId, userId, reason) {
			try {
				await guildOf(guildId).bans.remove(userId, reason);
			}
			catch (error) {
				if (error.code === RESTJSONErrorCodes.UnknownBan) return 'not_member';
				throw error;
			}
		},

		async kick(guildId, userId, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member) return 'not_member';
			await member.kick(reason);
		},

		async timeout(guildId, userId, ms, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member) return 'not_member';
			await member.timeout(ms, reason);
		},

		async fetchBans(guildId) {
			const bans = await guildOf(guildId).bans.fetch();
			return [...bans.values()].map(b => ({ userId: b.user.id, username: b.user.username, reason: b.reason }));
		},

		// --- Moderation commands -------------------------------------------------------------
		// Deletes the last `count` matching messages (Discord only bulk-deletes messages under 14 days)
		async purgeMessages(channelId, { count, userId, contains, botsOnly }) {
			const channel = await client.channels.fetch(channelId);
			const limit = Date.now() - 14 * 86_400_000 + 60_000;
			let deleted = 0;
			let before;
			let scanned = 0;
			while (deleted < count && scanned < 2000) {
				const batch = await channel.messages.fetch({ limit: 100, before });
				if (!batch.size) break;
				scanned += batch.size;
				before = batch.last().id;
				const wanted = [...batch.values()]
					.filter(m => m.createdTimestamp > limit && !m.pinned)
					.filter(m => !userId || m.author.id === userId)
					.filter(m => !botsOnly || m.author.bot)
					.filter(m => !contains || m.content.toLowerCase().includes(contains.toLowerCase()))
					.slice(0, count - deleted);
				if (wanted.length) {
					const done = await channel.bulkDelete(wanted.map(m => m.id), true);
					deleted += done.size;
				}
				if (batch.last().createdTimestamp <= limit) break;
			}
			return deleted;
		},

		async setChannelLocked(channelId, locked, reason) {
			const channel = await client.channels.fetch(channelId);
			await channel.permissionOverwrites.edit(channel.guild.id, { SendMessages: locked ? false : null, SendMessagesInThreads: locked ? false : null, AddReactions: locked ? false : null }, { reason });
		},

		// Locks every text channel where @everyone can currently write, returns their ids
		async lockGuild(guildId, reason) {
			const guild = guildOf(guildId);
			const everyone = guild.roles.everyone;
			const locked = [];
			for (const channel of guild.channels.cache.values()) {
				if (!TEXT_TYPES.has(channel.type)) continue;
				const perms = channel.permissionsFor(everyone);
				if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages)) continue;
				await channel.permissionOverwrites.edit(everyone, { SendMessages: false, SendMessagesInThreads: false, AddReactions: false }, { reason });
				locked.push(channel.id);
			}
			return locked;
		},

		async unlockChannels(channelIds, reason) {
			for (const id of channelIds) {
				const channel = await client.channels.fetch(id).catch(() => null);
				if (channel) await channel.permissionOverwrites.edit(channel.guild.id, { SendMessages: null, SendMessagesInThreads: null, AddReactions: null }, { reason });
			}
		},

		async setSlowmode(channelId, seconds, reason) {
			const channel = await client.channels.fetch(channelId);
			await channel.setRateLimitPerUser(seconds, reason);
		},

		async voiceDisconnect(guildId, userId, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member?.voice.channelId) return 'not_in_voice';
			await member.voice.disconnect(reason);
		},

		async voiceMove(guildId, userId, channelId, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member?.voice.channelId) return 'not_in_voice';
			await member.voice.setChannel(channelId, reason);
		},

		async voiceMute(guildId, userId, muted, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member?.voice.channelId) return 'not_in_voice';
			await member.voice.setMute(muted, reason);
		},

		// Position of the highest role of a member (null if not a member)
		async getMemberTopRolePosition(guildId, userId) {
			const member = await memberOf(guildOf(guildId), userId);
			return member ? member.roles.highest.position : null;
		},

		// Restriction role: created below the bot's role if missing, denied on every category and unsynced channel
		async ensureRestrictionRole(guildId, { roleId, name, deny, resync = false }) {
			const guild = guildOf(guildId);
			let role = roleId ? guild.roles.cache.get(roleId) : null;
			const created = !role;
			if (!role) {
				role = await guild.roles.create({ name: name.slice(0, 100), permissions: [], mentionable: false, hoist: false, reason: 'Rôle de restriction du réseau' });
				const top = guild.members.me.roles.highest.position;
				await role.setPosition(Math.max(top - 1, 1)).catch(() => null);
			}
			else if (role.name !== name) {
				await role.setName(name.slice(0, 100)).catch(() => null);
			}
			if (created || resync) {
				const overwrite = Object.fromEntries(deny.map(p => [p, false]));
				for (const channel of guild.channels.cache.values()) {
					if (!('permissionOverwrites' in channel)) continue;
					if (channel.type !== ChannelType.GuildCategory && channel.permissionsLocked) continue;
					await channel.permissionOverwrites.create(role, overwrite, { reason: 'Rôle de restriction' }).catch(() => null);
				}
			}
			return role.id;
		},

		async applyRestrictionOverwrites(channelId, entries) {
			const channel = await client.channels.fetch(channelId);
			if (!('permissionOverwrites' in channel)) return;
			if (channel.type !== ChannelType.GuildCategory && channel.permissionsLocked) return;
			for (const { roleId, deny } of entries) {
				if (!channel.guild.roles.cache.has(roleId)) continue;
				await channel.permissionOverwrites.create(roleId, Object.fromEntries(deny.map(p => [p, false])), { reason: 'Rôle de restriction' });
			}
		},

		async deleteMessage(channelId, messageId) {
			const channel = await client.channels.fetch(channelId);
			await channel.messages.delete(messageId);
		},

		// Announcement: text + embed, pings of the target, optional crosspost in announcement channels
		async sendAnnouncement(channelId, payload, target) {
			const channel = await client.channels.fetch(channelId);
			const embeds = buildEmbeds(payload);
			const ping = { everyone: '@everyone', here: '@here', roles: target.roleIds.map(id => `<@&${id}>`).join(' '), none: '' }[target.ping];
			const content = [ping, payload.content].filter(Boolean).join('\n');
			const message = await channel.send({
				content: content || undefined,
				embeds,
				allowedMentions: {
					parse: target.ping === 'everyone' || target.ping === 'here' ? ['everyone'] : [],
					roles: target.ping === 'roles' ? target.roleIds : [],
				},
			});
			if (target.publish && channel.type === ChannelType.GuildAnnouncement) await message.crosspost().catch(() => null);
			return message.id;
		},

		// --- Polls ---------------------------------------------------------------------------
		async upsertPollMessage(channelId, messageId, data, { target } = {}) {
			const channel = await client.channels.fetch(channelId);
			const payload = pollPayload(data, { target });
			if (messageId) {
				const existing = await channel.messages.fetch(messageId).catch(() => null);
				if (existing) {
					await existing.edit({ ...payload, content: existing.content || null });
					return existing.id;
				}
				return messageId;
			}
			const message = await channel.send({ ...payload, content: payload.content || undefined });
			if (data.poll.settings.pin) await message.pin().catch(() => null);
			return message.id;
		},

		async upsertGiveawayMessage(channelId, messageId, data, { target } = {}) {
			const channel = await client.channels.fetch(channelId);
			const payload = giveawayPayload(data, { target });
			if (messageId) {
				const existing = await channel.messages.fetch(messageId).catch(() => null);
				if (existing) await existing.edit({ ...payload, content: existing.content || null });
				return messageId;
			}
			return (await channel.send({ ...payload, content: payload.content || undefined })).id;
		},

		async announceGiveawayWinners(channelId, messageId, data) {
			const channel = await client.channels.fetch(channelId);
			await channel.send({ ...winnersPayload(data), reply: { messageReference: messageId, failIfNotExists: false } });
		},

		// --- Suggestions and bugs ------------------------------------------------------------
		async upsertFeedbackMessage(channelId, messageId, view, { thread = false, pingRoleIds = [] } = {}) {
			const channel = await client.channels.fetch(channelId);
			const payload = feedbackPayload(view);
			if (messageId) {
				const existing = await channel.messages.fetch(messageId).catch(() => null);
				if (existing) await existing.edit(payload);
				return { messageId };
			}
			const message = await channel.send({ ...payload, content: pingRoleIds.length ? pingRoleIds.map(id => `<@&${id}>`).join(' ') : undefined, allowedMentions: { roles: pingRoleIds } });
			let threadId = null;
			if (thread && channel.type === ChannelType.GuildText) {
				threadId = (await message.startThread({ name: `#${view.item.number} ${view.item.title}`.slice(0, 100), reason: 'Discussion' }).catch(() => null))?.id ?? null;
			}
			return { messageId: message.id, threadId };
		},

		async sendFeedbackReview(channelId, view) {
			const channel = await client.channels.fetch(channelId);
			return (await channel.send(reviewPayload(view))).id;
		},

		async publishFeedbackPanel(channelId, messageId, box) {
			const channel = await client.channels.fetch(channelId);
			const payload = boxPanelPayload(box);
			if (messageId) {
				const existing = await channel.messages.fetch(messageId).catch(() => null);
				if (existing) {
					await existing.edit(payload);
					return existing.id;
				}
			}
			return (await channel.send(payload)).id;
		},

		async lockThread(threadId) {
			const thread = await client.channels.fetch(threadId).catch(() => null);
			if (thread?.isThread()) await thread.edit({ locked: true, archived: true });
		},

		async sendPollResults(channelId, messageId, data) {
			const channel = await client.channels.fetch(channelId);
			await channel.send({ ...pollResultsPayload(data), reply: { messageReference: messageId, failIfNotExists: false } });
		},

		// Edits the message if it still exists, otherwise posts it again (repost) — returns its id
		async upsertMessage(channelId, messageId, payload, { repost = true } = {}) {
			const channel = await client.channels.fetch(channelId);
			const body = { content: payload.content || null, embeds: buildEmbeds(payload), allowedMentions: { parse: [] } };
			if (messageId) {
				const existing = await channel.messages.fetch(messageId).catch(() => null);
				if (existing) {
					await existing.edit(body);
					return existing.id;
				}
				if (!repost) throw new Error('Le message a été supprimé de Discord.');
			}
			return (await channel.send({ ...body, content: payload.content || undefined })).id;
		},

		// Message edited in the panel ({ content, embed }), with files (image cards) and allowed user pings
		async sendMessage(channelId, { payload, files = [], mentionUserIds = [], mentionRoleIds = [] }) {
			const channel = await client.channels.fetch(channelId);
			const message = await channel.send({
				content: payload.content || undefined,
				embeds: buildEmbeds(payload),
				files: files.map(f => new AttachmentBuilder(f.buffer, { name: f.name })),
				allowedMentions: { users: mentionUserIds, roles: mentionRoleIds },
			});
			return message.id;
		},

		// Raid mode: pauses invites and/or sets the highest verification level; returns what to restore
		async setRaidLocks(guildId, { disableInvites, raiseVerification }) {
			const guild = guildOf(guildId);
			const previous = { verificationLevel: guild.verificationLevel, invitesDisabled: guild.features.includes('INVITES_DISABLED') };
			if (raiseVerification && guild.verificationLevel !== GuildVerificationLevel.VeryHigh) {
				await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Anti-raid');
			}
			if (disableInvites && !previous.invitesDisabled) await guild.disableInvites(true);
			return previous;
		},

		async restoreRaidLocks(guildId, previous) {
			const guild = guildOf(guildId);
			if (guild.verificationLevel !== previous.verificationLevel) await guild.setVerificationLevel(previous.verificationLevel, 'Fin du raid');
			if (!previous.invitesDisabled && guild.features.includes('INVITES_DISABLED')) await guild.disableInvites(false);
		},

		async sendDMPayload(userId, payload) {
			const user = await client.users.fetch(userId);
			await user.send({ content: payload.content || undefined, embeds: buildEmbeds(payload), allowedMentions: { parse: [] } });
		},

		async getGuildInfo(guildId) {
			const guild = guildOf(guildId);
			return {
				id: guild.id,
				name: guild.name,
				iconUrl: guild.iconURL({ extension: 'png', size: 256 }),
				memberCount: guild.memberCount,
				boosts: guild.premiumSubscriptionCount ?? 0,
				tier: guild.premiumTier,
			};
		},

		// Live numbers of a server for the counter channels (bots and humans from the member cache)
		async getGuildCounts(guildId) {
			const guild = guildOf(guildId);
			const bots = guild.members.cache.filter(m => m.user.bot).size;
			const voice = guild.voiceStates.cache.filter(s => s.channelId && !s.member?.user?.bot).size;
			return { members: guild.memberCount, humans: Math.max(guild.memberCount - bots, 0), bots, voice, boosts: guild.premiumSubscriptionCount ?? 0 };
		},

		// Voice channel nobody can join, only there to show a number in its name
		async createCounterChannel(guildId, { name, categoryId }) {
			const guild = guildOf(guildId);
			const parent = categoryId ? guild.channels.cache.get(categoryId) : null;
			const channel = await guild.channels.create({
				name: name.slice(0, 100),
				type: ChannelType.GuildVoice,
				parent: parent?.type === ChannelType.GuildCategory ? parent.id : null,
				position: 0,
				permissionOverwrites: [
					{ id: guild.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
					{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
				],
				reason: 'Salon compteur',
			});
			return channel.id;
		},

		async renameChannel(channelId, name) {
			const channel = await client.channels.fetch(channelId);
			if (channel.name !== name) await channel.setName(name.slice(0, 100));
		},

		async listVoiceChannels(guildId) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) return [];
			return [...guild.channels.cache.values()]
				.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
				.sort((a, b) => a.rawPosition - b.rawPosition)
				.map(c => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null }));
		},

		// --- Personal voice channels ---------------------------------------------------------
		async createHubChannel(guildId, { name, categoryId }) {
			const guild = guildOf(guildId);
			const parent = categoryId ? guild.channels.cache.get(categoryId) : null;
			const channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: parent?.type === ChannelType.GuildCategory ? parent.id : null, reason: 'Salon « créer un vocal »' });
			return channel.id;
		},

		async parentOf(channelId) {
			const channel = await client.channels.fetch(channelId).catch(() => null);
			return channel?.parentId ?? null;
		},

		async createVoiceRoom(guildId, { parentId, ownerId, name, userLimit, bitrate, region, ...state }) {
			const guild = guildOf(guildId);
			const channel = await guild.channels.create({
				name: name.slice(0, 100),
				type: ChannelType.GuildVoice,
				parent: parentId && guild.channels.cache.get(parentId)?.type === ChannelType.GuildCategory ? parentId : null,
				userLimit,
				bitrate: bitrate ? Math.min(bitrate * 1000, guild.maximumBitrate) : undefined,
				rtcRegion: region ?? null,
				permissionOverwrites: roomOverwrites(guild, { ownerId, ...state }),
				reason: 'Vocal personnel',
			});
			return channel.id;
		},

		async applyVoiceRoom(channelId, { ownerId, name, userLimit, bitrate, region, ...state }) {
			const channel = await client.channels.fetch(channelId);
			const edit = {
				userLimit,
				rtcRegion: region ?? null,
				permissionOverwrites: roomOverwrites(channel.guild, { ownerId, ...state }),
			};
			if (name && name !== channel.name) edit.name = name.slice(0, 100);
			if (bitrate) edit.bitrate = Math.min(bitrate * 1000, channel.guild.maximumBitrate);
			await channel.edit(edit);
		},

		// Humans in a voice channel (null if the channel no longer exists)
		async voiceChannelMembers(channelId) {
			const channel = await client.channels.fetch(channelId).catch(() => null);
			if (!channel) return null;
			return [...channel.members.values()].filter(m => !m.user.bot).map(m => m.id);
		},

		async sendRoomPanel(channelId, data) {
			const channel = await client.channels.fetch(channelId);
			await channel.send(roomPanel(channelId, data));
		},

		// Rules message with its "I accept" button (updated in place if it still exists)
		async publishRules(channelId, messageId, { payload, button }) {
			const channel = await client.channels.fetch(channelId);
			const components = [];
			if (button) {
				const accept = new ButtonBuilder().setCustomId('rules:accept').setLabel(button.label).setStyle({ primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger }[button.style]);
				const emoji = emojiOf(button.emoji);
				if (emoji) accept.setEmoji(emoji);
				components.push(new ActionRowBuilder().addComponents(accept));
			}
			const message = { content: payload.content || undefined, embeds: buildEmbeds(payload), components, allowedMentions: { parse: [] } };
			if (messageId) {
				const existing = await channel.messages.fetch(messageId).catch(() => null);
				if (existing) {
					await existing.edit({ ...message, content: payload.content || null });
					return existing.id;
				}
			}
			return (await channel.send(message)).id;
		},

		// Server an invite leads to (null if invalid or expired)
		async resolveInvite(code) {
			const invite = await client.fetchInvite(code).catch(() => null);
			return invite?.guild?.id ?? null;
		},

		async sendDM(userId, content, files) {
			const user = await client.users.fetch(userId);
			await user.send({ content, files: toFiles(files), allowedMentions: { parse: [] } });
		},

		// --- Role permissions (names of PermissionFlagsBits) --------------------------------
		async getRolePermissions(guildId, roleId) {
			const role = guildOf(guildId).roles.cache.get(roleId);
			if (!role) return null;
			return { name: role.name, permissions: role.permissions.toArray(), editable: role.editable };
		},

		async setRolePermissions(guildId, roleId, names, reason) {
			const role = guildOf(guildId).roles.cache.get(roleId);
			if (!role) throw new Error('Rôle introuvable');
			const flags = names.filter(name => name in PermissionFlagsBits).map(name => PermissionFlagsBits[name]);
			await role.setPermissions(flags, reason);
		},

		// --- Tickets -----------------------------------------------------------------------
		async listCategoryChannels(guildId) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) return [];
			return [...guild.channels.cache.values()]
				.filter(c => c.type === ChannelType.GuildCategory)
				.sort((a, b) => a.rawPosition - b.rawPosition)
				.map(c => ({ id: c.id, name: c.name }));
		},

		// panel: { id, payload, style, placeholder, categories }
		async publishTicketPanel(channelId, messageId, panel) {
			const channel = await client.channels.fetch(channelId);
			const payload = panelPayload(panel);
			if (messageId) {
				const existing = await channel.messages.fetch(messageId).catch(() => null);
				if (existing) {
					await existing.edit(payload);
					return existing.id;
				}
			}
			return (await channel.send(payload)).id;
		},

		async createTicketChannel({ guildId, parentId, name, openerId, staffRoleIds }) {
			const guild = guildOf(guildId);
			const parent = parentId ? guild.channels.cache.get(parentId) : null;
			const channel = await guild.channels.create({
				name: name.slice(0, 100),
				type: ChannelType.GuildText,
				parent: parent?.type === ChannelType.GuildCategory ? parent.id : null,
				permissionOverwrites: [
					{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
					{ id: openerId, allow: TICKET_MEMBER },
					{ id: client.user.id, allow: [...TICKET_MEMBER, PermissionFlagsBits.ManageChannels] },
					...staffRoleIds.filter(id => guild.roles.cache.has(id)).map(id => ({ id, allow: TICKET_MEMBER })),
				],
				reason: 'Ouverture d’un ticket',
			});
			return channel.id;
		},

		async sendTicketWelcome(channelId, data) {
			const channel = await client.channels.fetch(channelId);
			await channel.send(welcomePayload(data));
		},

		async updateTicketChannel(channelId, { name, parentId }) {
			const channel = await client.channels.fetch(channelId).catch(() => null);
			if (!channel) return;
			const parent = parentId ? channel.guild.channels.cache.get(parentId) : null;
			const edit = {};
			if (name && name !== channel.name) edit.name = name.slice(0, 100);
			if (parent?.type === ChannelType.GuildCategory && channel.parentId !== parent.id) {
				edit.parent = parent.id;
				// Keep the ticket's own permissions, not the ones of the new category
				edit.lockPermissions = false;
			}
			if (Object.keys(edit).length) await channel.edit(edit);
		},

		// Claimed with "only the claimer writes": staff roles read only, the claimer writes
		async setTicketWriters(channelId, { claimerId, previousClaimerId, staffRoleIds }) {
			const channel = await client.channels.fetch(channelId);
			for (const roleId of staffRoleIds) {
				if (channel.guild.roles.cache.has(roleId)) await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: false });
			}
			if (previousClaimerId && previousClaimerId !== claimerId) await channel.permissionOverwrites.delete(previousClaimerId).catch(() => null);
			await channel.permissionOverwrites.edit(claimerId, Object.fromEntries(TICKET_MEMBER.map(flag => [new PermissionsBitField(flag).toArray()[0], true])));
		},

		// Answer written in the panel: a webhook of the channel shows the panel user's name and avatar
		async sendTicketReply(channelId, { content, username, avatarUrl }) {
			const channel = await client.channels.fetch(channelId);
			let webhook = ticketWebhooks.get(channelId);
			if (!webhook) {
				const existing = await channel.fetchWebhooks().catch(() => null);
				webhook = existing?.find(w => w.owner?.id === client.user.id && w.name === 'Panel tickets')
					?? await channel.createWebhook({ name: 'Panel tickets', reason: 'Réponses aux tickets depuis le panel' });
				ticketWebhooks.set(channelId, webhook);
			}
			const message = await webhook.send({ content, username: username.slice(0, 80), avatarURL: avatarUrl ?? undefined, allowedMentions: { parse: ['users'] } });
			return message.id;
		},

		async removeChannelMember(channelId, userId) {
			const channel = await client.channels.fetch(channelId);
			await channel.permissionOverwrites.delete(userId);
		},

		async sendTicketNotice(channelId, data) {
			const channel = await client.channels.fetch(channelId);
			await channel.send(noticePayload(data));
		},

		async sendTicketRating(userId, ticket) {
			const user = await client.users.fetch(userId);
			await user.send(ratingPayload(ticket));
		},

		async addChannelMember(channelId, userId) {
			const channel = await client.channels.fetch(channelId);
			await channel.permissionOverwrites.edit(userId, Object.fromEntries(TICKET_MEMBER.map(flag => [new PermissionsBitField(flag).toArray()[0], true])));
		},

		// Whole conversation, oldest first (up to 2000 messages)
		async fetchTranscript(channelId) {
			const channel = await client.channels.fetch(channelId);
			const messages = [];
			let before;
			while (messages.length < 2000) {
				const batch = await channel.messages.fetch({ limit: 100, before });
				if (!batch.size) break;
				messages.push(...batch.values());
				before = batch.last().id;
			}
			return messages.reverse().map((m) => {
				const time = new Date(m.createdTimestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
				const files = m.attachments.map(a => a.url);
				const embeds = m.embeds.map(e => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean);
				return `[${time}] ${m.author.username}: ${[m.content, ...embeds.map(e => `[embed] ${e}`), ...files].filter(Boolean).join(' ')}`;
			}).join('\n');
		},

		async deleteChannel(channelId, reason) {
			const channel = await client.channels.fetch(channelId).catch(() => null);
			if (channel) await channel.delete(reason);
		},

		async sendLog(channelId, message) {
			const channel = await client.channels.fetch(channelId);
			if (!channel?.isTextBased()) {
				const error = new Error('Not a text channel');
				error.code = RESTJSONErrorCodes.UnknownChannel;
				throw error;
			}
			await channel.send({ embeds: [toEmbed(message)], files: toFiles(message.files), allowedMentions: { parse: [] } });
		},

		async getTextChannel(guildId, channelId) {
			const channel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
			if (!channel || !TEXT_TYPES.has(channel.type) || !canSend(channel)) return null;
			return { id: channel.id, name: channel.name };
		},

		async listTextChannels(guildId) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) return [];
			return [...guild.channels.cache.values()]
				.filter(c => TEXT_TYPES.has(c.type))
				.sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) || a.rawPosition - b.rawPosition)
				.map(c => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null, canSend: canSend(c), announcement: c.type === ChannelType.GuildAnnouncement }));
		},

		async listRoles(guildId) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) return [];
			return [...guild.roles.cache.values()]
				.filter(r => r.id !== guild.id && !r.managed)
				.sort((a, b) => b.position - a.position)
				.map(r => ({
					id: r.id,
					name: r.name,
					color: r.hexColor,
					position: r.position,
					// The bot can only give roles below its own highest role
					editable: r.editable,
					dangerous: r.permissions.any(DANGEROUS_PERMISSIONS),
					permissions: r.permissions.bitfield.toString(),
				}));
		},

		// Discord's member search: beginning of username or nickname
		async searchMembers(guildId, query, limit = 10) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) return [];
			const members = await guild.members.search({ query, limit });
			return [...members.values()].map(m => ({
				id: m.id,
				username: m.user.username,
				globalName: m.user.globalName,
				nickname: m.nickname,
				avatar: m.displayAvatarURL({ size: 64 }),
			}));
		},

		async getMemberInfo(guildId, userId) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member) return null;
			return {
				nickname: member.nickname,
				joinedAt: member.joinedTimestamp,
				timeoutUntil: member.communicationDisabledUntilTimestamp ?? null,
				roles: [...member.roles.cache.values()]
					.filter(r => r.id !== guildId)
					.sort((a, b) => b.position - a.position)
					.map(r => ({ id: r.id, name: r.name, color: r.hexColor, editable: r.editable && !r.managed })),
			};
		},

		async addRole(guildId, userId, roleId, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member) return 'not_member';
			await member.roles.add(roleId, reason);
		},

		async removeRole(guildId, userId, roleId, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member) return 'not_member';
			await member.roles.remove(roleId, reason);
		},

		async setNickname(guildId, userId, nickname, reason) {
			const member = await memberOf(guildOf(guildId), userId);
			if (!member) return 'not_member';
			await member.setNickname(nickname, reason);
		},

		// null when the user is not a member of that server
		async getMemberRoleIds(guildId, userId) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) return null;
			try {
				const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
				return [...member.roles.cache.keys()];
			}
			catch (error) {
				if (error.code === RESTJSONErrorCodes.UnknownMember || error.code === RESTJSONErrorCodes.UnknownUser) return null;
				throw error;
			}
		},

		// Members of a server holding at least one of these roles (from the member cache)
		async listMembersWithAnyRole(guildId, roleIds) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild || !roleIds.length) return [];
			const wanted = new Set(roleIds);
			return [...guild.members.cache.values()]
				.filter(m => m.roles.cache.some(r => wanted.has(r.id)))
				.map(m => ({
					id: m.id,
					username: m.user.username,
					globalName: m.user.globalName,
					avatar: m.displayAvatarURL({ size: 64 }),
					roleIds: [...m.roles.cache.keys()].filter(id => wanted.has(id)),
				}));
		},

		async getUser(userId) {
			try {
				const user = await client.users.fetch(userId);
				return { id: user.id, username: user.username, globalName: user.globalName, avatar: user.displayAvatarURL({ size: 64 }) };
			}
			catch {
				return null;
			}
		},

		guildIcon(guildId) {
			return client.guilds.cache.get(guildId)?.iconURL({ size: 64 }) ?? null;
		},

		status() {
			return {
				ready: client.isReady(),
				ping: client.ws.ping,
				guilds: client.guilds.cache.size,
				uptime: client.uptime,
				user: client.user ? { id: client.user.id, username: client.user.username, avatar: client.user.displayAvatarURL({ size: 64 }) } : null,
			};
		},
	};
}
