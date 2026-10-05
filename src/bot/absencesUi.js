import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

// Refusal: an optional reason, sent to the person in DM (customId abs:rejectform:<id>)
export function rejectModal(absenceId) {
	return new ModalBuilder().setCustomId(`abs:rejectform:${absenceId}`).setTitle('Refuser l’absence').addComponents(
		new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Raison du refus (facultatif, envoyée en MP)')
			.setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
	);
}

const STATUS = {
	pending: { color: 0xf5a524, label: '⏳ En attente de validation' },
	approved: { color: 0x3ba55d, label: '✅ Validée' },
	active: { color: 0x3ba55d, label: '✅ Validée · en cours' },
	ended: { color: 0x4f545c, label: '⚫ Terminée' },
	rejected: { color: 0xed4245, label: '❌ Refusée' },
	cancelled: { color: 0x4f545c, label: '⚫ Annulée' },
};

const ts = (at, style) => `<t:${Math.round(at / 1000)}:${style}>`;

// Messages of the absences: the request to validate (customId abs:<approve|reject>:<id>), departures and returns
export function absencePayload({ kind, absence }) {
	const embed = new EmbedBuilder().setTimestamp(new Date());
	if (kind === 'back') {
		return { embeds: [embed.setColor(0x3ba55d).setDescription(`✅ <@${absence.userId}> est de retour.`)], components: [] };
	}
	if (kind === 'away') {
		embed.setColor(0x5b9cf6).setTitle('📴 Absence').setDescription(`<@${absence.userId}> est absent jusqu’au ${ts(absence.endAt, 'f')} (${ts(absence.endAt, 'R')}).`);
		if (absence.reason) embed.addFields({ name: 'Raison', value: absence.reason.slice(0, 1024) });
		return { embeds: [embed], components: [] };
	}

	const status = STATUS[absence.status] ?? STATUS.pending;
	embed.setColor(status.color).setTitle('Demande d’absence')
		.setDescription(`<@${absence.userId}>`)
		.addFields(
			{ name: 'Du', value: `${ts(absence.startAt, 'f')}`, inline: true },
			{ name: 'Au', value: `${ts(absence.endAt, 'f')}`, inline: true },
			{ name: 'Durée', value: `${Math.max(1, Math.round((absence.endAt - absence.startAt) / 86_400_000))} j`, inline: true },
			{ name: 'Raison', value: absence.reason?.slice(0, 1024) || '—' },
			{ name: 'Statut', value: absence.reviewedBy && absence.status !== 'pending' ? `${status.label} par <@${absence.reviewedBy}>` : status.label },
		)
		.setFooter({ text: `Absence #${absence.id}` });
	const components = absence.status === 'pending' ? [new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`abs:approve:${absence.id}`).setStyle(ButtonStyle.Success).setLabel('Valider').setEmoji('✅'),
		new ButtonBuilder().setCustomId(`abs:reject:${absence.id}`).setStyle(ButtonStyle.Danger).setLabel('Refuser').setEmoji('❌'),
	)] : [];
	return { embeds: [embed], components };
}
