import { moderationCommand, runModeration, sanctionEmbed } from '../../moderation.js';
import { ValidationError } from '../../../core/errors.js';

export const data = moderationCommand('unwarn', 'Retirer un avertissement d’un membre')
	.addIntegerOption(o => o.setName('id').setDescription('Numéro de l’avertissement (voir /historique)').setRequired(true).setMinValue(1))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { sanctions } = interaction.client.core;
		const id = interaction.options.getInteger('id');
		if (sanctions.get(id).type !== 'warn') throw new ValidationError(`La sanction #${id} n’est pas un avertissement.`);
		const revoked = await sanctions.revoke(actor, id, interaction.options.getString('raison') ?? '');
		return { embeds: [sanctionEmbed(revoked, { revoked: true })] };
	});
}
