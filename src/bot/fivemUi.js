import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { STATUS_IMAGE_NAME } from '../core/fivem/statusCard.js';
import { normalizeStatusEmbed, statusVars } from '../core/fivem/statusEmbed.js';
import { fillVars } from '../core/cards.js';

const NAME_MAX = 18;
const COLUMNS = 3;
const COLUMN_MAX = 1000;
const LIST_MAX = 4200;
const BAR_LENGTH = 10;
const BLANK_NAME = '​';

function playerLine(player) {
	const clean = player.name.replace(/[*_`~|\\]/g, '').trim() || '?';
	const name = clean.length > NAME_MAX ? `${clean.slice(0, NAME_MAX - 1).trimEnd()}…` : clean;
	return `\`${String(player.id).padStart(3)}\` ${name}`;
}

// The connected players side by side, as much as an embed can hold
function playerFields(list) {
	const title = `👥 Connectés (${list.length})`;
	if (!list.length) return [{ name: title, value: '*Personne pour l’instant.*' }];
	const lines = [];
	let used = 0;
	for (const player of list) {
		const line = playerLine(player);
		if (used + line.length + 1 > LIST_MAX) break;
		lines.push(line);
		used += line.length + 1;
	}
	const count = lines.length <= 5 ? 1 : COLUMNS * Math.ceil(used / (COLUMNS * COLUMN_MAX));
	const perColumn = Math.ceil(lines.length / count);
	const columns = [''];
	let inColumn = 0;
	for (const line of lines) {
		if (inColumn >= perColumn || columns.at(-1).length + line.length + 1 > COLUMN_MAX) {
			columns.push('');
			inColumn = 0;
		}
		columns[columns.length - 1] += `${line}\n`;
		inColumn++;
	}
	const hidden = list.length - lines.length;
	if (hidden) columns[columns.length - 1] += `… et ${hidden} autres`;
	return columns.map((value, i) => ({ name: i ? BLANK_NAME : title, value, inline: columns.length > 1 }));
}

function fillBar(players, max) {
	if (!max) return '';
	const filled = players ? Math.max(1, Math.round(Math.min(players / max, 1) * BAR_LENGTH)) : 0;
	return `\n${'▰'.repeat(filled)}${'▱'.repeat(BAR_LENGTH - filled)}`;
}

function averagePing(list) {
	const pings = list.map(p => p.ping).filter(Number.isFinite);
	return pings.length ? Math.round(pings.reduce((sum, ping) => sum + ping, 0) / pings.length) : null;
}

// Status message of a FiveM server (channel message kept up to date, and /fivem). `image`: PNG of the status, sent as an
// attachment (shown wider than an embed image), which then carries the state and the players count instead of the fields
export function fivemPayload({ server, status, guild = null, image = null }) {
	const settings = normalizeStatusEmbed(server.config.embed);
	const files = image ? [{ attachment: image, name: STATUS_IMAGE_NAME }] : [];
	const components = server.joinCode && settings.button
		? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(settings.buttonLabel).setEmoji('🎮').setURL(`https://cfx.re/join/${server.joinCode}`))]
		: [];
	// Embed turned off: the picture says it all. Without a picture (off, or not drawn) the embed comes back
	if (!settings.enabled && image) return { embeds: [], components, files };

	const online = Boolean(status?.online);
	const maintenance = server.maintenance ?? null;
	const statusText = maintenance ? '🛠️ Maintenance' : status ? (online ? '🟢 En ligne' : '🔴 Hors ligne') : '⏳ Vérification…';
	const ping = online ? averagePing(status.list) : null;
	const vars = statusVars(server, status);
	const embed = new EmbedBuilder()
		.setColor(maintenance ? 0xf0b232 : online ? Number.parseInt(server.config.color.slice(1), 16) : 0xed4245)
		.setTitle(fillVars(settings.title, vars).slice(0, 256))
		.setThumbnail(settings.thumbnail && !image ? guild?.icon ?? null : null);
	if (settings.footer) {
		embed
			.setFooter({ text: ping === null ? 'Mis à jour' : `Ping moyen ${ping} ms · Mis à jour`, iconURL: guild?.icon ?? undefined })
			.setTimestamp(status?.checkedAt ? new Date(status.checkedAt) : new Date());
	}
	if (maintenance) embed.setDescription(`🛠️ **Maintenance en cours**${maintenance.since ? ` depuis <t:${Math.round(maintenance.since / 1000)}:R>` : ''}${maintenance.reason ? `\n${maintenance.reason.slice(0, 300)}` : ''}`);
	else if (settings.description) embed.setDescription(fillVars(settings.description, vars).slice(0, 4000));
	else if (online && status.hostname && status.hostname !== server.name) embed.setDescription(status.hostname.slice(0, 300));
	else if (status && !online) embed.setDescription('Le serveur ne répond pas pour le moment.');
	if (!image && settings.fields) {
		embed.addFields(
			{ name: '📡 Statut', value: statusText, inline: true },
			{ name: '👥 Joueurs', value: online ? `**${status.players}** / ${status.max}${fillBar(status.players, status.max)}` : '—', inline: true },
		);
		if (online && status.onlineSince) embed.addFields({ name: '⏱️ En ligne depuis', value: `<t:${Math.floor(status.onlineSince / 1000)}:R>`, inline: true });
	}
	if (online && server.config.showPlayers) embed.addFields(...playerFields(status.list));
	return { embeds: [embed], components, files };
}
