import { ChannelType } from 'discord.js';
import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('voc', 'Modérer le vocal : déconnecter, déplacer, couper ou rendre la parole')
	.addSubcommand(s => s.setName('deconnecter').setDescription('Déconnecter un membre du vocal')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
	.addSubcommand(s => s.setName('deplacer').setDescription('Déplacer un membre dans un autre salon vocal')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
		.addChannelOption(o => o.setName('salon').setDescription('Salon vocal').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
	.addSubcommand(s => s.setName('rendre-muet').setDescription('Couper le micro d’un membre (côté serveur)')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
	.addSubcommand(s => s.setName('rendre-parole').setDescription('Rendre la parole à un membre rendu muet')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)));

const ACTIONS = { deconnecter: 'disconnect', deplacer: 'move', 'rendre-muet': 'mute', 'rendre-parole': 'unmute' };
const DONE = { disconnect: 'déconnecté du vocal', move: 'déplacé', mute: 'rendu muet', unmute: 'a de nouveau la parole' };

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const action = ACTIONS[interaction.options.getSubcommand()];
		const userId = interaction.options.getUser('membre').id;
		const channelId = interaction.options.getChannel('salon')?.id ?? null;
		await interaction.client.core.moderation.voice(actor, { guildId: interaction.guildId, userId, action, channelId });
		return { content: `<@${userId}> ${DONE[action]}${channelId ? ` vers <#${channelId}>` : ''}.`, allowedMentions: { parse: [] } };
	});
}
