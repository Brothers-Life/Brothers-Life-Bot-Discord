import { EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AppError } from '../core/errors.js';
import { formatDuration, parseDuration } from '../core/duration.js';

const COLORS = { ban: 0xed4245, kick: 0xed4245, timeout: 0xfee75c, warn: 0xfee75c, revoke: 0x57f287 };
const TITLES = { ban: 'Bannissement', kick: 'Expulsion', timeout: 'Timeout', warn: 'Avertissement' };

// Base of every moderation command: guild only, hidden for members without "Moderate Members"
// (server admins can change that in Server settings > Integrations). Ranks decide what is really allowed.
export function moderationCommand(name, description) {
	return new SlashCommandBuilder()
		.setName(name)
		.setDescription(description)
		.setContexts(InteractionContextType.Guild)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
}

export async function actorOf(interaction) {
	const principal = await interaction.client.core.ranks.resolve(interaction.user.id);
	return { ...principal, source: 'bot', can: principal.can };
}

export function durationOption(interaction, name) {
	const raw = interaction.options.getString(name);
	if (!raw) return null;
	const ms = parseDuration(raw);
	if (!ms) throw new AppError('VALIDATION', `Durée invalide : « ${raw} ». Exemples : 30m, 2h, 7j.`);
	return ms;
}

export function scopeOf(interaction) {
	return interaction.options.getBoolean('local') ? 'local' : 'network';
}

export function resultsLine(results) {
	const values = Object.values(results ?? {});
	if (!values.length) return null;
	const failed = values.filter(r => !r.ok).length;
	const skipped = values.filter(r => r.skipped === 'not_member').length;
	const parts = [`${values.length - failed}/${values.length} serveur${values.length > 1 ? 's' : ''}`];
	if (skipped) parts.push(`${skipped} où la personne n’est pas membre`);
	if (failed) parts.push(`${failed} en échec (voir le panel)`);
	return parts.join(' · ');
}

export function sanctionEmbed(sanction, { revoked = false } = {}) {
	const embed = new EmbedBuilder()
		.setColor(revoked ? COLORS.revoke : COLORS[sanction.type])
		.setTitle(`${revoked ? 'Levée : ' : ''}${TITLES[sanction.type]} #${sanction.id}`)
		.addFields(
			{ name: 'Membre', value: `<@${sanction.userId}> (${sanction.userName ?? sanction.userId})`, inline: true },
			{ name: 'Portée', value: sanction.scope === 'network' ? 'Tout le réseau' : 'Ce serveur', inline: true },
		);
	if (sanction.reason) embed.addFields({ name: 'Raison', value: sanction.reason.slice(0, 1000) });
	if (sanction.expiresAt && !revoked) embed.addFields({ name: 'Fin', value: `<t:${Math.round(sanction.expiresAt / 1000)}:R>`, inline: true });
	const line = resultsLine(sanction.results);
	if (line) embed.addFields({ name: 'Appliqué', value: line, inline: true });
	return embed;
}

// Runs a moderation action and answers with the result or a readable error
export async function runModeration(interaction, action) {
	const { core } = interaction.client;
	if (core.network.find(interaction.guildId)?.status !== 'active') {
		return interaction.reply({ content: 'Ce serveur ne fait pas partie du réseau : ajoute-le depuis le panel.', flags: MessageFlags.Ephemeral });
	}
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const reply = await action(await actorOf(interaction));
		await interaction.editReply(reply);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply({ content: `Impossible : ${error.message}` });
	}
}

export { formatDuration };
