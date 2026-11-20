import { AttachmentBuilder, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { renderLeaderboard, renderMemberStats, renderServerStats } from '../../../core/statsCards.js';
import logger from '../../../utils/logger.js';

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

const avatarOf = user => user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null;

// Name shown on this server and avatar of each member of a ranking (people who left keep their Discord name)
async function people(interaction, userIds) {
	return await Promise.all(userIds.map(async (id) => {
		const member = interaction.guild.members.cache.get(id);
		const user = member?.user ?? await interaction.client.users.fetch(id).catch(() => null);
		return { name: member?.displayName ?? user?.globalName ?? user?.username ?? 'Membre parti', avatar: avatarOf(user) };
	}));
}

export async function execute(interaction) {
	const { stats } = interaction.client.core;
	const days = interaction.options.getInteger('periode') ?? 7;
	const filters = { guildIds: [interaction.guildId], days };
	await interaction.deferReply();
	await stats.flush();
	// The answer is a picture; the embed stays as the fallback when it cannot be drawn
	const embed = new EmbedBuilder().setColor(0xd6a249).setFooter({ text: `${days} derniers jours` });
	let draw = null;

	switch (interaction.options.getSubcommand()) {
	case 'serveur': {
		const overview = await stats.overview(filters);
		const { totals } = overview;
		embed.setTitle(`Activité de ${interaction.guild.name}`).addFields(
			{ name: 'Messages', value: n(totals.messages), inline: true },
			{ name: 'Heures en vocal', value: n(totals.voiceHours), inline: true },
			{ name: 'Membres actifs', value: n(totals.active), inline: true },
			{ name: 'Arrivées', value: n(totals.joins), inline: true },
			{ name: 'Départs', value: n(totals.leaves), inline: true },
			{ name: 'Membres', value: totals.memberCount !== null ? `${n(totals.memberCount)}${totals.memberGrowth ? ` (${totals.memberGrowth > 0 ? '+' : ''}${n(totals.memberGrowth)})` : ''}` : '—', inline: true },
		);
		draw = () => renderServerStats({
			name: interaction.guild.name,
			icon: interaction.guild.iconURL({ extension: 'png', size: 256 }),
			periodDays: days,
			totals,
			days: overview.days ?? [],
		});
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
		draw = () => renderMemberStats({
			name: interaction.guild.members.cache.get(user.id)?.displayName ?? user.globalName ?? user.username,
			avatar: avatarOf(user),
			messages: member.messages,
			voiceHours: member.voiceHours,
			days: member.days,
			periodDays: days,
			rank: member.rank,
			channels: member.topChannels.map(c => ({ name: interaction.guild.channels.cache.get(c.channelId)?.name ?? 'salon supprimé', messages: c.messages })),
		});
		break;
	}
	case 'top': {
		const metric = interaction.options.getString('classement') ?? 'messages';
		const top = await stats.topMembers(filters, { metric, limit: 10 });
		const medals = ['🥇', '🥈', '🥉'];
		const title = metric === 'voice' ? 'Les plus présents en vocal' : 'Les plus bavards';
		const label = m => (metric === 'voice' ? `${n(m.voiceHours)} h` : `${n(m.messages)} messages`);
		embed.setTitle(title)
			.setDescription(top.map((m, i) => `${medals[i] ?? `**${i + 1}.**`} <@${m.userId}> · ${label(m)}`).join('\n') || 'Pas encore de données.');
		draw = async () => {
			const who = await people(interaction, top.map(m => m.userId));
			return await renderLeaderboard({
				title,
				subtitle: `${interaction.guild.name} · ${days} derniers jours`,
				entries: top.map((m, i) => ({ ...who[i], value: Number(metric === 'voice' ? m.voiceHours : m.messages), label: label(m).replace(/\s/g, ' ') })),
			});
		};
		break;
	}
	}

	const image = await draw?.().catch((error) => {
		logger.warn('Stats picture not drawn:', error.message);
		return null;
	});
	if (image) await interaction.editReply({ files: [new AttachmentBuilder(image, { name: 'statistiques.png' })] });
	else await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
