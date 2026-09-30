import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { queuePayload } from '../musicUi.js';

// customId: mu:<action> (buttons of the now-playing message)
export const prefix = 'mu';

// Who clicks, as the music service needs it: voice channel, roles, rank permissions
export async function musicContext(interaction) {
	const principal = await interaction.client.core.ranks.resolve(interaction.user.id);
	const member = interaction.member;
	return {
		actorId: interaction.user.id,
		source: 'bot',
		guildId: interaction.guildId,
		voiceChannelId: member?.voice?.channelId ?? null,
		textChannelId: interaction.channelId,
		roleIds: member?.roles?.cache ? [...member.roles.cache.keys()] : member?.roles ?? [],
		can: principal.can,
	};
}

export async function execute(interaction) {
	const [, action] = interaction.customId.split(':');
	const { music } = interaction.client.core;
	const guildId = interaction.guildId;
	try {
		const ctx = await musicContext(interaction);
		if (action === 'queue') {
			return await interaction.reply({ embeds: [queuePayload(music.state(guildId))], flags: MessageFlags.Ephemeral });
		}
		const state = music.state(guildId);
		switch (action) {
		case 'prev': await music.previous(ctx, guildId); break;
		case 'toggle': await music.pause(ctx, guildId); break;
		case 'skip': await music.skip(ctx, guildId); break;
		case 'stop': await music.stop(ctx, guildId); break;
		case 'shuffle': music.shuffle(ctx, guildId); break;
		case 'voldown': await music.setVolume(ctx, guildId, (state.volume ?? 100) - 10); break;
		case 'volup': await music.setVolume(ctx, guildId, (state.volume ?? 100) + 10); break;
		case 'loop': music.setLoop(ctx, guildId); break;
		default: return await interaction.reply({ content: 'Bouton inconnu.', flags: MessageFlags.Ephemeral });
		}
		// The message itself is refreshed by the music service
		await interaction.deferUpdate();
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
	}
}
