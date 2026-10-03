import { createHash } from 'node:crypto';
import { ActionRowBuilder, ApplicationCommandOptionType, ApplicationCommandType, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { emojiOf } from './messages.js';
import logger from '../utils/logger.js';

const OPTION_TYPES = {
	string: ApplicationCommandOptionType.String, integer: ApplicationCommandOptionType.Integer, number: ApplicationCommandOptionType.Number,
	boolean: ApplicationCommandOptionType.Boolean, user: ApplicationCommandOptionType.User, role: ApplicationCommandOptionType.Role, channel: ApplicationCommandOptionType.Channel,
};
const BUTTON_STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

// Custom command -> Discord application command (slash, or right click on a member / a message)
export function toApplicationCommand(c) {
	if (c.trigger.type === 'user') return { type: ApplicationCommandType.User, name: c.name };
	if (c.trigger.type === 'message') return { type: ApplicationCommandType.Message, name: c.name };
	return {
		type: ApplicationCommandType.ChatInput,
		name: c.name,
		description: c.description,
		dm_permission: false,
		options: c.options.map((o) => {
			const out = { type: OPTION_TYPES[o.type], name: o.name, description: o.description, required: o.required };
			if (o.choices?.length) out.choices = o.choices.map(ch => ({ name: ch.name, value: o.type === 'string' ? ch.value : Number(ch.value) }));
			if (o.min !== undefined) out.min_value = o.min;
			if (o.max !== undefined) out.max_value = o.max;
			if (o.maxLength) out.max_length = o.maxLength;
			return out;
		}),
	};
}

// Message of a block: text, embed, buttons / menus of the command (customId cc:<commandId>:<componentId>)
export function customPayload(msg, components = [], commandId = null) {
	const embeds = [];
	if (msg.embed) {
		const e = new EmbedBuilder().setColor(Number.parseInt(msg.embed.color.slice(1), 16));
		if (msg.embed.title) e.setTitle(msg.embed.title.slice(0, 256));
		if (msg.embed.description) e.setDescription(msg.embed.description.slice(0, 4096));
		if (msg.embed.imageUrl) e.setImage(msg.embed.imageUrl);
		if (msg.embed.footer) e.setFooter({ text: msg.embed.footer.slice(0, 2048) });
		embeds.push(e);
	}
	const rows = [];
	const buttons = components.filter(c => c.kind === 'button').map((c) => {
		const b = new ButtonBuilder().setCustomId(`cc:${commandId}:${c.id}`).setLabel(c.label).setStyle(BUTTON_STYLES[c.style]);
		if (emojiOf(c.emoji)) b.setEmoji(emojiOf(c.emoji));
		return b;
	});
	if (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
	for (const c of components.filter(x => x.kind === 'select').slice(0, 4 - (buttons.length ? 1 : 0))) {
		rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
			.setCustomId(`cc:${commandId}:${c.id}`)
			.setPlaceholder(c.placeholder || 'Choisis…')
			.addOptions(c.options.map(o => ({ label: o.label, value: o.value, ...(o.description ? { description: o.description } : {}) })))));
	}
	return { content: msg.content?.slice(0, 2000) || undefined, embeds, components: rows, allowedMentions: { parse: ['users'] } };
}

function member(interactionOrMessage) {
	const m = interactionOrMessage.member;
	const u = interactionOrMessage.user ?? interactionOrMessage.author;
	return {
		id: u.id,
		name: m?.displayName ?? u.globalName ?? u.username,
		roleIds: m?.roles?.cache ? [...m.roles.cache.keys()] : (Array.isArray(m?.roles) ? m.roles : []),
		permissions: m?.permissions?.toArray ? m.permissions.toArray() : [],
		createdAt: u.createdTimestamp ?? null,
		joinedAt: m?.joinedTimestamp ?? null,
	};
}

function optionsOf(interaction, c) {
	const out = {};
	if (interaction.isUserContextMenuCommand?.()) {
		const u = interaction.targetUser;
		out.cible = { type: 'user', value: u.id, userId: u.id, display: `<@${u.id}>` };
	}
	else if (interaction.isMessageContextMenuCommand?.()) {
		const msg = interaction.targetMessage;
		out.auteur = { type: 'user', value: msg.author.id, userId: msg.author.id, display: `<@${msg.author.id}>` };
		out.contenu = { type: 'string', value: msg.content ?? '', display: (msg.content ?? '').slice(0, 1000) };
	}
	else if (interaction.isChatInputCommand?.()) {
		for (const o of c.options) {
			const raw = interaction.options.get(o.name);
			if (!raw) continue;
			if (o.type === 'user') out[o.name] = { type: 'user', value: raw.user.id, userId: raw.user.id, display: `<@${raw.user.id}>` };
			else if (o.type === 'role') out[o.name] = { type: 'role', value: raw.role.id, display: `<@&${raw.role.id}>` };
			else if (o.type === 'channel') out[o.name] = { type: 'channel', value: raw.channel.id, display: `<#${raw.channel.id}>` };
			else if (o.type === 'boolean') out[o.name] = { type: 'boolean', value: raw.value ? 'oui' : 'non', display: raw.value ? 'oui' : 'non' };
			else out[o.name] = { type: o.type, value: raw.value, display: String(raw.value) };
		}
	}
	else if (interaction.isStringSelectMenu?.()) {
		out.choix = { type: 'string', value: interaction.values.join(','), display: interaction.values.join(', ') };
	}
	return out;
}

