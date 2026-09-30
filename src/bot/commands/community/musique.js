import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError, ValidationError } from '../../../core/errors.js';
import { FILTERS, SPEEDS } from '../../../core/music/index.js';
import { musicContext, playOrPick } from '../../components/music.js';
import { clock, queuePayload, musicPayload } from '../../musicUi.js';

export const data = new SlashCommandBuilder()
	.setName('musique')
	.setDescription('Musique en vocal : YouTube, Spotify, SoundCloud…')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('jouer').setDescription('Jouer un titre ou une playlist (lien ou recherche)')
		.addStringOption(o => o.setName('recherche').setDescription('Lien YouTube / Spotify / SoundCloud, ou titre à chercher').setRequired(true).setAutocomplete(true).setMaxLength(300))
		.addStringOption(o => o.setName('quand').setDescription('Où le mettre dans la file').addChoices(
			{ name: 'À la fin de la file', value: 'end' },
			{ name: 'Juste après le titre en cours', value: 'next' },
			{ name: 'Maintenant', value: 'now' },
		)))
	.addSubcommand(s => s.setName('pause').setDescription('Mettre en pause ou reprendre'))
	.addSubcommand(s => s.setName('passer').setDescription('Passer au titre suivant')
		.addIntegerOption(o => o.setName('nombre').setDescription('Combien de titres passer').setMinValue(1).setMaxValue(100)))
	.addSubcommand(s => s.setName('precedent').setDescription('Titre précédent (ou revenir au début du titre)'))
	.addSubcommand(s => s.setName('stop').setDescription('Arrêter la musique et quitter le vocal'))
	.addSubcommand(s => s.setName('file').setDescription('Voir la file d’attente')
		.addIntegerOption(o => o.setName('page').setDescription('Page').setMinValue(1)))
	.addSubcommand(s => s.setName('maintenant').setDescription('Ce qui passe en ce moment'))
	.addSubcommand(s => s.setName('volume').setDescription('Régler le volume')
		.addIntegerOption(o => o.setName('niveau').setDescription('0 à 200 %').setRequired(true).setMinValue(0).setMaxValue(200)))
	.addSubcommand(s => s.setName('vitesse').setDescription('Vitesse de lecture')
		.addNumberOption(o => o.setName('valeur').setDescription('Vitesse').setRequired(true).addChoices(...SPEEDS.map(v => ({ name: `×${v}`, value: v })))))
	.addSubcommand(s => s.setName('aller').setDescription('Aller à un moment du titre')
		.addStringOption(o => o.setName('position').setDescription('Ex : 1:30, 90, +30, -10').setRequired(true).setMaxLength(12)))
	.addSubcommand(s => s.setName('boucle').setDescription('Répéter le titre ou la file')
		.addStringOption(o => o.setName('mode').setDescription('Mode').setRequired(true).addChoices(
			{ name: 'Non', value: 'off' }, { name: 'Le titre', value: 'track' }, { name: 'Toute la file', value: 'queue' },
		)))
	.addSubcommand(s => s.setName('melanger').setDescription('Mélanger la suite de la file'))
	.addSubcommand(s => s.setName('filtre').setDescription('Effets audio (réappliquer un effet l’enlève)')
		.addStringOption(o => o.setName('effet').setDescription('Effet').setRequired(true).addChoices(
			{ name: 'Aucun (tout enlever)', value: 'none' },
			...Object.entries(FILTERS).map(([value, name]) => ({ name, value })),
		)))
	.addSubcommand(s => s.setName('retirer').setDescription('Retirer un titre de la file')
		.addIntegerOption(o => o.setName('numero').setDescription('Numéro dans « À suivre » (1 = le prochain)').setRequired(true).setMinValue(1)))
	.addSubcommand(s => s.setName('deplacer').setDescription('Changer l’ordre de la file')
		.addIntegerOption(o => o.setName('numero').setDescription('Numéro dans « À suivre »').setRequired(true).setMinValue(1))
		.addIntegerOption(o => o.setName('vers').setDescription('Nouvelle place dans « À suivre »').setRequired(true).setMinValue(1)))
	.addSubcommand(s => s.setName('sauter').setDescription('Aller directement à un titre de la file')
		.addIntegerOption(o => o.setName('numero').setDescription('Numéro dans « À suivre »').setRequired(true).setMinValue(1)))
	.addSubcommand(s => s.setName('vider').setDescription('Vider la suite de la file'))
	.addSubcommandGroup(g => g.setName('playlist').setDescription('Playlists enregistrées')
		.addSubcommand(s => s.setName('jouer').setDescription('Lancer une playlist')
			.addStringOption(o => o.setName('nom').setDescription('Playlist').setRequired(true).setAutocomplete(true))
			.addBooleanOption(o => o.setName('melanger').setDescription('Dans le désordre'))
			.addStringOption(o => o.setName('quand').setDescription('Où la mettre dans la file').addChoices(
				{ name: 'À la fin de la file', value: 'end' },
				{ name: 'Juste après le titre en cours', value: 'next' },
				{ name: 'Maintenant', value: 'now' },
			)))
		.addSubcommand(s => s.setName('creer').setDescription('Enregistrer la file actuelle en playlist')
			.addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true).setMaxLength(60))
			.addBooleanOption(o => o.setName('privee').setDescription('Visible par toi seulement (sinon partagée)')))
		.addSubcommand(s => s.setName('ajouter').setDescription('Ajouter le titre en cours à une de tes playlists')
			.addStringOption(o => o.setName('nom').setDescription('Playlist').setRequired(true).setAutocomplete(true)))
		.addSubcommand(s => s.setName('liste').setDescription('Tes playlists et celles partagées'))
		.addSubcommand(s => s.setName('supprimer').setDescription('Supprimer une de tes playlists')
			.addStringOption(o => o.setName('nom').setDescription('Playlist').setRequired(true).setAutocomplete(true))));

