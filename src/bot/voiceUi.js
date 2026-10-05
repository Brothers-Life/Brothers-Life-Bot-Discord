import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder } from 'discord.js';
import { formModal } from './forms.js';

const REGION_LABELS = {
	'': 'Automatique', 'rotterdam': 'Europe (Rotterdam)', 'us-east': 'États-Unis Est', 'us-west': 'États-Unis Ouest', 'us-central': 'États-Unis Centre',
	'us-south': 'États-Unis Sud', 'brazil': 'Brésil', 'hongkong': 'Hong Kong', 'india': 'Inde', 'japan': 'Japon', 'russia': 'Russie',
	'singapore': 'Singapour', 'southafrica': 'Afrique du Sud', 'sydney': 'Sydney',
};

// The lock / hide buttons say what a click will do, from the current state of the room
const LOCK = { false: { label: 'Verrouiller', emoji: '🔒' }, true: { label: 'Déverrouiller', emoji: '🔓' } };
const HIDE = { false: { label: 'Cacher', emoji: '👁️' }, true: { label: 'Rendre visible', emoji: '👀' } };

// Control panel posted in the text chat of a personal voice channel
export function roomPanel(channelId, { ownerId, options, state = {} }) {
	const id = action => `voice:${action}:${channelId}`;
	const lock = LOCK[Boolean(state.locked)];
	const hide = HIDE[Boolean(state.hidden)];
	const buttons = [
		options.rename && new ButtonBuilder().setCustomId(id('rename')).setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
		options.limit && new ButtonBuilder().setCustomId(id('limit')).setLabel('Limite').setEmoji('👥').setStyle(ButtonStyle.Secondary),
		options.lock && new ButtonBuilder().setCustomId(id('lock')).setLabel(lock.label).setEmoji(lock.emoji).setStyle(ButtonStyle.Secondary),
		options.hide && new ButtonBuilder().setCustomId(id('hide')).setLabel(hide.label).setEmoji(hide.emoji).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(id('reset')).setLabel('Réinitialiser').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
	].filter(Boolean);
	const moreButtons = [
		options.kick && new ButtonBuilder().setCustomId(id('kick')).setLabel('Expulser').setEmoji('👢').setStyle(ButtonStyle.Danger),
		options.transfer && new ButtonBuilder().setCustomId(id('transfer')).setLabel('Transférer').setEmoji('🔑').setStyle(ButtonStyle.Secondary),
		options.claim && new ButtonBuilder().setCustomId(id('claim')).setLabel('Réclamer').setEmoji('👑').setStyle(ButtonStyle.Success),
		(options.bitrate || options.region) && new ButtonBuilder().setCustomId(id('more')).setLabel('Qualité et région').setEmoji('🎚️').setStyle(ButtonStyle.Secondary),
	].filter(Boolean);
	const rows = [];
	if (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
	if (options.permit) rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(id('permit')).setPlaceholder('✅ Autoriser des membres (même verrouillé)').setMinValues(1).setMaxValues(10)));
	if (options.reject) rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(id('reject')).setPlaceholder('⛔ Bloquer des membres').setMinValues(1).setMaxValues(10)));
	if (moreButtons.length) rows.push(new ActionRowBuilder().addComponents(moreButtons));
	return {
		content: `<@${ownerId}>`,
		embeds: [new EmbedBuilder().setColor(0xd6a249).setTitle('Ton salon vocal').setDescription('Tu en es le propriétaire : règle-le avec les boutons ci-dessous. Il est supprimé quand plus personne n’est dedans, et ses réglages sont gardés pour la prochaine fois.')],
		components: rows,
		allowedMentions: { users: [ownerId] },
	};
}

// Components of a posted control panel (JSON), with the lock / hide buttons matching the new state
export function withRoomState(components, state) {
	const swap = (button) => {
		const action = String(button.custom_id ?? '').split(':')[1];
		const look = action === 'lock' ? LOCK[Boolean(state.locked)] : action === 'hide' ? HIDE[Boolean(state.hidden)] : null;
		return look ? { ...button, label: look.label, emoji: { name: look.emoji } } : button;
	};
	return components.map(row => ({ ...row, components: (row.components ?? []).map(swap) }));
}

export function renameModal(channelId, current) {
	return formModal(`voice:renameform:${channelId}`, 'Renommer le salon', {
		questions: [{ id: 'name', type: 'short', label: 'Nouveau nom', required: true, maxLength: 100, defaultValue: current ?? '' }],
	});
}

export function limitModal(channelId, current) {
	return formModal(`voice:limitform:${channelId}`, 'Limite de membres', {
		questions: [{ id: 'limit', type: 'short', label: 'Nombre de places (0 = illimité)', required: true, maxLength: 2, defaultValue: String(current ?? 0) }],
	});
}

export function userPicker(channelId, action, placeholder) {
	return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`voice:${action}:${channelId}`).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1));
}

export function qualityMenus(channelId, { maxBitrate, options }) {
	const rows = [];
	if (options.bitrate) {
		const choices = [8, 32, 64, 96, 128, 256, 384].filter(k => k * 1000 <= maxBitrate);
		rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`voice:bitrate:${channelId}`).setPlaceholder('Qualité audio')
			.addOptions(choices.map(k => ({ label: `${k} kbps`, value: String(k) })))));
	}
	if (options.region) {
		rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`voice:region:${channelId}`).setPlaceholder('Région du serveur vocal')
			.addOptions(Object.entries(REGION_LABELS).map(([value, label]) => ({ label, value: value || 'auto' })))));
	}
	return rows;
}
