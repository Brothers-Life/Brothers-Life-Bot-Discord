import { Events, MessageFlags, Collection } from 'discord.js';
import logger from '../../utils/logger.js';
import { t } from '../../utils/i18n.js';
import { runCustomInteraction } from '../customCommands.js';
import { AppError } from '../../core/errors.js';
import { errorContent } from '../userError.js';

const DEFAULT_COOLDOWN_SECONDS = 0;
// Bot messages are in French for everyone, whatever the Discord language of the member
const LOCALE = 'fr';

export const name = Events.InteractionCreate;
export async function execute(interaction) {
	if (interaction.isButton() || interaction.isModalSubmit() || interaction.isAnySelectMenu()) {
		return handleComponent(interaction);
	}
	if (interaction.isAutocomplete()) {
		const command = interaction.client.commands.get(interaction.commandName);
		return command?.autocomplete?.(interaction).catch(error => logger.error(`Autocomplete of /${interaction.commandName} failed:`, error));
	}
	// Custom commands built in the panel: right click (member / message), or a slash name the bot does not have
	if (interaction.isContextMenuCommand() || (interaction.isChatInputCommand() && !interaction.client.commands.has(interaction.commandName))) {
		const type = interaction.isUserContextMenuCommand() ? 'user' : interaction.isMessageContextMenuCommand() ? 'message' : 'slash';
		const custom = interaction.guildId ? interaction.client.core.customCommands.find(interaction.guildId, interaction.commandName, type) : null;
		if (!custom) {
			logger.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}
		return runCustomInteraction(interaction, custom).catch(async (error) => {
			logger.error(`Custom command ${interaction.commandName} failed:`, error);
			await safeReply(interaction, t('errors.command_execution', LOCALE));
		});
	}
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	// No cooldown by default: only the commands that export one (cheap spam targets like /ping)
	const cooldownAmount = (command.cooldown ?? DEFAULT_COOLDOWN_SECONDS) * 1_000;
	if (cooldownAmount > 0) {
		const { cooldowns } = interaction.client;
		const sub = interaction.options.getSubcommand(false);
		const key = sub ? `${command.data.name} ${sub}` : command.data.name;
		if (!cooldowns.has(key)) cooldowns.set(key, new Collection());
		const timestamps = cooldowns.get(key);
		const now = Date.now();
		const expirationTime = (timestamps.get(interaction.user.id) ?? 0) + cooldownAmount;
		if (now < expirationTime) {
			return safeReply(interaction, t('errors.cooldown', LOCALE, { timestamp: `<t:${Math.ceil(expirationTime / 1_000)}:R>` }));
		}
		timestamps.set(interaction.user.id, now);
		setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
	}

	try {
		await command.execute(interaction);
	}
	catch (error) {
		if (!(error instanceof AppError)) {
			const where = interaction.guildId ? `guild ${interaction.guildId}` : 'DM';
			logger.error(`Error while executing /${command.data.name} (${where}, user ${interaction.user.id}):`, error);
		}
		await safeReply(interaction, errorContent(error));
	}
}

async function handleComponent(interaction) {
	const handler = interaction.client.components.get(interaction.customId.split(':')[0]);
	if (!handler) return;
	try {
		await handler.execute(interaction);
	}
	catch (error) {
		if (!(error instanceof AppError)) logger.error(`Error while handling ${interaction.customId}:`, error);
		await safeReply(interaction, errorContent(error));
	}
}

// Replying can itself fail (expired interaction, missing permissions...): never let it crash the handler
async function safeReply(interaction, content) {
	try {
		const payload = { content, flags: MessageFlags.Ephemeral };
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp(payload);
		}
		else {
			await interaction.reply(payload);
		}
	}
	catch (error) {
		logger.error('Unable to send the reply to the interaction:', error);
	}
}