const URL_LIKE = /^https?:\/\//i;

export async function autocomplete(interaction) {
	if (interaction.options.getSubcommandGroup(false) === 'playlist') {
		const ownOnly = interaction.options.getSubcommand() !== 'jouer';
		const lists = interaction.client.core.music.playlists.suggest(interaction.user.id, interaction.options.getFocused(), { ownOnly });
		return interaction.respond(lists.map(p => ({ name: `${p.name} · ${p.count} titre${p.count > 1 ? 's' : ''}${p.ownerId === interaction.user.id ? '' : ' (partagée)'}`.slice(0, 100), value: String(p.id) })));
	}
	const typed = interaction.options.getFocused().trim();
	if (!typed || URL_LIKE.test(typed) || typed.length < 3) return interaction.respond(typed ? [{ name: typed.slice(0, 100), value: typed.slice(0, 100) }] : []);
	// Discord gives 3 s to answer: past that, the typed text is searched when the command is sent
	const timeout = new Promise(resolve => setTimeout(() => resolve(null), 2500));
	const results = await Promise.race([interaction.client.core.music.search(typed, 5).catch(() => null), timeout]);
	const choices = [{ name: `🔎 ${typed}`.slice(0, 100), value: typed.slice(0, 100) }];
	for (const r of results ?? []) {
		if (r.url && r.url.length <= 100) choices.push({ name: `${r.title}${r.durationMs ? ` · ${clock(r.durationMs)}` : ''}`.slice(0, 100), value: r.url });
	}
	await interaction.respond(choices.slice(0, 25)).catch(() => undefined);
}

