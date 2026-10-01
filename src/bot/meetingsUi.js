import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

const ts = (ms, style = 'F') => `<t:${Math.round(ms / 1000)}:${style}>`;
const STATUS = {
	scheduled: ['📅 Réunion prévue', 0xff9628],
	live: ['🔴 Réunion en cours', 0xed4245],
	ended: ['✅ Réunion terminée', 0x3ba55d],
	cancelled: ['❌ Réunion annulée', 0x4f545c],
};
const duration = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`);
const names = list => (list.length ? list.slice(0, 30).map(id => `<@${id}>`).join(' ') + (list.length > 30 ? ` … +${list.length - 30}` : '') : '—');

function answerButtons(id, disabled = false) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`mtg:yes:${id}`).setLabel('Présent').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
		new ButtonBuilder().setCustomId(`mtg:maybe:${id}`).setLabel('Peut-être').setEmoji('🤔').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
		new ButtonBuilder().setCustomId(`mtg:no:${id}`).setLabel('Absent').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled),
	);
}

function baseEmbed(v) {
	const [label, color] = STATUS[v.status] ?? STATUS.scheduled;
	const embed = new EmbedBuilder()
		.setColor(color)
		.setAuthor({ name: label })
		.setTitle(v.title.slice(0, 256))
		.addFields(
			{ name: 'Quand', value: `${ts(v.startsAt)}\n${ts(v.startsAt, 'R')} · ${duration(v.durationMinutes)}`, inline: true },
			{ name: 'Où', value: `<#${v.voiceChannelId}>`, inline: true },
		);
	if (v.description) embed.setDescription(v.description.slice(0, 4000));
	if (v.agenda.length) embed.addFields({ name: 'Ordre du jour', value: v.agenda.map((a, i) => `${a.done ? '☑️' : `\`${i + 1}.\``} ${a.text}`).join('\n').slice(0, 1024) });
	return embed;
}

// Convocation in the staff channel, kept up to date (answers, then attendance)
export function meetingPayload(v) {
	const embed = baseEmbed(v);
	const by = answer => v.invitees.filter(i => i.rsvp === answer).map(i => i.userId);
	if (v.status === 'scheduled' || v.status === 'live') {
		embed.addFields(
			{ name: `✅ Présents (${v.answers.yes})`, value: names(by('yes')).slice(0, 1024) },
			{ name: `🤔 Peut-être (${v.answers.maybe})`, value: names(by('maybe')).slice(0, 1024), inline: true },
			{ name: `❌ Absents (${v.answers.no})`, value: names(by('no')).slice(0, 1024), inline: true },
			{ name: `⏳ Sans réponse (${v.answers.pending})`, value: names(by('pending')).slice(0, 1024) },
		);
	}
	if (v.status === 'live' && v.report) {
		const here = v.report.people.filter(p => p.inVoice).map(p => p.userId);
		embed.addFields({ name: `🎙️ En vocal maintenant (${here.length})`, value: names(here).slice(0, 1024) });
	}
	if (v.status === 'ended' && v.report) {
		const c = v.report.counts;
		embed.addFields({ name: 'Bilan', value: `${c.present} à l’heure · ${c.late} en retard · ${c.excused} excusé(s) · ${c.absent} absent(s)${c.guest ? ` · ${c.guest} invité(s) de passage` : ''}` });
	}
	embed.setFooter({ text: `Réunion #${v.id}${v.recurrence ? ' · se répète' : ''}` });
	return { embeds: [embed], components: v.status === 'scheduled' || v.status === 'live' ? [answerButtons(v.id)] : [], allowedMentions: { parse: [] } };
}

// Private message: convocation, reminder, change of date, cancellation
export function meetingDMPayload(v, { kind, text }) {
	const intro = {
		invite: '📨 Tu es convoqué à une réunion du staff. Réponds avec les boutons ci-dessous.',
		reminder: text,
		moved: text,
		cancelled: text,
	}[kind] ?? text;
	const embed = baseEmbed(v);
	const open = kind !== 'cancelled' && (v.status === 'scheduled' || v.status === 'live');
	return { content: intro, embeds: [embed], components: open ? [answerButtons(v.id)] : [] };
}

export function absenceModal(id) {
	return new ModalBuilder().setCustomId(`mtg:noform:${id}`).setTitle('Absent à la réunion').addComponents(
		new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Pourquoi ne peux-tu pas venir ?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)),
	);
}

// Summary posted at the end
export function summaryPayload(v) {
	const r = v.report;
	const by = status => r.people.filter(p => p.status === status);
	const line = p => `<@${p.userId}> · ${p.minutes} min`;
	const embed = new EmbedBuilder()
		.setColor(0x3ba55d)
		.setTitle(`📋 Compte rendu · ${v.title}`.slice(0, 256))
		.setDescription(`${ts(v.startedAt ?? v.startsAt, 'f')} → ${ts(v.endedAt, 't')} · ${Math.round((v.endedAt - (v.startedAt ?? v.startsAt)) / 60_000)} min`)
		.addFields(
			{ name: `✅ À l’heure (${by('present').length})`, value: (by('present').map(line).join('\n') || '—').slice(0, 1024), inline: true },
			{ name: `⏰ En retard (${by('late').length})`, value: (by('late').map(p => `${line(p)} · arrivé ${ts(p.firstJoin, 't')}`).join('\n') || '—').slice(0, 1024), inline: true },
			{ name: `📝 Excusés (${by('excused').length})`, value: (by('excused').map(p => `<@${p.userId}>${p.reason ? ` · ${p.reason}` : ''}`).join('\n') || '—').slice(0, 1024) },
			{ name: `❌ Absents (${by('absent').length})`, value: (by('absent').map(p => `<@${p.userId}>`).join(' ') || '—').slice(0, 1024) },
		);
	if (by('guest').length) embed.addFields({ name: `👋 De passage (${by('guest').length})`, value: by('guest').map(line).join('\n').slice(0, 1024) });
	if (v.agenda.length) embed.addFields({ name: 'Ordre du jour', value: v.agenda.map(a => `${a.done ? '☑️' : '⬜'} ${a.text}${a.note ? ` — ${a.note}` : ''}`).join('\n').slice(0, 1024) });
	if (v.notes) embed.addFields({ name: 'Notes', value: v.notes.slice(0, 1024) });
	if (v.actions.length) embed.addFields({ name: 'Tâches', value: v.actions.map(a => `${a.doneAt ? '☑️' : '⬜'} ${a.text}${a.assigneeId ? ` · <@${a.assigneeId}>` : ''}${a.dueAt ? ` · ${ts(a.dueAt, 'D')}` : ''}`).join('\n').slice(0, 1024) });
	return { embeds: [embed], allowedMentions: { parse: [] } };
}