// Does the flow start with a hidden reply? (decides how a slow command is acknowledged)
function firstReplyEphemeral(blocks) {
	for (const b of blocks ?? []) {
		if (b.type === 'reply') return b.ephemeral;
		if (b.type === 'if') {
			const inner = firstReplyEphemeral(b.then) ?? firstReplyEphemeral(b.else);
			if (inner !== undefined) return inner;
		}
	}
	return undefined;
}

function hasSlowBlocks(blocks) {
	let slow = false;
	const walk = list => (list ?? []).forEach((b) => {
		if (['wait', 'role', 'sanction', 'nickname', 'dm', 'send'].includes(b.type)) slow = true;
		if (b.type === 'if') {
			walk(b.then);
			walk(b.else);
		}
	});
	walk(blocks);
	return slow;
}

// Slash, right click, button or menu of a custom command
export async function runCustomInteraction(interaction, command, { componentId = null } = {}) {
	const { core } = interaction.client;
	const flow = componentId ? command.components.find(x => x.id === componentId)?.flow : command.flow;
	const ephemeralFirst = firstReplyEphemeral(flow) ?? true;
	let answered = false;
	if (hasSlowBlocks(flow)) {
		await interaction.deferReply(ephemeralFirst ? { flags: MessageFlags.Ephemeral } : {});
		answered = 'deferred';
	}
	const respond = {
		async reply(msg, { ephemeral, components, commandId }) {
			const payload = customPayload(msg, components, commandId);
			if (answered === 'deferred') {
				answered = 'replied';
				await interaction.editReply(payload);
			}
			else if (answered === 'replied') {await interaction.followUp({ ...payload, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });}
			else {
				answered = 'replied';
				await interaction.reply({ ...payload, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
			}
		},
		async send(channelId, msg, { components, commandId }) {
			const channel = await interaction.client.channels.fetch(channelId);
			await channel.send(customPayload(msg, components, commandId));
		},
		async dm(userId, msg) {
			const user = await interaction.client.users.fetch(userId);
			await user.send(customPayload(msg));
		},
		async react(emoji) {
			const target = interaction.isMessageContextMenuCommand?.() ? interaction.targetMessage : answered === 'replied' ? await interaction.fetchReply() : null;
			if (target) await target.react(emoji);
		},
		async deleteTrigger() {
			if (interaction.isMessageContextMenuCommand?.()) await interaction.targetMessage.delete();
		},
	};
	const result = await core.customCommands.execute({
		commandId: command.id, componentId,
		trigger: componentId ? 'component' : command.trigger.type,
		guildId: interaction.guildId, channelId: interaction.channelId,
		user: member(interaction), options: optionsOf(interaction, command), respond,
	});
	if (result.denied) {
		const content = `⛔ ${result.reason}`;
		if (answered === 'deferred') await interaction.editReply({ content });
		else if (!answered) await interaction.reply({ content, flags: MessageFlags.Ephemeral });
		return;
	}
	// Discord needs an answer: a discreet one when the flow did not reply
	if (answered === 'deferred') await interaction.editReply({ content: result.warnings.length ? '⚠️ Terminé, avec des erreurs (voir l’historique dans le panel).' : '✅ Fait.' }).catch(() => null);
	else if (!answered) await interaction.reply({ content: '✅ Fait.', flags: MessageFlags.Ephemeral }).catch(() => null);
}

// Message that matches a keyword command
export async function runKeywordCommands(message) {
	const { core } = message.client;
	if (!message.guild || message.author.bot || !message.content) return;
	for (const command of core.customCommands.matchKeywords(message.guild.id, message.channelId, message.content)) {
		const respond = {
			async reply(msg, { components, commandId }) {
				await message.reply(customPayload(msg, components, commandId));
			},
			async send(channelId, msg, { components, commandId }) {
				const channel = await message.client.channels.fetch(channelId);
				await channel.send(customPayload(msg, components, commandId));
			},
			async dm(userId, msg) {
				const user = await message.client.users.fetch(userId);
				await user.send(customPayload(msg));
			},
			react: emoji => message.react(emoji),
			deleteTrigger: () => message.delete(),
		};
		await core.customCommands.execute({
			commandId: command.id, trigger: 'keyword', guildId: message.guild.id, channelId: message.channelId,
			user: member(message), options: { message: { type: 'string', value: message.content, display: message.content.slice(0, 1000) } }, respond,
		}).catch(error => logger.warn(`Keyword command ${command.name} failed:`, error.message));
	}
}

// Server commands: the custom ones (and, on the dev server, the bot's own commands too)
export async function syncCustomCommands(client) {
	const { core } = client;
	const { config, settings } = core;
	const devGuild = config.ENV !== 'prod' && config.DEV_GUILD_ID ? config.DEV_GUILD_ID : null;
	for (const guild of core.network.list().filter(g => g.status === 'active' && g.botPresent)) {
		const custom = core.customCommands.guildCommands(guild.id).map(toApplicationCommand);
		const list = guild.id === devGuild ? [...client.commands.values()].map(c => c.data.toJSON()).concat(custom) : custom;
		const hash = createHash('sha256').update(JSON.stringify(list)).digest('hex');
		const key = `commands.custom.${guild.id}`;
		if (settings.get(key) === hash) continue;
		try {
			await client.application.commands.set(list, guild.id);
			settings.set(key, hash);
		}
		catch (error) {
			logger.warn(`Custom commands not registered on ${guild.name}:`, error.message);
		}
	}
}
