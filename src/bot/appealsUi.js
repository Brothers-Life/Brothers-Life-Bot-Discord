import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

const TYPE = { ban: 'Bannissement', timeout: 'Timeout', warn: 'Avertissement', restrict: 'Restriction', kick: 'Expulsion' };
const STATUS = { pending: ['⏳ En attente', 0xf5a524], accepted: ['✅ Accepté', 0x3ba55d], rejected: ['❌ Refusé', 0xed4245] };

// The appeal, for the staff (customId appeal:<accept|reject>:<appealId>)
export function appealPayload(view) {
	const s = view.sanction;
	const [label, color] = STATUS[view.status] ?? STATUS.pending;
	const embed = new EmbedBuilder()
		.setColor(color)
		.setTitle(`Appel · sanction #${s.id}`)
		.setDescription(`<@${view.userId}> (${s.userName ?? view.userId})`)
		.addFields(
			{ name: 'Sanction', value: `${TYPE[s.type] ?? s.type}${s.expiresAt ? ` jusqu’au <t:${Math.round(s.expiresAt / 1000)}:f>` : ''}`, inline: true },
			{ name: 'Par', value: /^\d+$/.test(s.moderatorId) ? `<@${s.moderatorId}>` : s.moderatorId, inline: true },
			{ name: 'Le', value: `<t:${Math.round(s.createdAt / 1000)}:f>`, inline: true },
			...(s.reason ? [{ name: 'Raison de la sanction', value: s.reason.slice(0, 1024) }] : []),
			...view.answers.map(a => ({ name: a.question.slice(0, 256), value: (a.answer || '—').slice(0, 1024) })),
			{ name: 'Statut', value: view.decidedBy ? `${label} par <@${view.decidedBy}>${view.decisionReason ? ` · ${view.decisionReason}` : ''}` : label },
		)
		.setFooter({ text: `Appel #${view.id}` })
		.setTimestamp(new Date(view.createdAt));
	const components = view.status === 'pending' ? [new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`appeal:accept:${view.id}`).setLabel('Accepter (lever la sanction)').setEmoji('✅').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`appeal:reject:${view.id}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger),
	)] : [];
	return { embeds: [embed], components };
}

// The form of the sanctioned person (one field per question)
export function appealModal(sanctionId, questions) {
	return new ModalBuilder().setCustomId(`appeal:submit:${sanctionId}`).setTitle(`Appel · sanction #${sanctionId}`.slice(0, 45)).addComponents(
		questions.slice(0, 5).map((question, i) => new ActionRowBuilder().addComponents(
			new TextInputBuilder().setCustomId(`a${i}`).setLabel(question.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(i === 0).setMaxLength(1000),
		)),
	);
}

// The staff's answer (optional for an acceptance, sent to the person)
export function decisionModal(appealId, accepted) {
	return new ModalBuilder().setCustomId(`appeal:${accepted ? 'acceptform' : 'rejectform'}:${appealId}`).setTitle(accepted ? 'Accepter l’appel' : 'Refuser l’appel').addComponents(
		new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel(accepted ? 'Mot pour la personne (facultatif)' : 'Raison du refus (envoyée en MP)').setStyle(TextInputStyle.Paragraph).setRequired(!accepted).setMaxLength(500)),
	);
}
