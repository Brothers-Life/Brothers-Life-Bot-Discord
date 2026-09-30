import { Events, MessageFlags, Collection } from 'discord.js';
import logger from '../../utils/logger.js';
import { t } from '../../utils/i18n.js';

const DEFAULT_COOLDOWN_SECONDS = 3;

export const name = Events.InteractionCreate;
export async function execute(interaction) {
	if (interaction.isButton() || interaction.isModalSubmit() || interaction.isAnySelectMenu()) {
		return handleComponent(interaction);
	}
	if (interaction.isAutocomplete()) {
		const command = interaction.client.commands.get(interaction.commandName);
		return command?.autocomplete?.(interaction).catch(error => logger.error(`Autocomplete of /${interaction.commandName} failed:`, error));
	}
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		logger.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	const { cooldowns } = interaction.client;

	if (!cooldowns.has(command.data.name)) {
		cooldowns.set(command.data.name, new Collection());
	}

	const now = Date.now();
	const timestamps = cooldowns.get(command.data.name);
	const cooldownAmount = (command.cooldown ?? DEFAULT_COOLDOWN_SECONDS) * 1_000;

	if (timestamps.has(interaction.user.id)) {
		const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

		if (now < expirationTime) {
			const expiredTimestamp = Math.round(expirationTime / 1_000);
			return safeReply(interaction, t('errors.cooldown', interaction.locale, {
				command: command.data.name,
				timestamp: `<t:${expiredTimestamp}:R>`,
			}));
		}
	}

	timestamps.set(interaction.user.id, now);
	setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

	try {
		await command.execute(interaction);
	}
	catch (error) {
		const where = interaction.guildId ? `guild ${interaction.guildId}` : 'DM';
		logger.error(`Error while executing /${command.data.name} (${where}, user ${interaction.user.id}):`, error);
		await safeReply(interaction, t('errors.command_execution', interaction.locale));
	}
}

async function handleComponent(interaction) {
	const handler = interaction.client.components.get(interaction.customId.split(':')[0]);
	if (!handler) return;
	try {
		await handler.execute(interaction);
	}
	catch (error) {
		logger.error(`Error while handling ${interaction.customId}:`, error);
		await safeReply(interaction, t('errors.command_execution', interaction.locale));
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
