import { moderationCommand, runModeration, durationOption } from '../../moderation.js';
import { formatDuration } from '../../../core/duration.js';

export const data = moderationCommand('role', 'Donner ou retirer un rôle, éventuellement pour une durée')
	.addSubcommand(s => s.setName('ajouter').setDescription('Donner un rôle')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
		.addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true))
		.addStringOption(o => o.setName('duree').setDescription('Rôle temporaire : durée (ex : 7j, 12h). Vide = définitif'))
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(300)))
	.addSubcommand(s => s.setName('retirer').setDescription('Retirer un rôle')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
		.addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true))
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(300)));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { moderation } = interaction.client.core;
		const input = {
			guildId: interaction.guildId,
			userId: interaction.options.getUser('membre').id,
			roleId: interaction.options.getRole('role').id,
			reason: interaction.options.getString('raison') ?? '',
		};
		if (interaction.options.getSubcommand() === 'retirer') {
			await moderation.takeRole(actor, input);
			return { content: `Rôle <@&${input.roleId}> retiré à <@${input.userId}>.`, allowedMentions: { parse: [] } };
		}
		const durationMs = durationOption(interaction, 'duree');
		const temp = await moderation.giveRole(actor, { ...input, durationMs });
		return {
			content: temp
				? `Rôle <@&${input.roleId}> donné à <@${input.userId}> pour ${formatDuration(durationMs)} (retiré <t:${Math.round(temp.expiresAt / 1000)}:R>).`
				: `Rôle <@&${input.roleId}> donné à <@${input.userId}>.`,
			allowedMentions: { parse: [] },
		};
	});
}
