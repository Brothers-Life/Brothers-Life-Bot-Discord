import { ChannelType, EmbedBuilder, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';

const COLORS = {
	info: 0x5865f2,
	success: 0x57f287,
	warning: 0xfee75c,
	danger: 0xed4245,
};

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
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

function canSend(channel) {
	const me = channel.guild.members.me;
	return Boolean(me && channel.permissionsFor(me)?.has(LOG_PERMISSIONS));
}

function notInGuild(guildId) {
	const error = new Error(`The bot is not on server ${guildId}`);
	error.code = 'NO_GUILD';
	return error;
}

// The only piece of code that talks to Discord on behalf of src/core
export function createExecutor(client) {
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

		async deleteMessage(channelId, messageId) {
			const channel = await client.channels.fetch(channelId);
			await channel.messages.delete(messageId);
		},

		async sendDM(userId, content) {
			const user = await client.users.fetch(userId);
			await user.send({ content, allowedMentions: { parse: [] } });
		},

		async sendLog(channelId, message) {
			const channel = await client.channels.fetch(channelId);
			if (!channel?.isTextBased()) {
				const error = new Error('Not a text channel');
				error.code = RESTJSONErrorCodes.UnknownChannel;
				throw error;
			}
			await channel.send({ embeds: [toEmbed(message)], allowedMentions: { parse: [] } });
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
				.map(c => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null, canSend: canSend(c) }));
		},

		async listRoles(guildId) {
			const guild = client.guilds.cache.get(guildId);
			if (!guild) return [];
			return [...guild.roles.cache.values()]
				.filter(r => r.id !== guild.id && !r.managed)
				.sort((a, b) => b.position - a.position)
				.map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }));
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