// "1:30", "90", "+30", "-10" -> position in ms (relative to `from` when signed)
export function parsePosition(text, from) {
	const raw = text.trim();
	const sign = raw.startsWith('+') ? 1 : raw.startsWith('-') ? -1 : 0;
	const parts = raw.replace(/^[+-]/, '').split(':').map(Number);
	if (!parts.length || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
	const seconds = parts.reduce((total, n) => total * 60 + n, 0);
	return sign ? Math.max(0, from + sign * seconds * 1000) : seconds * 1000;
}

export async function execute(interaction) {
	const { music, network } = interaction.client.core;
	if (network.find(interaction.guildId)?.status !== 'active') {
		return interaction.reply({ content: 'Ce serveur ne fait pas partie du réseau.', flags: MessageFlags.Ephemeral });
	}
	const group = interaction.options.getSubcommandGroup(false);
	const sub = interaction.options.getSubcommand();
	const guildId = interaction.guildId;
	if (group === 'playlist') return playlistCommand(interaction, sub);
	// A link (or a pick from the suggestions) is played and said publicly; a search first shows its results, privately
	const searching = sub === 'jouer' && !URL_LIKE.test(interaction.options.getString('recherche').trim());
	await interaction.deferReply(sub === 'jouer' && !searching ? {} : { flags: MessageFlags.Ephemeral });
	try {
		const ctx = await musicContext(interaction);
		const state = () => music.state(guildId);
		// Positions shown to people ("À suivre" 1 = next) -> index in the whole queue
		const upcomingIndex = (n) => {
			const s = state();
			if (!s.connected || n > s.upcoming.length) throw new ValidationError(`Il n’y a que ${s.upcoming?.length ?? 0} titre(s) à suivre.`);
			return s.index + n;
		};
		let reply;
		switch (sub) {
		case 'jouer':
			return await interaction.editReply(await playOrPick(interaction, ctx, interaction.options.getString('recherche').trim(), interaction.options.getString('quand') ?? 'end'));
		case 'pause': reply = (await music.pause(ctx, guildId)).paused ? '⏸️ En pause.' : '▶️ Reprise.'; break;
		case 'passer':
			await music.skip(ctx, guildId, interaction.options.getInteger('nombre') ?? 1);
			reply = '⏭️ Titre passé.';
			break;
		case 'precedent':
			await music.previous(ctx, guildId);
			reply = '⏮️ OK.';
			break;
		case 'stop':
			await music.stop(ctx, guildId);
			reply = '⏹️ Musique arrêtée.';
			break;
		case 'file': return await interaction.editReply({ embeds: [queuePayload(state(), (interaction.options.getInteger('page') ?? 1) - 1)] });
		case 'maintenant': {
			const s = state();
			if (!s.connected) throw new ValidationError('Aucune musique en cours.');
			const payload = musicPayload(s);
			return await interaction.editReply({ embeds: payload.embeds });
		}
		case 'volume': reply = `🔊 Volume : ${(await music.setVolume(ctx, guildId, interaction.options.getInteger('niveau'))).volume} %.`; break;
		case 'vitesse': reply = `⏩ Vitesse : ×${(await music.setSpeed(ctx, guildId, interaction.options.getNumber('valeur'))).speed}.`; break;
		case 'aller': {
			const target = parsePosition(interaction.options.getString('position'), state().position ?? 0);
			if (target === null) throw new ValidationError('Position invalide. Exemples : 1:30, 90, +30, -10.');
			await music.seek(ctx, guildId, target);
			reply = `⏩ Direction ${clock(target)}.`;
			break;
		}
		case 'boucle': reply = { off: '🔁 Boucle coupée.', track: '🔂 Le titre se répète.', queue: '🔁 Toute la file se répète.' }[music.setLoop(ctx, guildId, interaction.options.getString('mode')).loop]; break;
		case 'melanger':
			music.shuffle(ctx, guildId);
			reply = '🔀 File mélangée.';
			break;
		case 'filtre': {
			const effect = interaction.options.getString('effet');
			const current = state().filters ?? [];
			const next = effect === 'none' ? [] : current.includes(effect) ? current.filter(f => f !== effect) : [...current, effect];
			const s = await music.setFilters(ctx, guildId, next);
			reply = s.filters.length ? `🎛️ Effets : ${s.filters.map(f => FILTERS[f]).join(', ')}.` : '🎛️ Aucun effet.';
			break;
		}
		case 'retirer': reply = `🗑️ **${(await music.remove(ctx, guildId, upcomingIndex(interaction.options.getInteger('numero')))).removed.title}** retiré.`; break;
		case 'deplacer':
			music.move(ctx, guildId, upcomingIndex(interaction.options.getInteger('numero')), upcomingIndex(interaction.options.getInteger('vers')));
			reply = '↕️ File réorganisée.';
			break;
		case 'sauter':
			await music.jump(ctx, guildId, upcomingIndex(interaction.options.getInteger('numero')));
			reply = '⏭️ OK.';
			break;
		case 'vider':
			music.clear(ctx, guildId);
			reply = '🧹 File vidée (le titre en cours continue).';
			break;
		}
		await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply({ content: `Impossible : ${error.message}` });
	}
}

async function playlistCommand(interaction, sub) {
	const { music } = interaction.client.core;
	const guildId = interaction.guildId;
	await interaction.deferReply(sub === 'jouer' ? {} : { flags: MessageFlags.Ephemeral });
	try {
		const ctx = await musicContext(interaction);
		const id = Number(interaction.options.getString('nom'));
		let reply;
		switch (sub) {
		case 'jouer': {
			const when = interaction.options.getString('quand') ?? 'end';
			const result = await music.playPlaylist(ctx, guildId, id, { shuffle: interaction.options.getBoolean('melanger') ?? false, next: when === 'next', now: when === 'now' });
			reply = `📃 Playlist **${result.playlist.title}** : ${result.tracks.length} titre(s) ajouté(s)${result.truncated ? ' (file pleine, le reste est ignoré)' : ''}.`;
			break;
		}
		case 'creer': {
			const list = music.saveQueue(ctx, guildId, { name: interaction.options.getString('nom'), shared: !interaction.options.getBoolean('privee') });
			reply = `💾 Playlist **${list.name}** enregistrée (${list.count} titres${list.shared ? ', partagée' : ', privée'}).`;
			break;
		}
		case 'ajouter': {
			const list = music.addCurrentTo(ctx, guildId, id);
			reply = `➕ Ajouté à **${list.name}** (${list.count} titres).`;
			break;
		}
		case 'liste': {
			const lists = music.playlists.list(interaction.user.id);
			reply = lists.length
				? lists.slice(0, 25).map(p => `• **${p.name}** · ${p.count} titre${p.count > 1 ? 's' : ''} · ${clock(p.durationMs)}${p.ownerId === interaction.user.id ? (p.shared ? '' : ' · privée') : ` · de <@${p.ownerId}>`}`).join('\n')
				: 'Aucune playlist. Enregistre la file avec `/musique playlist creer` ou le bouton 💾.';
			break;
		}
		case 'supprimer': {
			const list = music.playlists.get(id, interaction.user.id);
			music.playlists.remove(ctx, id);
			reply = `🗑️ Playlist **${list.name}** supprimée.`;
			break;
		}
		}
		await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply({ content: `Impossible : ${error.message}` });
	}
}
