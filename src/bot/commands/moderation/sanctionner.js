import { actorOf, moderationCommand, runModeration, durationOption, sanctionEmbed } from '../../moderation.js';

const TYPE_EMOJI = { ban: '⛔', kick: '👢', timeout: '⏳', warn: '⚠️', restrict: '🔇' };

export const data = moderationCommand('sanctionner', 'Sanctionner avec un modèle (raison, durée, portée prêtes), ajustable')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
	.addStringOption(o => o.setName('modele').setDescription('Modèle de sanction').setRequired(true).setAutocomplete(true))
	.addStringOption(o => o.setName('precision').setDescription('Ajouté à la raison du modèle').setMaxLength(300))
	.addStringOption(o => o.setName('duree').setDescription('Remplace la durée du modèle (ex : 2h, 7j)'))
	.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur (sinon : portée du modèle)'));

export async function autocomplete(interaction) {
	const actor = await actorOf(interaction);
	const list = interaction.client.core.sanctionTemplates.suggest(actor, interaction.options.getFocused());
	await interaction.respond(list.map(t => ({
		name: `${TYPE_EMOJI[t.type]} ${t.name}${t.durationLabel ? ` · ${t.durationLabel}` : ''}`.slice(0, 100),
		value: String(t.id),
	})));
}

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { sanctions, sanctionTemplates, restrictions } = interaction.client.core;
		const id = Number(interaction.options.getString('modele'));
		const local = interaction.options.getBoolean('local');
		const input = sanctionTemplates.resolve(id, {
			extra: interaction.options.getString('precision') ?? '',
			durationMs: durationOption(interaction, 'duree'),
			scope: local ? 'local' : undefined,
		});
		const sanction = await sanctions.create(actor, { ...input, userId: interaction.options.getUser('membre').id, originGuildId: interaction.guildId });
		return { embeds: [sanctionEmbed({ ...sanction, profileLabel: sanction.profile ? restrictions.getProfile(sanction.profile).label : null })] };
	});
}
