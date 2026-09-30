import { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } from 'discord.js';
import { runModeration } from '../../moderation.js';

export const data = new SlashCommandBuilder()
	.setName('dm')
	.setDescription('Messages privés du bot')
	.setContexts(InteractionContextType.Guild)
	.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
	.addSubcommand(s => s.setName('bloquer').setDescription('Ignorer les MP d’un membre')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(300)))
	.addSubcommand(s => s.setName('debloquer').setDescription('Accepter de nouveau les MP d’un membre')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { dms } = interaction.client.core;
		const user = interaction.options.getUser('membre');
		if (interaction.options.getSubcommand() === 'bloquer') {
			dms.block(actor, user.id, interaction.options.getString('raison') ?? '');
			return { content: `🚫 ${user} est bloqué : ses MP au bot sont ignorés.` };
		}
		dms.unblock(actor, user.id);
		return { content: `✅ ${user} est débloqué.` };
	});
}
