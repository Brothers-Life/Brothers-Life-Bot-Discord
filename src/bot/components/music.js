import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { parseSearch } from '../../core/music/platforms.js';
import { addModal, pickPayload, queuePayload, saveModal } from '../musicUi.js';

// customId: mu:<action>[:<extra>] (now-playing message, search results, forms)
export const prefix = 'mu';

const URL_LIKE = /^https?:\/\//i;

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

// A link is played at once; a search shows its results to pick from
export async function playOrPick(interaction, ctx, text, when = 'end', platform = null) {
	const { music } = interaction.client.core;
	if (URL_LIKE.test(text)) {
		const result = await music.play(ctx, interaction.guildId, text, { next: when === 'next', now: when === 'now' });
		const first = result.tracks[0];
		return { content: result.playlist ? `📃 **${result.playlist.title}** : ${result.tracks.length} titre(s) ajouté(s).` : result.startedNow ? `🎶 Lecture de **${first.title}**.` : `➕ **${first.title}** ajouté à la file.`, components: [] };
	}
	const { platform: where, text: query } = parseSearch(text, { platform, fallback: music.config().searchPlatform });
	return pickPayload(await music.search(query, 10, where), query, when, where);
}

export async function execute(interaction) {
	const [, action, extra] = interaction.customId.split(':');
	const { music } = interaction.client.core;
	const guildId = interaction.guildId;
	const privately = (payload) => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
	try {
		const ctx = await musicContext(interaction);
		const state = music.state(guildId);
		switch (action) {
		case 'queue': return await privately({ embeds: [queuePayload(state)] });
		case 'add': return await interaction.showModal(addModal(music.config().searchPlatform));
		case 'save': return await interaction.showModal(saveModal());
		case 'addform': {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			const [platform] = interaction.fields.getStringSelectValues('platform') ?? [];
			return await interaction.editReply(await playOrPick(interaction, ctx, interaction.fields.getTextInputValue('query').trim(), 'end', platform ?? null));
		}
		case 'pick': {
			await interaction.deferUpdate();
			const result = await music.play(ctx, guildId, interaction.values[0], { next: extra === 'next', now: extra === 'now' });
			return await interaction.editReply({ content: result.startedNow ? `🎶 Lecture de **${result.tracks[0].title}**.` : `➕ **${result.tracks[0].title}** ajouté à la file.`, components: [] });
		}
		case 'saveform': {
			const list = music.saveQueue(ctx, guildId, { name: interaction.fields.getTextInputValue('name') });
			return await privately({ content: `💾 Playlist **${list.name}** enregistrée (${list.count} titres). Relance-la avec \`/musique playlist jouer\`.` });
		}
		case 'prev': await music.previous(ctx, guildId); break;
		case 'toggle': await music.pause(ctx, guildId); break;
		case 'skip': await music.skip(ctx, guildId); break;
		case 'stop': await music.stop(ctx, guildId); break;
		case 'shuffle': music.shuffle(ctx, guildId); break;
		case 'voldown': await music.setVolume(ctx, guildId, (state.volume ?? 100) - 10); break;
		case 'volup': await music.setVolume(ctx, guildId, (state.volume ?? 100) + 10); break;
		case 'loop': music.setLoop(ctx, guildId); break;
		case 'filters': await music.setFilters(ctx, guildId, interaction.values); break;
		case 'speed': await music.setSpeed(ctx, guildId, Number(interaction.values[0])); break;
		default: return await privately({ content: 'Bouton inconnu.' });
		}
		// The message itself is refreshed by the music service
		await interaction.deferUpdate();
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		if (interaction.deferred || interaction.replied) await interaction.editReply({ content: error.message, components: [] }).catch(() => undefined);
		else await privately({ content: error.message });
	}
}
