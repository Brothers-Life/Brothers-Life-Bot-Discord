import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('raid', 'Activer ou arrêter le mode raid de ce serveur')
	.addSubcommand(s => s.setName('on').setDescription('Activer le mode raid (verrouillages et action sur les nouveaux arrivants)'))
	.addSubcommand(s => s.setName('off').setDescription('Arrêter le mode raid'));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const on = interaction.options.getSubcommand() === 'on';
		const raid = await interaction.client.core.antiraid.setRaid(actor, interaction.guildId, on);
		return { content: on ? `🚨 Mode raid actif jusqu’à <t:${Math.round(raid.until / 1000)}:t>.` : `✅ Mode raid arrêté (${raid.actioned} compte(s) traité(s)).` };
	});
}
