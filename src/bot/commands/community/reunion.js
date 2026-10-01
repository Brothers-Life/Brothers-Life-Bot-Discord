import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError, ValidationError } from '../../../core/errors.js';
import { actorOf } from '../../moderation.js';

export const data = new SlashCommandBuilder()
	.setName('reunion')
	.setDescription('Réunions du staff')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('liste').setDescription('Les prochaines réunions'))
	.addSubcommand(s => s.setName('presence').setDescription('Qui est là (réunion en cours)')
		.addStringOption(o => o.setName('reunion').setDescription('Réunion (celle en cours par défaut)').setAutocomplete(true)))
	.addSubcommand(s => s.setName('demarrer').setDescription('Démarrer une réunion maintenant')
		.addStringOption(o => o.setName('reunion').setDescription('Réunion').setRequired(true).setAutocomplete(true)))
	.addSubcommand(s => s.setName('terminer').setDescription('Terminer la réunion et publier le compte rendu')
		.addStringOption(o => o.setName('reunion').setDescription('Réunion (celle en cours par défaut)').setAutocomplete(true)))
	.addSubcommand(s => s.setName('note').setDescription('Ajouter une note au compte rendu')
		.addStringOption(o => o.setName('texte').setDescription('Note').setRequired(true).setMaxLength(1000))
		.addStringOption(o => o.setName('reunion').setDescription('Réunion (celle en cours par défaut)').setAutocomplete(true)))
	.addSubcommand(s => s.setName('tache').setDescription('Ajouter une tâche décidée en réunion')
		.addStringOption(o => o.setName('texte').setDescription('Tâche').setRequired(true).setMaxLength(300))
		.addUserOption(o => o.setName('pour').setDescription('Qui s’en charge'))
		.addStringOption(o => o.setName('echeance').setDescription('Pour le JJ/MM'))
		.addStringOption(o => o.setName('reunion').setDescription('Réunion (celle en cours par défaut)').setAutocomplete(true)));

const ts = (ms, style = 'f') => `<t:${Math.round(ms / 1000)}:${style}>`;

export async function autocomplete(interaction) {
	const typed = interaction.options.getFocused().toLowerCase();
	const sub = interaction.options.getSubcommand();
	const list = interaction.client.core.meetings.list()
		.filter(m => m.guildId === interaction.guildId && (sub === 'demarrer' ? m.status === 'scheduled' : m.status !== 'cancelled'))
		.filter(m => m.title.toLowerCase().includes(typed))
		.slice(0, 25);
	await interaction.respond(list.map(m => ({ name: `${m.status === 'live' ? '🔴 ' : ''}${m.title} · ${new Date(m.startsAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })}`.slice(0, 100), value: String(m.id) })));
}

// The meeting chosen, or the one in progress on this server
function pick(interaction, meetings) {
	const chosen = interaction.options.getString('reunion');
	if (chosen) return meetings.get(Number(chosen));
	const live = meetings.list().find(m => m.status === 'live' && m.guildId === interaction.guildId);
	if (!live) throw new ValidationError('Aucune réunion en cours : choisis-en une.');
	return live;
}

// "25/12" -> that day at 23:59 (next year if already past)
function dueDate(text) {
	const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text?.trim() ?? '');
	if (!match) return null;
	const date = new Date();
	date.setMonth(Number(match[2]) - 1, Number(match[1]));
	date.setHours(23, 59, 0, 0);
	if (date.getTime() < Date.now() - 86_400_000) date.setFullYear(date.getFullYear() + 1);
	return date.getTime();
}

export async function execute(interaction) {
	const { meetings } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		if (!actor.can('meetings.view') && !actor.can('meetings.manage')) throw new ValidationError('Il te faut la permission de voir les réunions.');
		let reply;
		switch (interaction.options.getSubcommand()) {
		case 'liste': {
			const next = meetings.list().filter(m => m.guildId === interaction.guildId && (m.status === 'scheduled' || m.status === 'live')).slice(0, 10);
			reply = { embeds: [new EmbedBuilder().setColor(0xff9628).setTitle('Prochaines réunions').setDescription(next.map(m => `${m.status === 'live' ? '🔴 **en cours** · ' : ''}**${m.title}** · ${ts(m.startsAt)} (${ts(m.startsAt, 'R')}) · <#${m.voiceChannelId}> · ${m.answers.yes}/${m.invitees.length} présents`).join('\n') || 'Aucune réunion prévue.')] };
			break;
		}
		case 'presence': {
			const m = pick(interaction, meetings);
			if (!m.report) throw new ValidationError('La réunion n’a pas commencé.');
			const lines = m.report.people.map(p => `${p.inVoice ? '🟢' : p.status === 'excused' ? '📝' : p.minutes ? '⚪' : '🔴'} <@${p.userId}> · ${p.minutes} min${p.status === 'late' ? ' · en retard' : ''}${p.status === 'excused' ? ' · excusé' : ''}${!p.invited ? ' · de passage' : ''}`);
			reply = { embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`Présences · ${m.title}`).setDescription(lines.join('\n').slice(0, 4000) || 'Personne.').setFooter({ text: '🟢 en vocal · ⚪ parti · 🔴 pas venu · 📝 excusé' })] };
			break;
		}
		case 'demarrer': {
			const m = await meetings.start(actor, Number(interaction.options.getString('reunion')));
			reply = { content: `🔴 Réunion **${m.title}** démarrée dans <#${m.voiceChannelId}>.` };
			break;
		}
		case 'terminer': {
			const { meeting, next } = await meetings.end(actor, pick(interaction, meetings).id);
			reply = { content: `✅ Réunion **${meeting.title}** terminée, compte rendu publié.${next ? ` Prochaine : ${ts(next.startsAt)}.` : ''}` };
			break;
		}
		case 'note': {
			const m = meetings.addNote(actor, pick(interaction, meetings).id, interaction.options.getString('texte'));
			reply = { content: `📝 Note ajoutée au compte rendu de **${m.title}**.` };
			break;
		}
		case 'tache': {
			const raw = interaction.options.getString('echeance');
			const dueAt = raw ? dueDate(raw) : null;
			if (raw && !dueAt) throw new ValidationError('Échéance invalide : utilise JJ/MM.');
			const m = meetings.addAction(actor, pick(interaction, meetings).id, { text: interaction.options.getString('texte'), assigneeId: interaction.options.getUser('pour')?.id ?? null, dueAt });
			reply = { content: `📋 Tâche ajoutée à **${m.title}**.` };
			break;
		}
		}
		await interaction.editReply({ ...reply, allowedMentions: { parse: [] } });
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}
