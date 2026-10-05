import { EmbedBuilder } from 'discord.js';
import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('fiche', 'Voir la fiche réseau d’un membre : rangs, serveurs, sanctions')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const user = interaction.options.getUser('membre');
		const info = await interaction.client.core.moderation.userInfo(actor, user.id);
		const created = Math.round(Number((BigInt(user.id) >> 22n) + 1420070400000n) / 1000);
		const here = info.guilds.find(g => g.id === interaction.guildId)?.member;
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 64 }) })
			.addFields(
				{ name: 'Compte créé', value: `<t:${created}:D> (<t:${created}:R>)`, inline: true },
				...(here?.joinedAt ? [{ name: 'Arrivé ici', value: `<t:${Math.round(here.joinedAt / 1000)}:R>`, inline: true }] : []),
				{ name: 'Rangs', value: info.isOwner ? 'Chef du réseau' : info.ranks.map(r => r.name).join(', ') || 'Aucun', inline: true },
				{ name: 'Serveurs du réseau', value: info.guilds.filter(g => g.member).map(g => g.name).join(', ').slice(0, 1024) || 'Aucun' },
				{
					name: 'Sanctions',
					value: `${info.sanctions.total} au total · ${info.sanctions.warns} avertissement(s) actif(s)${info.sanctions.active.length ? ` · **${info.sanctions.active.length} en cours**` : ''}${info.sanctions.banned ? ' · **banni**' : ''}`,
				},
			)
			.setFooter({ text: `ID ${user.id}` });
		if (info.tempRoles.length) {
			embed.addFields({ name: 'Rôles temporaires', value: info.tempRoles.slice(0, 10).map(t => `${t.roleName} · fin <t:${Math.round(t.expiresAt / 1000)}:R>`).join('\n') });
		}
		return { embeds: [embed] };
	});
}
