import { moderationCommand, runModeration, sanctionEmbed } from '../../moderation.js';
import { ForbiddenError } from '../../../core/errors.js';

export const data = moderationCommand('sanction', 'Voir, lever ou corriger une sanction par son numéro')
	.addSubcommand(s => s.setName('voir').setDescription('Détail d’une sanction')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro').setRequired(true).setMinValue(1)))
	.addSubcommand(s => s.setName('lever').setDescription('Lever ou annuler une sanction')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro').setRequired(true).setMinValue(1))
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500)))
	.addSubcommand(s => s.setName('raison').setDescription('Changer la raison d’une sanction')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro').setRequired(true).setMinValue(1))
		.addStringOption(o => o.setName('texte').setDescription('Nouvelle raison').setRequired(true).setMaxLength(500)));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { sanctions, restrictions } = interaction.client.core;
		const id = interaction.options.getInteger('id');
		const withProfile = s => ({ ...s, profileLabel: s.profile ? restrictions.getProfile(s.profile).label : null });
		switch (interaction.options.getSubcommand()) {
		case 'voir': {
			if (!actor.can('sanctions.view')) throw new ForbiddenError('il te faut la permission de voir les sanctions.');
			const sanction = sanctions.get(id);
			const embed = sanctionEmbed(withProfile(sanction));
			embed.addFields(
				{ name: 'Par', value: /^\d+$/.test(sanction.moderatorId) ? `<@${sanction.moderatorId}>` : sanction.moderatorId, inline: true },
				{ name: 'Le', value: `<t:${Math.round(sanction.createdAt / 1000)}:f>`, inline: true },
			);
			if (sanction.revokedAt) embed.addFields({ name: 'Levée', value: `<t:${Math.round(sanction.revokedAt / 1000)}:f>${sanction.revokeReason ? ` · ${sanction.revokeReason}` : ''}` });
			return { embeds: [embed] };
		}
		case 'lever': {
			const revoked = await sanctions.revoke(actor, id, interaction.options.getString('raison') ?? '');
			return { embeds: [sanctionEmbed(withProfile(revoked), { revoked: true })] };
		}
		case 'raison': {
			const updated = sanctions.setReason(actor, id, interaction.options.getString('texte'));
			return { embeds: [sanctionEmbed(withProfile(updated))] };
		}
		}
		return { content: 'Sous-commande inconnue.' };
	});
}
