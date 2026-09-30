import { moderationCommand, runModeration, durationOption, scopeOf, sanctionEmbed } from '../../moderation.js';

export const data = moderationCommand('restreindre', 'Restreindre un membre : muet écrit, muet vocal, pas de vocal…')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
	.addStringOption(o => o.setName('profil').setDescription('Type de restriction').setRequired(true).setAutocomplete(true))
	.addStringOption(o => o.setName('duree').setDescription('Durée (ex : 1h, 3j). Vide = jusqu’à levée'))
	.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500))
	.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur'));

export async function autocomplete(interaction) {
	const typed = interaction.options.getFocused().toLowerCase();
	const profiles = interaction.client.core.restrictions.profiles();
	await interaction.respond(profiles.filter(p => p.label.toLowerCase().includes(typed)).slice(0, 25).map(p => ({ name: p.label, value: p.key })));
}

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { sanctions, restrictions } = interaction.client.core;
		const sanction = await sanctions.create(actor, {
			type: 'restrict',
			profile: interaction.options.getString('profil'),
			userId: interaction.options.getUser('membre').id,
			reason: interaction.options.getString('raison') ?? '',
			durationMs: durationOption(interaction, 'duree'),
			scope: scopeOf(interaction),
			originGuildId: interaction.guildId,
		});
		return { embeds: [sanctionEmbed({ ...sanction, profileLabel: restrictions.getProfile(sanction.profile).label })] };
	});
}
