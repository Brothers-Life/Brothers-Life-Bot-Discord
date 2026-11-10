import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { parseEmoji } from '../core/emoji.js';

// Discord limits of one message: 10 embeds, 6000 characters for all of them together. Kept under with room for the footer
const CATEGORY_EMBEDS = 9;
const TEXT_MAX = 4096;
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
	if (takeover.open) return '🟢 DISPONIBLE';
	if (takeover.convokedAt) return '🎙️ ENTRETIENS';
	return '🔴 DÉJÀ PRIS';
}

function shorten(text, max) {
	const flat = text.replace(/\s*\n\s*/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…` : flat;
}

const interviewDate = at => `<t:${Math.floor(at / 1000)}:f> (<t:${Math.floor(at / 1000)}:R>)`;

function takeoverBlock(takeover, descriptionMax) {
	const pills = [stateOf(takeover), takeover.mode === 'form' ? '📋 DOSSIER' : '✍️ SIMPLE', `👥 ${takeover.registered ?? 0}`].map(pill => `\`${pill}\``).join(' ');
	const lines = [`**${takeover.name}** ${pills}`];
	const description = shorten(takeover.description ?? '', descriptionMax);
	if (description) lines.push(`> ${description}`);
	if (takeover.interviewAt && !takeover.convokedAt) lines.push(`📅 Entretiens ${interviewDate(takeover.interviewAt)}`);
	return lines.join('\n');
}

// Categories in their order, what has none at the end, and no empty category
function sectionsOf(groups, takeovers) {
	const known = new Set(groups.map(g => g.id));
	const sections = groups.map(g => ({ group: g, name: `${emojiText(g.emoji)} ${g.name}`.trim(), takeovers: takeovers.filter(t => t.groupId === g.id) }));
	sections.push({ group: null, name: groups.length ? 'Autres' : 'À reprendre', takeovers: takeovers.filter(t => !known.has(t.groupId)) });
	return sections.filter(s => s.takeovers.length);
}

// One card per category. Past what one message can hold, the last card gathers the remaining categories
function cardsOf(sections) {
	const single = section => ({ title: `${section.name} · ${section.takeovers.length}`, parts: [{ heading: null, takeovers: section.takeovers }] });
	if (sections.length <= CATEGORY_EMBEDS) return sections.map(single);
	const rest = sections.slice(CATEGORY_EMBEDS - 1);
	return [
		...sections.slice(0, CATEGORY_EMBEDS - 1).map(single),
		{ title: 'Autres catégories', parts: rest.map(s => ({ heading: `__**${s.name}**__`, takeovers: s.takeovers })) },
	];
}

// The text of each card, within what is left of the message. What cannot fit is counted
function fillCards(cards, descriptionMax, room) {
	const filled = [];
	let hidden = 0;
	for (const { title, parts } of cards) {
		let text = '';
		let left = room - title.length;
		for (const { heading, takeovers } of parts) {
			let pending = heading;
			for (const takeover of takeovers) {
				const block = `${pending ? `${pending}\n` : ''}${takeoverBlock(takeover, descriptionMax)}`;
				const cost = block.length + (text ? 2 : 0);
				if (cost > left || text.length + cost > TEXT_MAX) {
					hidden++;
					continue;
				}
				text = text ? `${text}\n\n${block}` : block;
				left -= cost;
				pending = null;
			}
		}
		if (!text) continue;
		filled.push({ title, text });
		room = left;
	}
	return { filled, hidden };
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

function statsOf(takeovers) {
	if (!takeovers.length) return [];
	const open = takeovers.filter(t => t.open).length;
	const registered = takeovers.reduce((sum, t) => sum + (t.registered ?? 0), 0);
	const stats = [
		{ name: '📌 Reprises', value: `**${takeovers.length}**`, inline: true },
		{ name: '🟢 Disponibles', value: `**${open}**`, inline: true },
		{ name: '👥 Inscrits', value: `**${registered}**`, inline: true },
	];
	const next = takeovers.filter(t => t.interviewAt && !t.convokedAt).sort((a, b) => a.interviewAt - b.interviewAt)[0];
	if (next) stats.push({ name: '📅 Prochains entretiens', value: `**${next.name}** · ${interviewDate(next.interviewAt)}` });
	return stats;
}

export function takeoverPanelPayload({ title, description = '', color = '#ff9628', thumbnailUrl = null, imageUrl = null, groups = [], takeovers, guild = null, home, category }) {
	const sections = sectionsOf(groups, takeovers);
	const intro = description.trim();
	const body = takeovers.length ? intro : [intro, '*Aucune reprise disponible pour le moment.*'].filter(Boolean).join('\n\n');
	const stats = statsOf(takeovers);
	const authorName = guild?.name?.slice(0, 100) ?? '';
	const used = title.length + body.length + authorName.length + 60 + stats.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
	const descriptionMax = Math.min(DESCRIPTION_MAX, Math.floor(DESCRIPTION_BUDGET / Math.max(takeovers.length, 1)));
	const { filled, hidden } = fillCards(cardsOf(sections), descriptionMax, TOTAL_MAX - used);

	const header = new EmbedBuilder()
		.setColor(color)
		.setTitle(title)
		.setThumbnail(thumbnailUrl ?? guild?.icon ?? null)
		.setImage(imageUrl);
	if (authorName) header.setAuthor({ name: authorName });
	if (body) header.setDescription(body);
	if (stats.length) header.addFields(...stats);
	const cards = filled.map(card => new EmbedBuilder().setColor(color).setTitle(card.title).setDescription(card.text));
	const embeds = [header, ...cards];
	embeds.at(-1)
		.setFooter({ text: ['Mise à jour', hidden ? `+ ${hidden} ${hidden > 1 ? 'autres reprises' : 'autre reprise'}` : ''].filter(Boolean).join(' · '), iconURL: guild?.icon ?? undefined })
		.setTimestamp();

	// Same order as the cards
	const alone = sections.length === 1 && !sections[0].group;
	const buttons = sections.map(section => categoryButton(section, { home, category, alone })).slice(0, 25);
	const components = [];
	for (let i = 0; i < buttons.length; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
	return { embeds, components };
}

export function leaveRow(id) {
	return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`to:leave:${id}`).setLabel('Retirer mon inscription').setStyle(ButtonStyle.Secondary));
}
