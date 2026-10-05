import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('lockdown', 'Verrouiller ou déverrouiller tous les salons écrits du serveur')
	.addSubcommand(s => s.setName('activer').setDescription('Verrouiller tous les salons écrits du serveur')
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(300)))
	.addSubcommand(s => s.setName('desactiver').setDescription('Rouvrir les salons verrouillés par /lockdown activer'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const on = interaction.options.getSubcommand() === 'activer';
		const count = await interaction.client.core.moderation.lockdown(actor, interaction.guildId, on, interaction.options.getString('raison') ?? '');
		return { content: on ? `🔒 Lockdown : ${count} salon(s) verrouillé(s).` : `🔓 Fin du lockdown : ${count} salon(s) rouvert(s).` };
	});
}
