import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AppError } from '../../../core/errors.js';
import { actorOf } from '../../moderation.js';
import { errorContent } from '../../userError.js';

// Staff only: hidden for members without "Moderate Members" (server admins can change it in Integrations)
export const data = new SlashCommandBuilder()
	.setName('maintenance')
	.setDescription('Lancer ou terminer la maintenance du serveur FiveM (annonce sur Discord)')
	.setContexts(InteractionContextType.Guild)
	.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
	.addSubcommand(s => s.setName('lancer').setDescription('Lancer la maintenance du serveur FiveM')
		.addStringOption(o => o.setName('raison').setDescription('Raison affichée dans l’annonce').setMaxLength(300)))
	.addSubcommand(s => s.setName('terminer').setDescription('Terminer la maintenance du serveur FiveM')
		.addStringOption(o => o.setName('raison').setDescription('Message affiché dans l’annonce').setMaxLength(300)));

export async function execute(interaction) {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		const active = interaction.options.getSubcommand() === 'lancer';
		const result = await interaction.client.core.fivemEvents.setMaintenance(actor, { active, reason: interaction.options.getString('raison') });
		const announced = result.targets ? ` Annonce publiée dans ${result.announced}/${result.targets} salon${result.targets > 1 ? 's' : ''}.` : ' Aucun salon d’annonce n’est réglé (panel → Annonces FiveM).';
		await interaction.editReply(`${active ? '🛠️ Maintenance lancée.' : '✅ Maintenance terminée.'}${announced}`);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(errorContent(error));
	}
}
