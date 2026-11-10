import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { parseEmoji } from '../core/emoji.js';

// Discord limits of one embed; the total is kept under 6000 with room for the footer
const FIELD_VALUE_MAX = 1024;
const FIELDS_MAX = 25;
const TOTAL_MAX = 5800;
const DESCRIPTION_BUDGET = 2500;
const DESCRIPTION_MAX = 400;

const OPTIONS_MAX = 25;
const SELECTS_MAX = 5;

function emojiText(value) {
	const emoji = parseEmoji(value);
	if (!emoji) return '';
	if (!emoji.id) return emoji.name;
	return `<${emoji.animated ? 'a' : ''}:${emoji.name ?? 'e'}:${emoji.id}>`;
}

function stateOf(takeover) {
	if (takeover.open) return { icon: '🟢', label: 'Inscriptions ouvertes' };
	if (takeover.convokedAt) return { icon: '🎙️', label: 'Entretiens en cours' };
	return { icon: '🔴', label: 'Inscriptions fermées' };
}

function shorten(text, max) {
	const flat = text.replace(/\s*\n\s*/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…` : flat;
}

function takeoverBlock(takeover, descriptionMax) {
	const { icon, label } = stateOf(takeover);
	const lines = [
		`${icon} **${takeover.name}**`,
		`${label} · ${takeover.mode === 'form' ? '📋 Dossier' : '✍️ Inscription simple'} · 👥 ${takeover.registered ?? 0}`,
	];
	const description = shorten(takeover.description ?? '', descriptionMax);
	if (description) lines.push(`> ${description}`);
	if (takeover.interviewAt && !takeover.convokedAt) {
		const at = Math.floor(takeover.interviewAt / 1000);
		lines.push(`📅 Entretiens <t:${at}:f> (<t:${at}:R>)`);
	}
	return lines.join('\n');
}

// Categories in their order, what has none at the end, and no empty category
function sectionsOf(groups, takeovers) {
	const known = new Set(groups.map(g => g.id));
	const sections = groups.map(g => ({ group: g, name: `${emojiText(g.emoji)} ${g.name}`.trim(), takeovers: takeovers.filter(t => t.groupId === g.id) }));
	sections.push({ group: null, name: groups.length ? 'Autres' : 'À reprendre', takeovers: takeovers.filter(t => !known.has(t.groupId)) });
	return sections.filter(s => s.takeovers.length);
}

// Fields of at most 1024 characters: a category too long continues in the next one. What cannot fit is counted
function packFields(sections, descriptionMax, room, slots) {
	const fields = [];
	let hidden = 0;
	for (const section of sections) {
		const name = `${section.name} (${section.takeovers.length})`;
		let value = '';
		let part = 0;
		const flush = () => {
			if (value) fields.push({ name: part++ ? `${name} · suite` : name, value });
			value = '';
		};
		for (const takeover of section.takeovers) {
			const block = takeoverBlock(takeover, descriptionMax);
			if (value && value.length + 2 + block.length > FIELD_VALUE_MAX) flush();
			const cost = block.length + (value ? 2 : name.length + 8);
			if (cost > room || (!value && fields.length >= slots)) {
				hidden++;
				continue;
			}
			room -= cost;
			value = value ? `${value}\n\n${block}` : block;
		}
		flush();
	}
	return { fields, hidden };
}

// One button per category: it opens the list of what can be joined in it
function categoryButton(section, { home, category, alone }) {
	const button = new ButtonBuilder()
		.setCustomId(`to:list:${section.group?.id ?? 0}:${category}:${home}`)
		.setLabel((alone ? 'Voir les reprises disponibles' : section.group?.name ?? 'Autres').slice(0, 80))
		.setStyle(ButtonStyle.Primary)
		.setDisabled(!section.takeovers.some(t => t.open));
	const emoji = parseEmoji(section.group?.emoji);
	if (emoji) button.setEmoji(emoji);
	return button;
}

export function takeoverPickerPayload({ name, takeovers }) {
	const options = takeovers.slice(0, SELECTS_MAX * OPTIONS_MAX).map(t => ({
		label: t.name.slice(0, 100),
		value: String(t.id),
		description: shorten([t.mode === 'form' ? 'Dossier à remplir' : 'Inscription en un clic', t.description].filter(Boolean).join(' · '), 100),
	}));
	const components = [];
	for (let i = 0; i < options.length; i += OPTIONS_MAX) {
		components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
			.setCustomId(`to:pick:${i / OPTIONS_MAX}`)
			.setPlaceholder('Choisis ce que tu veux reprendre')
			.addOptions(options.slice(i, i + OPTIONS_MAX))));
	}
	return { content: `**${name}** : choisis ce que tu veux reprendre dans la liste.`, components };
}

export function takeoverPanelPayload({ title, description = '', color = '#ff9628', thumbnailUrl = null, imageUrl = null, groups = [], takeovers, guild = null, home, category }) {
	const sections = sectionsOf(groups, takeovers);
	const open = takeovers.filter(t => t.open).length;
	const registered = takeovers.reduce((sum, t) => sum + (t.registered ?? 0), 0);
	const intro = description.trim();
	const body = takeovers.length ? intro : [intro, '*Aucune reprise disponible pour le moment.*'].filter(Boolean).join('\n\n');
	const stats = takeovers.length ? [
		{ name: '📌 Disponibles', value: `**${takeovers.length}**`, inline: true },
		{ name: '🟢 Ouvertes', value: `**${open}**`, inline: true },
		{ name: '👥 Inscrits', value: `**${registered}**`, inline: true },
	] : [];
	const statsLength = stats.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
	const footerRoom = (guild?.name?.length ?? 8) + 40;
	const descriptionMax = Math.min(DESCRIPTION_MAX, Math.floor(DESCRIPTION_BUDGET / Math.max(takeovers.length, 1)));
	const { fields, hidden } = packFields(sections, descriptionMax, TOTAL_MAX - title.length - body.length - statsLength - footerRoom, FIELDS_MAX - stats.length);

	const embed = new EmbedBuilder()
		.setColor(color)
		.setTitle(title)
		.setThumbnail(thumbnailUrl ?? guild?.icon ?? null)
		.setImage(imageUrl)
		.setFooter({ text: [guild?.name ?? 'Reprises', hidden ? `+ ${hidden} ${hidden > 1 ? 'autres reprises' : 'autre reprise'}` : ''].filter(Boolean).join(' · '), iconURL: guild?.icon ?? undefined })
		.setTimestamp();
	if (body) embed.setDescription(body);
	if (stats.length || fields.length) embed.addFields(...stats, ...fields);

	// Same order as the embed
	const alone = sections.length === 1 && !sections[0].group;
	const buttons = sections.map(section => categoryButton(section, { home, category, alone })).slice(0, 25);
	const components = [];
	for (let i = 0; i < buttons.length; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
	return { embeds: [embed], components };
}

export function leaveRow(id) {
	return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`to:leave:${id}`).setLabel('Retirer mon inscription').setStyle(ButtonStyle.Secondary));
}
