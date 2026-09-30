import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

// Names of the connected players, cut to fit in an embed field
function playerList(list) {
	if (!list.length) return 'Personne pour l’instant.';
	let text = '';
	for (const [i, p] of list.entries()) {
		const line = `\`${String(p.id).padStart(3)}\` ${p.name.replace(/[*_`~|]/g, '')}\n`;
		if (text.length + line.length > 1000) return `${text}… et ${list.length - i} autres`;
		text += line;
	}
	return text;
}

// Status message of a FiveM server (channel message kept up to date, and /fivem)
export function fivemPayload({ server, status }) {
	const online = Boolean(status?.online);
	const embed = new EmbedBuilder()
		.setColor(online ? Number.parseInt(server.config.color.slice(1), 16) : 0xed4245)
		.setTitle(server.name)
		.addFields(
			{ name: 'Statut', value: status ? (online ? '🟢 En ligne' : '🔴 Hors ligne') : '⏳ Vérification…', inline: true },
			{ name: 'Joueurs', value: online ? `**${status.players}** / ${status.max}` : '—', inline: true },
		)
		.setFooter({ text: 'Mis à jour' })
		.setTimestamp(status?.checkedAt ? new Date(status.checkedAt) : new Date());
	if (online && status.hostname && status.hostname !== server.name) embed.setDescription(status.hostname.slice(0, 300));
	if (online && status.onlineSince) embed.addFields({ name: 'En ligne depuis', value: `<t:${Math.floor(status.onlineSince / 1000)}:R>`, inline: true });
	if (online && server.config.showPlayers) embed.addFields({ name: `Connectés (${status.list.length})`, value: playerList(status.list) });
	const components = server.joinCode
		? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Se connecter').setEmoji('🎮').setURL(`https://cfx.re/join/${server.joinCode}`))]
		: [];
	return { embeds: [embed], components };
}
