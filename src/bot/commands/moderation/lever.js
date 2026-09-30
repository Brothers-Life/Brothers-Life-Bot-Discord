import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('lever', 'Lever les restrictions d’un membre')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
	.addStringOption(o => o.setName('profil').setDescription('Une seule restriction (par défaut : toutes)').setAutocomplete(true))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500));

export { autocomplete } from './restreindre.js';

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const user = interaction.options.getUser('membre');
		const lifted = await interaction.client.core.sanctions.unrestrictUser(actor, user.id, {
			profile: interaction.options.getString('profil'),
			reason: interaction.options.getString('raison') ?? '',
		});
		return { content: `${lifted.length} restriction(s) levée(s) pour <@${user.id}> (${lifted.map(s => `#${s.id}`).join(', ')}).`, allowedMentions: { parse: [] } };
	});
}
