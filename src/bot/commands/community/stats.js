import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

const PERIODS = [{ name: '7 jours', value: 7 }, { name: '30 jours', value: 30 }, { name: '90 jours', value: 90 }];
const n = value => Number(value ?? 0).toLocaleString('fr-FR');

export const data = new SlashCommandBuilder()
	.setName('stats')
	.setDescription('Statistiques d’activité du serveur')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('serveur').setDescription('Activité du serveur')
		.addIntegerOption(o => o.setName('periode').setDescription('Période').addChoices(...PERIODS)))
	.addSubcommand(s => s.setName('membre').setDescription('Activité d’un membre')
		.addUserOption(o => o.setName('membre').setDescription('Membre (par défaut : toi)'))
		.addIntegerOption(o => o.setName('periode').setDescription('Période').addChoices(...PERIODS)))
	.addSubcommand(s => s.setName('top').setDescription('Les membres les plus actifs')
		.addStringOption(o => o.setName('classement').setDescription('Classement').addChoices({ name: 'Messages', value: 'messages' }, { name: 'Vocal', value: 'voice' }))
		.addIntegerOption(o => o.setName('periode').setDescription('Période').addChoices(...PERIODS)));

export async function execute(interaction) {
	const { stats } = interaction.client.core;
	const days = interaction.options.getInteger('periode') ?? 7;
	const filters = { guildIds: [interaction.guildId], days };
	await interaction.deferReply();
	await stats.flush();
	const embed = new EmbedBuilder().setColor(0xd6a249).setFooter({ text: `${days} derniers jours` });

	switch (interaction.options.getSubcommand()) {
	case 'serveur': {
		const { totals } = await stats.overview(filters);
		embed.setTitle(`Activité de ${interaction.guild.name}`).addFields(
			{ name: 'Messages', value: n(totals.messages), inline: true },
			{ name: 'Heures en vocal', value: n(totals.voiceHours), inline: true },
			{ name: 'Membres actifs', value: n(totals.active), inline: true },
			{ name: 'Arrivées', value: n(totals.joins), inline: true },
			{ name: 'Départs', value: n(totals.leaves), inline: true },
			{ name: 'Membres', value: totals.memberCount !== null ? `${n(totals.memberCount)}${totals.memberGrowth ? ` (${totals.memberGrowth > 0 ? '+' : ''}${n(totals.memberGrowth)})` : ''}` : '—', inline: true },
		);
		break;
	}
	case 'membre': {
		const user = interaction.options.getUser('membre') ?? interaction.user;
		const member = await stats.member(user.id, filters);
		embed.setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 64 }) }).addFields(
			{ name: 'Messages', value: n(member.messages), inline: true },
			{ name: 'Heures en vocal', value: n(member.voiceHours), inline: true },
			{ name: 'Jours actifs', value: `${member.days}/${days}`, inline: true },
			{ name: 'Classement', value: member.messages ? `#${member.rank} en messages` : '—', inline: true },
			{ name: 'Salons préférés', value: member.topChannels.map(c => `<#${c.channelId}> (${n(c.messages)})`).join('\n') || '—' },
		);
		break;
	}
	case 'top': {
		const metric = interaction.options.getString('classement') ?? 'messages';
		const top = await stats.topMembers(filters, { metric, limit: 10 });
		const medals = ['🥇', '🥈', '🥉'];
		embed.setTitle(metric === 'voice' ? 'Les plus présents en vocal' : 'Les plus bavards')
			.setDescription(top.map((m, i) => `${medals[i] ?? `**${i + 1}.**`} <@${m.userId}> · ${metric === 'voice' ? `${n(m.voiceHours)} h` : `${n(m.messages)} messages`}`).join('\n') || 'Pas encore de données.');
		break;
	}
	}
	await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
