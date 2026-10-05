import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { limitModal, qualityMenus, renameModal, userPicker, withRoomState } from '../voiceUi.js';
import { errorContent } from '../userError.js';

// customId: voice:<action>:<channelId>
export const prefix = 'voice';

export async function execute(interaction) {
	const [, action, channelId] = interaction.customId.split(':');
	const { voiceRooms } = interaction.client.core;
	const me = interaction.user.id;
	const ephemeral = content => (interaction.deferred || interaction.replied
		? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
		: interaction.reply({ content, flags: MessageFlags.Ephemeral }));
	// The buttons of the control panel say what the next click does (Verrouiller / Déverrouiller…)
	const refreshPanel = async (state) => {
		if (!interaction.message?.components?.length) return;
		const components = withRoomState(interaction.message.components.map(row => row.toJSON?.() ?? row), state);
		await interaction.update({ components }).catch(() => undefined);
	};

	try {
		const room = voiceRooms.getRoom(channelId);
		switch (action) {
		case 'rename':
			if (room.ownerId !== me) return await ephemeral('Seul le propriétaire du salon peut faire ça.');
			return await interaction.showModal(renameModal(channelId, room.state.name));
		case 'renameform':
			await voiceRooms.rename(me, channelId, interaction.fields.getTextInputValue('name'));
			return await ephemeral('Salon renommé (Discord peut mettre quelques minutes si tu le renommes souvent).');
		case 'limit':
			if (room.ownerId !== me) return await ephemeral('Seul le propriétaire du salon peut faire ça.');
			return await interaction.showModal(limitModal(channelId, room.state.userLimit));
		case 'limitform': {
			const limit = Number.parseInt(interaction.fields.getTextInputValue('limit'), 10);
			await voiceRooms.setLimit(me, channelId, Number.isNaN(limit) ? -1 : limit);
			return await ephemeral(limit ? `Limite : ${limit} place(s).` : 'Plus de limite.');
		}
		case 'lock': {
			const updated = await voiceRooms.setLocked(me, channelId, !room.state.locked);
			await refreshPanel(updated.state);
			return await ephemeral(updated.state.locked ? '🔒 Salon verrouillé : seuls les membres autorisés peuvent entrer.' : '🔓 Salon ouvert à tous.');
		}
		case 'hide': {
			const updated = await voiceRooms.setHidden(me, channelId, !room.state.hidden);
			await refreshPanel(updated.state);
			return await ephemeral(updated.state.hidden ? '👁️ Salon caché.' : '👀 Salon visible.');
		}
		case 'reset': {
			const updated = await voiceRooms.reset(me, channelId);
			await refreshPanel(updated?.state ?? voiceRooms.getRoom(channelId).state);
			return await ephemeral('Réglages remis par défaut.');
		}
		case 'permit':
			await voiceRooms.permit(me, channelId, interaction.values);
			return await interaction.reply({ content: `✅ Autorisé : ${interaction.values.map(u => `<@${u}>`).join(', ')}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		case 'reject':
			await voiceRooms.reject(me, channelId, interaction.values);
			return await interaction.reply({ content: `⛔ Bloqué : ${interaction.values.map(u => `<@${u}>`).join(', ')}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		case 'kick':
			if (room.ownerId !== me) return await ephemeral('Seul le propriétaire du salon peut faire ça.');
			return await interaction.reply({ components: [userPicker(channelId, 'kickselect', 'Qui expulser du salon ?')], flags: MessageFlags.Ephemeral });
		case 'kickselect':
			await voiceRooms.kick(me, channelId, interaction.values[0]);
			return await interaction.update({ content: `<@${interaction.values[0]}> a été expulsé du salon.`, components: [], allowedMentions: { parse: [] } });
		case 'transfer':
			if (room.ownerId !== me) return await ephemeral('Seul le propriétaire du salon peut faire ça.');
			return await interaction.reply({ components: [userPicker(channelId, 'transferselect', 'À qui donner le salon ?')], flags: MessageFlags.Ephemeral });
		case 'transferselect':
			await voiceRooms.transfer(me, channelId, interaction.values[0]);
			return await interaction.update({ content: `🔑 <@${interaction.values[0]}> est maintenant propriétaire du salon.`, components: [], allowedMentions: { parse: [] } });
		case 'claim':
			await voiceRooms.claim(me, channelId);
			return await interaction.reply({ content: `👑 <@${me}> est maintenant propriétaire du salon.`, allowedMentions: { parse: [] } });
		case 'more': {
			if (room.ownerId !== me) return await ephemeral('Seul le propriétaire du salon peut faire ça.');
			const hub = voiceRooms.hubs(room.guildId).find(h => h.id === room.hubId);
			return await interaction.reply({
				components: qualityMenus(channelId, { maxBitrate: interaction.guild.maximumBitrate, options: hub?.config.options ?? { bitrate: true, region: true } }),
				flags: MessageFlags.Ephemeral,
			});
		}
		case 'bitrate':
			await voiceRooms.setBitrate(me, channelId, Number(interaction.values[0]));
			return await interaction.update({ content: `Qualité audio : ${interaction.values[0]} kbps.`, components: [] });
		case 'region':
			await voiceRooms.setRegion(me, channelId, interaction.values[0] === 'auto' ? null : interaction.values[0]);
			return await interaction.update({ content: 'Région changée.', components: [] });
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await ephemeral(errorContent(error));
	}
}
