import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

function conditions(s) {
	return [
		s.requiredRoleIds.length && `Rôle${s.requiredRoleIds.length > 1 ? (s.requiredMode === 'all' ? 's requis (tous)' : 's requis (un des)') : ' requis'} : ${s.requiredRoleIds.map(id => `<@&${id}>`).join(' ')}`,
		s.blockedRoleIds.length && `Exclus : ${s.blockedRoleIds.map(id => `<@&${id}>`).join(' ')}`,
		s.minAccountAgeDays && `Compte de ${s.minAccountAgeDays} jour(s) minimum`,
		s.minMemberDays && `Sur le serveur depuis ${s.minMemberDays} jour(s)`,
		s.minMessages && `${s.minMessages} messages sur ${s.activityDays} jours`,
		s.minVoiceHours && `${s.minVoiceHours} h de vocal sur ${s.activityDays} jours`,
		s.noActiveSanction && 'Aucune sanction en cours',
		s.noWarnDays && `Aucun avertissement depuis ${s.noWarnDays} jours`,
		s.excludeStaff && 'Staff exclu',
		s.bonusRoles.length && `Bonus : ${s.bonusRoles.map(b => `<@&${b.roleId}> ×${b.entries}`).join(', ')}`,
	].filter(Boolean);
}

export function giveawayPayload({ giveaway: g, participants, winners }, { target } = {}) {
	const ended = g.status === 'ended';
	const cancelled = g.status === 'cancelled';
	const embed = new EmbedBuilder()
		.setColor(cancelled ? 0x8b8b8b : Number.parseInt(g.settings.color.slice(1), 16))
		.setAuthor({ name: cancelled ? '🎁 Giveaway annulé' : ended ? '🎁 Giveaway terminé' : '🎁 Giveaway' })
		.setTitle(g.prize)
		.setDescription([g.description, g.description ? '' : null,
			ended ? `**Gagnant${winners.length > 1 ? 's' : ''} :** ${winners.map(w => `<@${w.userId}>`).join(', ') || 'aucun'}` : null,
			!ended && !cancelled ? `Fin <t:${Math.round(g.endsAt / 1000)}:R> (<t:${Math.round(g.endsAt / 1000)}:f>)` : null,
		].filter(l => l !== null).join('\n'))
		.addFields(
			{ name: 'Gagnants', value: String(g.winnersCount), inline: true },
			{ name: 'Participants', value: String(participants), inline: true },
		)
		.setFooter({ text: `Giveaway #${g.id}` });
	const rules = conditions(g.settings);
	if (rules.length) embed.addFields({ name: 'Conditions', value: rules.map(r => `• ${r}`).join('\n').slice(0, 1024) });
	if (g.settings.image) embed.setImage(g.settings.image);
	const components = !ended && !cancelled
		? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:join:${g.id}`).setLabel('Participer').setEmoji('🎉').setStyle(ButtonStyle.Success))]
		: [];
	const ping = target ? { everyone: '@everyone', here: '@here', roles: target.roleIds.map(id => `<@&${id}>`).join(' '), none: '' }[target.ping] : '';
	return {
		content: ping || null,
		embeds: [embed],
		components,
		allowedMentions: target ? { parse: target.ping === 'everyone' || target.ping === 'here' ? ['everyone'] : [], roles: target.ping === 'roles' ? target.roleIds : [] } : { parse: [] },
	};
}

export function winnersPayload({ giveaway: g, text, userIds }) {
	const components = g.settings.claimMinutes && userIds.length
		? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:claim:${g.id}`).setLabel('Je réclame mon lot').setEmoji('🎁').setStyle(ButtonStyle.Primary))]
		: [];
	return { content: text, components, allowedMentions: { users: userIds } };
}
