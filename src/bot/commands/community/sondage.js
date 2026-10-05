import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AppError, ForbiddenError } from '../../../core/errors.js';
import { parseDuration } from '../../../core/duration.js';
import { actorOf } from '../../moderation.js';
import { errorContent } from '../../userError.js';

export const data = new SlashCommandBuilder()
	.setName('sondage')
	.setDescription('Créer ou fermer un sondage')
	.setContexts(InteractionContextType.Guild)
	.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
	.addSubcommand(s => s.setName('creer').setDescription('Créer un sondage rapide dans ce salon')
		.addStringOption(o => o.setName('question').setDescription('La question').setRequired(true).setMaxLength(250))
		.addStringOption(o => o.setName('choix').setDescription('Les choix, séparés par des ; (ex : Oui;Non;Peut-être)').setRequired(true).setMaxLength(1500))
		.addStringOption(o => o.setName('duree').setDescription('Durée (ex : 1h, 2j). Vide = jusqu’à fermeture'))
		.addBooleanOption(o => o.setName('multiple').setDescription('Plusieurs choix possibles'))
		.addBooleanOption(o => o.setName('public').setDescription('Montrer qui a voté')))
	.addSubcommand(s => s.setName('fermer').setDescription('Fermer un sondage')
		.addIntegerOption(o => o.setName('id').setDescription('Sondage ouvert (son numéro est en bas du sondage)').setRequired(true).setAutocomplete(true)));

// Open polls published on this server, newest first
export async function autocomplete(interaction) {
	const actor = await actorOf(interaction);
	if (!actor.can('polls.manage')) return interaction.respond([]);
	const typed = String(interaction.options.getFocused() ?? '').toLowerCase();
	const open = interaction.client.core.polls.list()
		.filter(p => p.status === 'open' && p.targets.some(t => t.guildId === interaction.guildId))
		.filter(p => !typed || String(p.id).startsWith(typed) || p.question.toLowerCase().includes(typed));
	await interaction.respond(open.slice(0, 25).map(p => ({ name: `#${p.id} · ${p.question}`.slice(0, 100), value: p.id })));
}

export async function execute(interaction) {
	const { polls } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		if (!actor.can('polls.manage')) throw new ForbiddenError('Permission manquante : polls.manage');
		if (interaction.options.getSubcommand() === 'fermer') {
			await polls.close(actor, interaction.options.getInteger('id'));
			return await interaction.editReply(`Sondage #${interaction.options.getInteger('id')} fermé.`);
		}
		const raw = interaction.options.getString('duree');
		const durationMs = raw ? parseDuration(raw) : null;
		if (raw && !durationMs) throw new AppError('VALIDATION', `Durée invalide : « ${raw} ».`);
		const poll = polls.create(actor, {
			question: interaction.options.getString('question'),
			options: interaction.options.getString('choix').split(';').map(label => ({ label: label.trim() })),
			settings: { multiple: interaction.options.getBoolean('multiple') ?? false, anonymous: !(interaction.options.getBoolean('public') ?? false) },
			targets: [{ guildId: interaction.guildId, channelId: interaction.channelId, ping: 'none' }],
			endsAt: durationMs ? Date.now() + durationMs : null,
		});
		await polls.publish(actor, poll.id);
		return await interaction.editReply(`Sondage #${poll.id} publié.`);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(errorContent(error));
	}
}
