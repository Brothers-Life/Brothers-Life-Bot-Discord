import { actorOf, durationOption, moderationCommand, runModeration, sanctionEmbed } from '../../moderation.js';
import { ForbiddenError } from '../../../core/errors.js';

const TYPE_EMOJI = { ban: '⛔', kick: '👢', timeout: '⏳', warn: '⚠️', restrict: '🔇' };
const TYPE_LABEL = { ban: 'Ban', kick: 'Expulsion', timeout: 'Timeout', warn: 'Avertissement', restrict: 'Restriction' };

export const data = moderationCommand('sanction', 'Sanctionner avec un modèle, voir, lever ou corriger une sanction')
	.addSubcommand(s => s.setName('modele').setDescription('Sanctionner avec un modèle (raison, durée, portée prêtes), ajustable')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
		.addStringOption(o => o.setName('modele').setDescription('Modèle de sanction').setRequired(true).setAutocomplete(true))
		.addStringOption(o => o.setName('precision').setDescription('Ajouté à la raison du modèle').setMaxLength(300))
		.addStringOption(o => o.setName('duree').setDescription('Remplace la durée du modèle (ex : 2h, 7j)'))
		.addBooleanOption(o => o.setName('local').setDescription('Seulement sur ce serveur (sinon : portée du modèle)')))
	.addSubcommand(s => s.setName('voir').setDescription('Voir le détail d’une sanction')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro de la sanction').setRequired(true).setMinValue(1).setAutocomplete(true)))
	.addSubcommand(s => s.setName('lever').setDescription('Lever une sanction : ban, timeout, restriction ou avertissement')
		.addIntegerOption(o => o.setName('id').setDescription('Sanction en cours (cherche par membre ou numéro)').setRequired(true).setMinValue(1).setAutocomplete(true))
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(500)))
	.addSubcommand(s => s.setName('raison').setDescription('Changer la raison d’une sanction')
		.addIntegerOption(o => o.setName('id').setDescription('Numéro de la sanction').setRequired(true).setMinValue(1).setAutocomplete(true))
		.addStringOption(o => o.setName('texte').setDescription('Nouvelle raison').setRequired(true).setMaxLength(500)));

function sanctionChoice(s) {
	return { name: `#${s.id} · ${TYPE_EMOJI[s.type]} ${TYPE_LABEL[s.type]} · ${s.userName ?? s.userId}${s.reason ? ` · ${s.reason}` : ''}`.slice(0, 100), value: s.id };
}

export async function autocomplete(interaction) {
	const { sanctions, sanctionTemplates } = interaction.client.core;
	const actor = await actorOf(interaction);
	const focused = interaction.options.getFocused(true);
	if (focused.name === 'modele') {
		const list = sanctionTemplates.suggest(actor, focused.value);
		return interaction.respond(list.map(t => ({
			name: `${TYPE_EMOJI[t.type]} ${t.name}${t.durationLabel ? ` · ${t.durationLabel}` : ''}`.slice(0, 100),
			value: String(t.id),
		})));
	}
	// Who is sanctioned is private: only for the staff who may see sanctions
	if (!actor.can('sanctions.view') && !actor.can('sanctions.revoke')) return interaction.respond([]);
	const typed = String(focused.value ?? '').toLowerCase().replace(/^#/, '');
	// To lift: what is still running (ban, timeout, restriction) and the warns not yet removed
	const list = interaction.options.getSubcommand() === 'lever'
		? [...sanctions.list({ active: true, limit: 100 }), ...sanctions.list({ type: 'warn', limit: 100 }).filter(w => !w.revokedAt)].sort((a, b) => b.id - a.id)
		: sanctions.list({ limit: 100 });
	const matches = list.filter(s => !typed || String(s.id).startsWith(typed) || (s.userName ?? '').toLowerCase().includes(typed) || s.userId === typed);
	await interaction.respond(matches.slice(0, 25).map(sanctionChoice));
}

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const { sanctions, sanctionTemplates, restrictions } = interaction.client.core;
		const id = interaction.options.getInteger('id');
		const withProfile = s => ({ ...s, profileLabel: s.profile ? restrictions.getProfile(s.profile).label : null });
		switch (interaction.options.getSubcommand()) {
		case 'modele': {
			const input = sanctionTemplates.resolve(Number(interaction.options.getString('modele')), {
				extra: interaction.options.getString('precision') ?? '',
				durationMs: durationOption(interaction, 'duree'),
				scope: interaction.options.getBoolean('local') ? 'local' : undefined,
			});
			const sanction = await sanctions.create(actor, { ...input, userId: interaction.options.getUser('membre').id, originGuildId: interaction.guildId });
			return { embeds: [sanctionEmbed(withProfile(sanction))] };
		}
		case 'voir': {
			if (!actor.can('sanctions.view')) throw new ForbiddenError('Permission manquante : sanctions.view');
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
