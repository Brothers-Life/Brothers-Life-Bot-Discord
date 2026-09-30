import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const STATUS = { scheduled: null, live: '🔴 En cours', ended: '⚫ Terminé', cancelled: '❌ Annulé' };

function names(list) {
	if (!list.length) return '—';
	const shown = list.slice(0, 25).map(r => `<@${r.userId}>`).join(' ');
	return list.length > 25 ? `${shown} … et ${list.length - 25} autres` : shown;
}

// Message of an RP event: details, who comes, and the sign-up buttons (customId rpev:<action>:<eventId>)
export function rpEventPayload(e) {
	const ts = Math.floor(e.startsAt / 1000);
	const going = e.rsvps.filter(r => r.status === 'going');
	const maybe = e.rsvps.filter(r => r.status === 'maybe');
	const waiting = e.rsvps.filter(r => r.status === 'waitlist');
	const open = e.status === 'scheduled' || e.status === 'live';
	const embed = new EmbedBuilder()
		.setColor(e.status === 'cancelled' ? 0xed4245 : e.status === 'ended' ? 0x4f545c : 0xff9628)
		.setTitle(`${STATUS[e.status] ? `${STATUS[e.status]} · ` : '📅 '}${e.title}`.slice(0, 256))
		.addFields(
			{ name: 'Quand', value: `<t:${ts}:F>\n<t:${ts}:R> · jusqu’à <t:${Math.floor(e.endsAt / 1000)}:t>`, inline: true },
			...(e.location ? [{ name: 'Lieu', value: e.location, inline: true }] : []),
			{ name: `Participants (${going.length}${e.capacity ? `/${e.capacity}` : ''})`, value: names(going) },
			...(maybe.length ? [{ name: `Peut-être (${maybe.length})`, value: names(maybe) }] : []),
			...(waiting.length ? [{ name: `Liste d’attente (${waiting.length})`, value: names(waiting) }] : []),
		);
	if (e.description) embed.setDescription(e.description.slice(0, 4000));
	if (e.imageUrl) embed.setImage(e.imageUrl);
	const components = open ? [new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`rpev:going:${e.id}`).setLabel(e.capacity && going.length >= e.capacity ? 'Liste d’attente' : 'Je participe').setEmoji('✅').setStyle(ButtonStyle.Success),
		...(e.allowMaybe ? [new ButtonBuilder().setCustomId(`rpev:maybe:${e.id}`).setLabel('Peut-être').setEmoji('🤔').setStyle(ButtonStyle.Secondary)] : []),
		new ButtonBuilder().setCustomId(`rpev:leave:${e.id}`).setLabel('Me désinscrire').setStyle(ButtonStyle.Danger),
	)] : [];
	return { embeds: [embed], components };
}
