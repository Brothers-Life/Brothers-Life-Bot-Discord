import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { FILTERS, SEARCH_PLATFORMS, SPEEDS } from '../core/music/index.js';

const LOOP_LABEL = { off: 'Boucle : non', track: 'Boucle : titre', queue: 'Boucle : file' };
const SOURCE_ICON = { youtube: '▶️', spotify: '🟢', soundcloud: '☁️' };
const PLATFORM_NAME = SEARCH_PLATFORMS;

export function clock(ms) {
	if (!Number.isFinite(ms) || ms < 0) return '0:00';
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function bar(position, duration, size = 18) {
	if (!duration) return '🔴 En direct';
	const done = Math.min(size, Math.round((position / duration) * size));
	return `${'▬'.repeat(done)}🔘${'▬'.repeat(Math.max(0, size - done))}`;
}

// Panel address, for the "Gérer sur le panel" button (set once at startup)
let panelUrl = null;
export function setPanelUrl(url) {
	panelUrl = /^https?:\/\//.test(url ?? '') ? url.replace(/\/+$/, '') : null;
}

// YouTube link at the current position ("watch the clip")
export function watchUrl(track, position = 0) {
	const url = track?.youtubeUrl ?? (track?.source === 'youtube' ? track.url : null);
	if (!url) return null;
	return position > 5000 && !track.live ? `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(position / 1000)}` : url;
}

// Now-playing message with its controls (customId mu:<action>)
export function musicPayload(view) {
	if (view.ended || !view.connected) {
		return { embeds: [new EmbedBuilder().setColor(0x4f545c).setDescription(`⏹️ Musique arrêtée${view.reason ? ` (${view.reason})` : ''}.`)], components: [] };
	}
	const track = view.current;
	const embed = new EmbedBuilder().setColor(view.paused ? 0x4f545c : 0xff9628);
	if (!track) {
		embed.setDescription(view.queue?.length
			? 'La file est terminée. Clique sur ➕ **Ajouter** pour chercher un titre ou coller un lien.'
			: '🎧 **Lecteur prêt.** Clique sur ➕ **Ajouter** pour chercher un titre ou coller un lien (YouTube, Spotify, SoundCloud), ou lance une playlist avec `/musique playlist jouer`.');
	}
	else {
		embed.setAuthor({ name: view.loading ? '⏳ Chargement…' : view.paused ? '⏸️ En pause' : '🎶 En cours' })
			.setTitle(`${SOURCE_ICON[track.source] ?? '🎵'} ${track.title}`.slice(0, 256))
			.setDescription([
				track.author ? `**${track.author}**` : null,
				`${bar(view.position, track.durationMs)}`,
				`\`${clock(view.position)} / ${track.durationMs ? clock(track.durationMs) : 'direct'}\` · demandé par <@${track.requestedBy}>`,
			].filter(Boolean).join('\n'));
		const url = track.youtubeUrl ?? track.url;
		if (url) embed.setURL(url);
		if (track.thumbnail) embed.setThumbnail(track.thumbnail);
		const settings = [`🔊 ${view.volume} %`, view.speed !== 1 ? `⏩ ×${view.speed}` : null, LOOP_LABEL[view.loop], view.filters.length ? `🎛️ ${view.filters.join(', ')}` : null].filter(Boolean);
		embed.addFields({ name: 'Réglages', value: settings.join(' · ') });
	}
	const upcoming = view.upcoming ?? [];
	if (upcoming.length) {
		const lines = upcoming.slice(0, 5).map((t, i) => `\`${i + 1}.\` ${t.title.slice(0, 60)}${t.durationMs ? ` · ${clock(t.durationMs)}` : ''}`);
		if (upcoming.length > 5) lines.push(`… et ${upcoming.length - 5} autre${upcoming.length - 5 > 1 ? 's' : ''}`);
		embed.addFields({ name: `À suivre (${upcoming.length})`, value: lines.join('\n').slice(0, 1024) });
	}

	const button = (id, emoji, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(`mu:${id}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);
	const rows = [
		new ActionRowBuilder().addComponents(
			button('prev', '⏮️'),
			button('toggle', view.paused ? '▶️' : '⏸️', ButtonStyle.Primary, !track),
			button('skip', '⏭️', ButtonStyle.Secondary, !track),
			button('stop', '⏹️', ButtonStyle.Danger),
			button('shuffle', '🔀', ButtonStyle.Secondary, upcoming.length < 2),
		),
		new ActionRowBuilder().addComponents(
			button('voldown', '🔉'),
			button('volup', '🔊'),
			new ButtonBuilder().setCustomId('mu:loop').setEmoji(view.loop === 'track' ? '🔂' : '🔁').setLabel(LOOP_LABEL[view.loop].replace('Boucle : ', '')).setStyle(view.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
			new ButtonBuilder().setCustomId('mu:queue').setEmoji('📜').setLabel('File').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId('mu:add').setEmoji('➕').setLabel('Ajouter').setStyle(ButtonStyle.Success),
		),
		new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
			.setCustomId('mu:filters')
			.setPlaceholder(view.filters.length ? `🎛️ Effets : ${view.filters.map(f => FILTERS[f]).join(', ')}`.slice(0, 150) : '🎛️ Effets audio : aucun')
			.setMinValues(0)
			.setMaxValues(Object.keys(FILTERS).length)
			.addOptions(Object.entries(FILTERS).map(([value, label]) => ({ label, value, default: view.filters.includes(value) })))),
		new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
			.setCustomId('mu:speed')
			.setPlaceholder(`⏩ Vitesse : ×${view.speed}`)
			.addOptions(SPEEDS.map(v => ({ label: `Vitesse ×${v}`, value: String(v), default: v === view.speed })))),
	];
	const last = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mu:save').setEmoji('💾').setLabel('Enregistrer en playlist').setStyle(ButtonStyle.Secondary).setDisabled(!view.queue?.length));
	const watch = watchUrl(track, view.position);
	if (watch) last.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(watch).setLabel('Voir le clip').setEmoji('🎬'));
	if (panelUrl) last.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`${panelUrl}/music${view.guildId ? `?guild=${view.guildId}` : ''}`).setLabel('Gérer sur le panel').setEmoji('🖥️'));
	rows.push(last);
	embed.setFooter({ text: '⏮ précédent · ⏯ pause · ⏭ suivant · ⏹ arrêter · 🔀 mélanger · 🔉🔊 volume · ➕ ajouter un titre · /musique ou le panel pour tout le reste' });
	return { embeds: [embed], components: rows };
}

// "Ajouter" and "Enregistrer en playlist" forms
// Choices of the platform menus (/musique jouer, "Ajouter" form)
export const platformChoices = () => Object.entries(SEARCH_PLATFORMS).map(([value, name]) => ({ name, value }));

export function addModal(defaultPlatform = 'youtube') {
	return new ModalBuilder().setCustomId('mu:addform').setTitle('Ajouter de la musique').addLabelComponents(
		new LabelBuilder().setLabel('Lien ou recherche').setTextInputComponent(
			new TextInputBuilder().setCustomId('query').setPlaceholder('https://… ou « daft punk one more time »').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(300),
		),
		new LabelBuilder().setLabel('Chercher sur').setDescription('Pour une recherche (un lien est joué tel quel)').setStringSelectMenuComponent(
			new StringSelectMenuBuilder().setCustomId('platform').setRequired(false).setMinValues(0).setMaxValues(1)
				.addOptions(platformChoices().map(c => ({ label: c.name, value: c.value, default: c.value === defaultPlatform }))),
		),
	);
}

export function saveModal() {
	return new ModalBuilder().setCustomId('mu:saveform').setTitle('Enregistrer la file en playlist').addComponents(
		new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Nom de la playlist').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)),
	);
}

// Search results to pick from (customId mu:pick:<when>)
export function pickPayload(results, text, when = 'end', platform = null) {
	const where = PLATFORM_NAME[platform] ? ` sur ${PLATFORM_NAME[platform]}` : '';
	if (!results.length) return { content: `Rien trouvé${where} pour « ${text} ».`, components: [] };
	return {
		content: `Résultats${where} pour « ${text.slice(0, 100)} » : choisis le bon titre.`,
		components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
			.setCustomId(`mu:pick:${when}`)
			.setPlaceholder('Choisir un titre')
			.addOptions(results.filter(r => r.url && r.url.length <= 100).slice(0, 25).map(r => ({
				label: r.title.slice(0, 100),
				description: [r.author, r.durationMs ? clock(r.durationMs) : null].filter(Boolean).join(' · ').slice(0, 100) || undefined,
				value: r.url,
			}))))],
	};
}

// The queue, for the "File" button and /musique file
export function queuePayload(view, page = 0) {
	const all = view.queue ?? [];
	const per = 15;
	const pages = Math.max(1, Math.ceil(all.length / per));
	const p = Math.min(Math.max(0, page), pages - 1);
	const lines = all.slice(p * per, p * per + per).map((t, i) => {
		const n = p * per + i;
		const mark = n === view.index ? '▶️' : n < view.index ? '✓' : `${n - view.index}.`;
		return `\`${mark}\` ${t.title.slice(0, 70)}${t.durationMs ? ` · ${clock(t.durationMs)}` : ''}${t.error ? ' ⚠️' : ''}`;
	});
	const remaining = (view.upcoming ?? []).reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
	return new EmbedBuilder().setColor(0xff9628).setTitle(`File d’attente (${all.length})`)
		.setDescription(lines.join('\n') || 'La file est vide.')
		.setFooter({ text: `Page ${p + 1}/${pages} · reste ${clock(remaining)}` });
}
