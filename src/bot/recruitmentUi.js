import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { fitFields } from './ticketsUi.js';

const STATUS_OPTIONS = [
	['review', 'En étude', '🔎'], ['interview', 'Entretien', '🗣️'], ['accepted', 'Acceptée', '✅'], ['rejected', 'Refusée', '❌'],
];

export function recruitmentPanelPayload(positions) {
	const embed = new EmbedBuilder()
		.setColor(0xd6a249)
		.setTitle('Recrutement du staff')
		.setDescription(positions.map(p => `**${p.name}** ${p.config.open ? '🟢 ouvert' : '🔴 fermé'}${p.description ? `\n${p.description}` : ''}`).join('\n\n').slice(0, 4000));
	const buttons = positions.slice(0, 25).map(p => new ButtonBuilder()
		.setCustomId(`rc:apply:${p.id}`)
		.setLabel(`Postuler : ${p.name}`.slice(0, 80))
		.setStyle(ButtonStyle.Primary)
		.setDisabled(!p.config.open));
	const rows = [];
	for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
	return { embeds: [embed], components: rows };
}

// Application as the staff sees it in the review channel
export function applicationPayload({ position, application: a, status }) {
	const author = `Candidature · ${position.name}`;
	const title = `${a.userName ?? a.userId}`;
	const description = `<@${a.userId}> · candidature #${a.id}`;
	const fixed = [
		{ name: 'Statut', value: `${status.emoji} ${status.label}`, inline: true },
		{ name: 'Votes du staff', value: `👍 ${a.score.for} · 🤷 ${a.score.neutral} · 👎 ${a.score.against}`, inline: true },
	];
	const answers = a.answers.slice(0, 20).map(x => ({ name: x.label.slice(0, 256), value: (x.value || '—').slice(0, 1024) }));
	const embed = new EmbedBuilder()
		.setColor(Number.parseInt(status.color.slice(1), 16))
		.setAuthor({ name: author })
		.setTitle(title)
		.setDescription(description)
		.addFields(...fitFields(answers, author, title, description, ...fixed.flatMap(f => [f.name, f.value])), ...fixed)
		.setTimestamp(new Date(a.createdAt));
	const open = ['received', 'review', 'interview'].includes(a.status);
	const components = open ? [
		new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`rc:vote:${a.id}:1`).setEmoji('👍').setLabel('Pour').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`rc:vote:${a.id}:0`).setEmoji('🤷').setLabel('Neutre').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`rc:vote:${a.id}:-1`).setEmoji('👎').setLabel('Contre').setStyle(ButtonStyle.Danger),
		),
		new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`rc:status:${a.id}`).setPlaceholder('Décision (responsables)')
			.addOptions(STATUS_OPTIONS.map(([value, label, emoji]) => ({ value, label, emoji })))),
	] : [];
	return { embeds: [embed], components };
}

// Final decision from the menu: an optional word for the candidate, added to the DM (customId rc:decide:<id>:<accepted|rejected>)
export function decisionModal(applicationId, status) {
	const accepted = status === 'accepted';
	return new ModalBuilder().setCustomId(`rc:decide:${applicationId}:${status}`).setTitle(accepted ? 'Accepter la candidature' : 'Refuser la candidature').addComponents(
		new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason')
			.setLabel(accepted ? 'Mot pour le candidat (facultatif)' : 'Raison du refus (facultatif, en MP)')
			.setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
	);
}
