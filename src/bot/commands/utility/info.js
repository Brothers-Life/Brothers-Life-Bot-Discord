import { ChannelType, EmbedBuilder, GuildVerificationLevel, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, version as djsVersion } from 'discord.js';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../../../../package.json');
const ts = (ms, style = 'D') => `<t:${Math.round(ms / 1000)}:${style}>`;
const VERIFICATION = { [GuildVerificationLevel.None]: 'Aucune', [GuildVerificationLevel.Low]: 'Faible', [GuildVerificationLevel.Medium]: 'Moyenne', [GuildVerificationLevel.High]: 'Élevée', [GuildVerificationLevel.VeryHigh]: 'Très élevée' };
const CHANNEL_TYPES = { [ChannelType.GuildText]: 'Texte', [ChannelType.GuildVoice]: 'Vocal', [ChannelType.GuildCategory]: 'Catégorie', [ChannelType.GuildAnnouncement]: 'Annonces', [ChannelType.GuildStageVoice]: 'Conférence', [ChannelType.GuildForum]: 'Forum', [ChannelType.PublicThread]: 'Fil public', [ChannelType.PrivateThread]: 'Fil privé', [ChannelType.GuildMedia]: 'Média' };
// The permissions worth showing for a role (the others are everyday ones)
const KEY_PERMISSIONS = {
	Administrator: 'Administrateur', ManageGuild: 'Gérer le serveur', ManageRoles: 'Gérer les rôles', ManageChannels: 'Gérer les salons', BanMembers: 'Bannir',
	KickMembers: 'Expulser', ModerateMembers: 'Exclure (timeout)', ManageMessages: 'Gérer les messages', MentionEveryone: 'Mentionner @everyone', ManageWebhooks: 'Gérer les webhooks', ManageNicknames: 'Gérer les pseudos', MoveMembers: 'Déplacer en vocal', MuteMembers: 'Rendre muet en vocal',
};

export const data = new SlashCommandBuilder()
	.setName('info')
	.setDescription('Informations : serveur, avatar, rôle, salon, bot')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('serveur').setDescription('Informations sur ce serveur')
		.addBooleanOption(o => o.setName('prive').setDescription('Réponse visible par toi seul')))
	.addSubcommand(s => s.setName('avatar').setDescription('Avatar (et bannière) d’un membre en grand')
		.addUserOption(o => o.setName('membre').setDescription('Membre (toi par défaut)'))
		.addBooleanOption(o => o.setName('prive').setDescription('Réponse visible par toi seul')))
	.addSubcommand(s => s.setName('role').setDescription('Informations sur un rôle')
		.addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true))
		.addBooleanOption(o => o.setName('prive').setDescription('Réponse visible par toi seul')))
	.addSubcommand(s => s.setName('salon').setDescription('Informations sur un salon')
		.addChannelOption(o => o.setName('salon').setDescription('Salon (celui-ci par défaut)'))
		.addBooleanOption(o => o.setName('prive').setDescription('Réponse visible par toi seul')))
	.addSubcommand(s => s.setName('bot').setDescription('Informations sur le bot Brothers Life')
		.addBooleanOption(o => o.setName('prive').setDescription('Réponse visible par toi seul')));

async function serverEmbed(guild) {
	const owner = await guild.fetchOwner().catch(() => null);
	const channels = guild.channels.cache;
	const count = type => channels.filter(c => c.type === type).size;
	const bots = guild.members.cache.filter(m => m.user.bot).size;
	const embed = new EmbedBuilder()
		.setColor(0xff9628)
		.setTitle(guild.name)
		.setThumbnail(guild.iconURL({ size: 256 }))
		.addFields(
			{ name: 'Propriétaire', value: owner ? `<@${owner.id}>` : '—', inline: true },
			{ name: 'Créé le', value: `${ts(guild.createdTimestamp)} (${ts(guild.createdTimestamp, 'R')})`, inline: true },
			{ name: 'Membres', value: `${guild.memberCount}${bots ? ` (dont ${bots} bots)` : ''}`, inline: true },
			{ name: 'Boosts', value: `${guild.premiumSubscriptionCount ?? 0} · niveau ${guild.premiumTier}`, inline: true },
			{ name: 'Salons', value: `${count(ChannelType.GuildText) + count(ChannelType.GuildAnnouncement)} texte · ${count(ChannelType.GuildVoice) + count(ChannelType.GuildStageVoice)} vocal · ${count(ChannelType.GuildCategory)} catégories`, inline: true },
			{ name: 'Rôles', value: String(guild.roles.cache.size - 1), inline: true },
			{ name: 'Émojis', value: `${guild.emojis.cache.size} · ${guild.stickers.cache.size} autocollants`, inline: true },
			{ name: 'Vérification', value: VERIFICATION[guild.verificationLevel] ?? '—', inline: true },
			...(guild.vanityURLCode ? [{ name: 'Lien', value: `discord.gg/${guild.vanityURLCode}`, inline: true }] : []),
		)
		.setFooter({ text: `ID ${guild.id}` });
	if (guild.description) embed.setDescription(guild.description);
	if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));
	return embed;
}

