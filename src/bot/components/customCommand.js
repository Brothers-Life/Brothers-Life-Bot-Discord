import { MessageFlags } from 'discord.js';
import { runCustomInteraction } from '../customCommands.js';

// customId: cc:<commandId>:<componentId> (buttons and menus published by a custom command)
export const prefix = 'cc';

export async function execute(interaction) {
	const [, commandId, componentId] = interaction.customId.split(':');
	const command = interaction.client.core.customCommands.list().find(c => c.id === Number(commandId));
	if (!command?.components.some(c => c.id === componentId)) {
		await interaction.reply({ content: 'Ce bouton ne fonctionne plus : la commande a été modifiée ou supprimée.', flags: MessageFlags.Ephemeral });
		return;
	}
	await runCustomInteraction(interaction, command, { componentId });
}
