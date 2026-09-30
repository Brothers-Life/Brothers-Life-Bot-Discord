import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('nick', 'Changer le pseudo d’un membre sur ce serveur')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
	.addStringOption(o => o.setName('pseudo').setDescription('Nouveau pseudo (vide = remettre le pseudo d’origine)').setMaxLength(32));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const user = interaction.options.getUser('membre');
		const nickname = interaction.options.getString('pseudo');
		await interaction.client.core.moderation.nick(actor, interaction.guildId, user.id, nickname);
		return { content: nickname ? `Pseudo de <@${user.id}> : **${nickname}**` : `Pseudo de <@${user.id}> remis à zéro.`, allowedMentions: { parse: [] } };
	});
}
