import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const ts = (ms, style = 'R') => (ms ? `<t:${Math.round(ms / 1000)}:${style}>` : '—');
export const hours = s => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)} min`);
const money = n => `${Number(n ?? 0).toLocaleString('fr-FR')} $`;
const SANCTION = { ban: '⛔ Ban', kick: '👢 Kick', warn: '⚠️ Warn', jail: '🔒 Prison', unban: '✅ Déban', unjail: '🔓 Sortie de prison' };

// Main sheet of a player (customId fd:<part>:<userId> for the details)
export function playerPayload(p) {
	const a = p.account;
	const embed = new EmbedBuilder()
		.setColor(p.playtime.online ? 0x3ba55d : 0xff9628)
		.setTitle(`🎮 ${a.username}${p.playtime.online ? ' · 🟢 en jeu' : ''}`)
		.setDescription([
			a.discordId ? `Discord : <@${a.discordId}>` : 'Pas de Discord lié',
			`Temps de jeu : **${hours(p.playtime.totalSeconds)}** (${hours(p.playtime.weekSeconds)} cette semaine) · ${p.playtime.sessions} sessions`,
			`Première connexion : ${ts(p.playtime.firstSeen, 'D')} · dernière : ${ts(p.playtime.lastSessions[0]?.joinedAt)}`,
		].join('\n'))
		.setFooter({ text: `Compte FiveM #${a.userId}` });
	for (const c of p.characters.slice(0, 6)) {
		const lines = [
			c.job ? `💼 ${c.job.label}${c.job.gradeLabel ? ` · ${c.job.gradeLabel}` : ''}${c.job.onDuty ? ' (en service)' : ''}` : null,
			c.gang ? `🏴 ${c.gang.label}${c.gang.gradeLabel ? ` · ${c.gang.gradeLabel}` : ''}` : null,
			c.money ? `💵 ${money(c.money.cash)} · 🏦 ${money(c.money.bank)}` : null,
			c.phone ? `📱 ${c.phone}` : null,
			c.jail ? `🔒 en prison (${c.jail} mois)` : null,
			`Vu ${ts(c.lastUpdated)}`,
		].filter(Boolean);
		embed.addFields({ name: `${c.name} · ${c.citizenId}`, value: lines.join('\n').slice(0, 1024), inline: true });
	}
	const flags = [
		p.bans.length ? `⛔ ${p.bans.length} ban(s) en jeu` : null,
		p.sanctions.length ? `${p.sanctions.length} sanction(s) en jeu` : null,
		p.reports.length ? `${p.reports.length} signalement(s)` : null,
		`${p.vehicles.length} véhicule(s)`,
	].filter(Boolean);
	embed.addFields({ name: 'En bref', value: flags.join(' · ') });
	const button = (part, label, emoji, disabled = false) => new ButtonBuilder().setCustomId(`fd:${part}:${a.userId}`).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
	const row = new ActionRowBuilder().addComponents(
		button('veh', 'Véhicules', '🚗', !p.vehicles.length),
		button('sanc', 'Sanctions', '⚖️', !p.sanctions.length && !p.bans.length),
		button('sess', 'Sessions', '🕒', !p.playtime.lastSessions.length),
		button('inv', 'Inventaire', '🎒', !p.permissions.inventory),
		button('eco', 'Économie', '💰', !p.permissions.economy),
	);
	return { embeds: [embed], components: [row] };
}

// The detail pages behind the buttons
export function detailPayload(p, part) {
	const embed = new EmbedBuilder().setColor(0xff9628);
	if (part === 'veh') {
		embed.setTitle(`🚗 Véhicules de ${p.account.username}`).setDescription(p.vehicles.slice(0, 25).map(v => `**${v.plate}** · ${v.model}${v.nickname ? ` « ${v.nickname} »` : ''} · ${v.state}${v.garage ? ` (${v.garage})` : ''} · ⛽ ${v.fuel ?? '?'} % · moteur ${v.engine} % · ${v.owner}`).join('\n').slice(0, 4000) || 'Aucun.');
	}
	else if (part === 'sanc') {
		const lines = [
			...p.bans.map(b => `⛔ **Ban actif** · ${b.reason ?? 'sans raison'} · par ${b.by ?? '?'} · fin ${b.expire && b.expire < 9e12 ? ts(b.expire, 'f') : 'jamais'}`),
			...p.sanctions.slice(0, 20).map(s => `${SANCTION[s.type] ?? s.type} · ${s.reason || 'sans raison'}${s.durationMinutes ? ` (${s.durationMinutes} min)` : ''} · par ${s.by ?? '?'} · ${ts(s.at, 'd')}`),
		];
		embed.setTitle(`⚖️ Sanctions en jeu de ${p.account.username}`).setDescription(lines.join('\n').slice(0, 4000) || 'Aucune.');
	}
	else if (part === 'sess') {
		embed.setTitle(`🕒 Dernières sessions de ${p.account.username}`).setDescription(p.playtime.lastSessions.slice(0, 20).map(s => `${ts(s.joinedAt, 'f')} → ${s.leftAt ? ts(s.leftAt, 't') : '🟢 en cours'} · ${s.leftAt ? hours((s.leftAt - s.joinedAt) / 1000) : ''}${s.characters.length ? ` · ${s.characters.join(', ')}` : ''}${s.dropReason ? ` · *${s.dropReason.slice(0, 60)}*` : ''}`).join('\n').slice(0, 4000) || 'Aucune.');
	}
	else if (part === 'inv') {
		embed.setTitle(`🎒 Inventaires de ${p.account.username}`);
		for (const c of p.characters.slice(0, 6)) embed.addFields({ name: c.name, value: (c.inventory ?? []).map(i => `${i.name} ×${i.count}`).join(', ').slice(0, 1024) || 'Vide' });
	}
	else if (part === 'eco') {
		const e = p.economy;
		embed.setTitle(`💰 Économie de ${p.account.username}`).setDescription(`Total (cash + banque) : **${money(e.total)}** · points premium : ${e.premium.points} · fidélité : ${e.premium.loyalty}`);
		for (const c of p.characters.slice(0, 6)) embed.addFields({ name: c.name, value: `💵 ${money(c.money?.cash)} · 🏦 ${money(c.money?.bank)}${c.money?.crypto ? ` · ₿ ${c.money.crypto}` : ''}`, inline: true });
		if (e.flows.length) embed.addFields({ name: 'Derniers virements', value: e.flows.slice(0, 10).map(f => `${ts(f.at, 'd')} · ${money(f.amount)} · ${f.from ?? '?'} → ${f.to ?? '?'}${f.note ? ` · ${f.note}` : ''}`).join('\n').slice(0, 1024) });
	}
	return { embeds: [embed] };
}
