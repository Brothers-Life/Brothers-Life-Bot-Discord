import { ChannelType } from 'discord.js';
import { moderationCommand, runModeration } from '../../moderation.js';

export const data = moderationCommand('voc', 'Modération vocale')
	.addSubcommand(s => s.setName('deconnecter').setDescription('Déconnecter un membre du vocal')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
	.addSubcommand(s => s.setName('deplacer').setDescription('Déplacer un membre dans un autre salon vocal')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
		.addChannelOption(o => o.setName('salon').setDescription('Salon vocal').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
	.addSubcommand(s => s.setName('muet').setDescription('Rendre muet (micro coupé côté serveur)')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
	.addSubcommand(s => s.setName('demuet').setDescription('Rendre la parole')
		.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)));

const ACTIONS = { deconnecter: 'disconnect', deplacer: 'move', muet: 'mute', demuet: 'unmute' };
const DONE = { disconnect: 'déconnecté du vocal', move: 'déplacé', mute: 'rendu muet', unmute: 'peut de nouveau parler' };

export async function execute(interaction) {
	await runModeration(interaction, async (actor) => {
		const action = ACTIONS[interaction.options.getSubcommand()];
		const userId = interaction.options.getUser('membre').id;
		const channelId = interaction.options.getChannel('salon')?.id ?? null;
		await interaction.client.core.moderation.voice(actor, { guildId: interaction.guildId, userId, action, channelId });
		return { content: `<@${userId}> ${DONE[action]}${channelId ? ` vers <#${channelId}>` : ''}.`, allowedMentions: { parse: [] } };
	});
}
