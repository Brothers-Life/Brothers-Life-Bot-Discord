import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError, ValidationError } from '../../../core/errors.js';
import { parseDuration } from '../../../core/duration.js';
import { actorOf } from '../../moderation.js';

export const data = new SlashCommandBuilder()
	.setName('absence')
	.setDescription('Absences du staff')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('declarer').setDescription('Déclarer une absence')
		.addStringOption(o => o.setName('duree').setDescription('Durée (ex : 3j, 2sem) ou date de retour JJ/MM').setRequired(true))
		.addStringOption(o => o.setName('raison').setDescription('Raison (facultatif)').setMaxLength(300))
		.addStringOption(o => o.setName('debut').setDescription('Début JJ/MM (par défaut : maintenant)')))
	.addSubcommand(s => s.setName('retour').setDescription('Je suis de retour'))
	.addSubcommand(s => s.setName('annuler').setDescription('Annuler une absence pas encore commencée')
		.addIntegerOption(o => o.setName('absence').setDescription('L’absence à annuler (par défaut : la prochaine)').setAutocomplete(true)))
	.addSubcommand(s => s.setName('liste').setDescription('Qui est absent en ce moment ? (staff)'));

const day = at => new Date(at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

// One's own absences that have not started yet
export async function autocomplete(interaction) {
	const typed = String(interaction.options.getFocused() ?? '').toLowerCase();
	const list = interaction.client.core.absences.upcomingFor(interaction.user.id).map(a => ({
		name: `Du ${day(a.startAt)} au ${day(a.endAt)}${a.status === 'pending' ? ' · en attente' : ''}${a.reason ? ` · ${a.reason}` : ''}`.slice(0, 100),
		value: a.id,
	}));
	await interaction.respond(list.filter(c => c.name.toLowerCase().includes(typed)).slice(0, 25));
}

// "25/12" -> timestamp of that day at 23:59 (next year if already past)
function parseDay(text, endOfDay) {
	const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text.trim());
	if (!match) return null;
	const date = new Date();
	date.setMonth(Number(match[2]) - 1, Number(match[1]));
	date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, 0, 0);
	if (date.getTime() < Date.now() - 86_400_000) date.setFullYear(date.getFullYear() + 1);
	return date.getTime();
}

export async function execute(interaction) {
	const { absences } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		switch (interaction.options.getSubcommand()) {
		case 'declarer': {
			const startText = interaction.options.getString('debut');
			const startAt = startText ? parseDay(startText, false) : Date.now();
			if (startAt === null) throw new ValidationError('Début invalide : utilise JJ/MM.');
			const raw = interaction.options.getString('duree');
			const endAt = parseDay(raw, true) ?? (parseDuration(raw) ? startAt + parseDuration(raw) : null);
			if (!endAt) throw new ValidationError('Durée invalide. Exemples : 3j, 2sem, ou 25/12.');
			const absence = await absences.declare(actor, { startAt, endAt, reason: interaction.options.getString('raison') ?? '' });
			return await interaction.editReply(absence.status === 'pending'
				? 'Absence déclarée : elle attend la validation d’un responsable.'
				: `Absence enregistrée jusqu’au <t:${Math.round(absence.endAt / 1000)}:f>. Bonne pause !`);
		}
		case 'retour': {
			const current = absences.activeFor(interaction.user.id);
			if (!current) throw new ValidationError('Tu n’as pas d’absence en cours.');
			await absences.end(actor, current.id);
			return await interaction.editReply('Bon retour parmi nous !');
		}
		case 'annuler': {
			const upcoming = absences.upcomingFor(interaction.user.id);
			const chosen = interaction.options.getInteger('absence');
			const target = chosen ? upcoming.find(a => a.id === chosen) : upcoming[0];
			if (!target) throw new ValidationError(chosen ? 'Absence introuvable parmi tes absences pas encore commencées.' : 'Tu n’as aucune absence à venir à annuler.');
			await absences.cancel(actor, target.id);
			return await interaction.editReply(`Absence du <t:${Math.round(target.startAt / 1000)}:d> au <t:${Math.round(target.endAt / 1000)}:d> annulée.`);
		}
		case 'liste': {
			const list = absences.currentFor(actor);
			const embed = new EmbedBuilder().setColor(0x5b9cf6).setTitle('Staff absent')
				.setDescription(list.map(a => `<@${a.userId}> · retour <t:${Math.round(a.endAt / 1000)}:R>${a.reason ? ` · ${a.reason}` : ''}`).join('\n') || 'Personne n’est absent.');
			return await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}