async function avatarEmbed(interaction) {
	const user = await (interaction.options.getUser('membre') ?? interaction.user).fetch(true);
	const member = interaction.guild.members.cache.get(user.id) ?? await interaction.guild.members.fetch(user.id).catch(() => null);
	const global = user.displayAvatarURL({ size: 1024 });
	const server = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
	const links = [`[Avatar](${global})`, server ? `[Avatar du serveur](${server})` : null, user.bannerURL() ? `[Bannière](${user.bannerURL({ size: 2048 })})` : null].filter(Boolean);
	const embed = new EmbedBuilder()
		.setColor(user.hexAccentColor ? Number.parseInt(user.hexAccentColor.slice(1), 16) : 0xff9628)
		.setTitle(member?.displayName ?? user.globalName ?? user.username)
		.setDescription(links.join(' · '))
		.setImage(server ?? global);
	if (server) embed.setThumbnail(global);
	return embed;
}

function roleEmbed(role) {
	const keys = Object.entries(KEY_PERMISSIONS).filter(([flag]) => role.permissions.has(PermissionFlagsBits[flag])).map(([, label]) => label);
	return new EmbedBuilder()
		.setColor(role.color || 0x4f545c)
		.setTitle(`@${role.name}`)
		.addFields(
			{ name: 'Membres', value: String(role.members.size), inline: true },
			{ name: 'Couleur', value: role.hexColor === '#000000' ? 'aucune' : role.hexColor, inline: true },
			{ name: 'Position', value: `${role.position} sur ${role.guild.roles.cache.size - 1}`, inline: true },
			{ name: 'Créé le', value: ts(role.createdTimestamp), inline: true },
			{ name: 'Affiché à part', value: role.hoist ? 'oui' : 'non', inline: true },
			{ name: 'Mentionnable', value: role.mentionable ? 'oui' : 'non', inline: true },
			{ name: 'Permissions importantes', value: keys.join(', ') || 'aucune' },
			...(role.managed ? [{ name: 'Géré par', value: role.tags?.botId ? `<@${role.tags.botId}> (rôle d’un bot)` : 'une intégration' }] : []),
		)
		.setThumbnail(role.iconURL?.({ size: 128 }) ?? null)
		.setFooter({ text: `ID ${role.id}` });
}

function channelEmbed(channel) {
	const embed = new EmbedBuilder()
		.setColor(0xff9628)
		.setTitle(`${channel.isVoiceBased?.() ? '🔊' : '#'} ${channel.name}`)
		.addFields(
			{ name: 'Type', value: CHANNEL_TYPES[channel.type] ?? 'Autre', inline: true },
			{ name: 'Catégorie', value: channel.parent?.name ?? 'aucune', inline: true },
			{ name: 'Créé le', value: ts(channel.createdTimestamp), inline: true },
		)
		.setFooter({ text: `ID ${channel.id}` });
	if (channel.topic) embed.setDescription(channel.topic.slice(0, 4000));
	if (channel.rateLimitPerUser) embed.addFields({ name: 'Mode lent', value: `${channel.rateLimitPerUser} s`, inline: true });
	if ('nsfw' in channel && channel.nsfw) embed.addFields({ name: 'NSFW', value: 'oui', inline: true });
	if (channel.isVoiceBased?.()) {
		embed.addFields(
			{ name: 'Connectés', value: `${channel.members.size}${channel.userLimit ? `/${channel.userLimit}` : ''}`, inline: true },
			{ name: 'Débit', value: `${Math.round(channel.bitrate / 1000)} kbps`, inline: true },
		);
	}
	const everyone = channel.permissionOverwrites?.cache.get(channel.guild.id);
	if (everyone?.deny.has(PermissionFlagsBits.ViewChannel)) embed.addFields({ name: 'Visibilité', value: 'privé (caché à @everyone)', inline: true });
	else if (everyone?.deny.has(PermissionFlagsBits.SendMessages)) embed.addFields({ name: 'Écriture', value: 'verrouillée pour @everyone', inline: true });
	return embed;
}

function botEmbed(client) {
	const { network } = client.core;
	const servers = network.list().filter(g => g.status === 'active');
	const uptime = Date.now() - (client.uptime ?? 0);
	const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
	return new EmbedBuilder()
		.setColor(0xff9628)
		.setTitle('Bot Brothers Life')
		.setThumbnail(client.user.displayAvatarURL({ size: 256 }))
		.addFields(
			{ name: 'Version', value: `v${pkg.version}`, inline: true },
			{ name: 'En ligne depuis', value: ts(uptime, 'R'), inline: true },
			{ name: 'Latence', value: `${client.ws.ping} ms`, inline: true },
			{ name: 'Serveurs du réseau', value: `${servers.length} (${client.guilds.cache.size} au total)`, inline: true },
			{ name: 'Membres', value: String(client.guilds.cache.reduce((n, g) => n + g.memberCount, 0)), inline: true },
			{ name: 'Mémoire', value: `${memory} Mo`, inline: true },
			{ name: 'Technique', value: `Node ${process.versions.node} · discord.js ${djsVersion}` },
		);
}

export async function execute(interaction) {
	const ephemeral = interaction.options.getBoolean('prive') ?? false;
	const sub = interaction.options.getSubcommand();
	let embed;
	if (sub === 'serveur') embed = await serverEmbed(interaction.guild);
	else if (sub === 'avatar') embed = await avatarEmbed(interaction);
	else if (sub === 'role') embed = roleEmbed(interaction.options.getRole('role'));
	else if (sub === 'salon') embed = channelEmbed(interaction.options.getChannel('salon') ?? interaction.channel);
	else embed = botEmbed(interaction.client);
	await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
}
