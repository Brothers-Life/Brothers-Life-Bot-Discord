import { EmbedBuilder } from 'discord.js';
import { ForbiddenError } from '../../../core/errors.js';
import { moderationCommand, runModeration } from '../../moderation.js';

const LABELS = { ban: 'Ban', kick: 'Kick', timeout: 'Timeout', warn: 'Warn' };

export const data = moderationCommand('historique', 'Sanctions d’un membre sur tout le réseau')
	.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true));

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		if (!actor.can('sanctions.view')) throw new ForbiddenError('il te faut la permission de voir les sanctions.');
		const user = interaction.options.getUser('membre');
		const sanctions = interaction.client.core.sanctions.list({ userId: user.id, limit: 15 });
		const lines = sanctions.map((s) => {
			const state = s.revokedAt ? ' · levée' : s.active ? ' · **en cours**' : '';
			return `**#${s.id}** ${LABELS[s.type]} <t:${Math.round(s.createdAt / 1000)}:d>${state} — ${s.reason ?? 'sans raison'}`;
		});
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(`Historique de ${user.username}`)
			.setDescription(lines.join('\n') || 'Aucune sanction.')
			.setFooter({ text: `${sanctions.length} sanction(s) affichée(s)` });
		return { embeds: [embed] };
	});
}
