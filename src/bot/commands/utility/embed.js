import { ActionRowBuilder, InteractionContextType, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { AppError } from '../../../core/errors.js';

export const data = new SlashCommandBuilder()
	.setName('embed')
	.setDescription('Créer ou modifier un embed (le panel permet plusieurs embeds et des boutons)')
	.setContexts(InteractionContextType.Guild)
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
	.addSubcommand(s => s.setName('creer').setDescription('Créer un embed et le poster dans ce salon'))
	.addSubcommand(s => s.setName('modifier').setDescription('Modifier un embed déjà posté')
		.addStringOption(o => o.setName('message').setDescription('Message du créateur d’embeds').setRequired(true).setAutocomplete(true)));

// The same form to create and edit (first embed of the message)
export function embedModal(customId, embed = {}, content = '') {
	const input = (id, label, style, value, max, required = false) => {
		const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
		if (value) field.setValue(String(value).slice(0, max));
		return new ActionRowBuilder().addComponents(field);
	};
	return new ModalBuilder().setCustomId(customId).setTitle('Embed').addComponents(
		input('title', 'Titre', TextInputStyle.Short, embed.title, 256),
		input('description', 'Texte', TextInputStyle.Paragraph, embed.description, 4000),
		input('color', 'Couleur (ex : #ff9628)', TextInputStyle.Short, embed.color, 7),
		input('image', 'Image (lien https)', TextInputStyle.Short, embed.imageUrl, 500),
		input('content', 'Message au-dessus de l’embed', TextInputStyle.Paragraph, content, 2000),
	);
}

export async function autocomplete(interaction) {
	const typed = interaction.options.getFocused().toLowerCase();
	const list = interaction.client.core.embedBuilder.list().filter(m => m.guildId === interaction.guildId && m.name.toLowerCase().includes(typed)).slice(0, 25);
	await interaction.respond(list.map(m => ({ name: m.name.slice(0, 100), value: String(m.id) })));
}

export async function execute(interaction) {
	const { embedBuilder } = interaction.client.core;
	try {
		if (interaction.options.getSubcommand() === 'creer') return await interaction.showModal(embedModal('emb:create'));
		const message = embedBuilder.get(Number(interaction.options.getString('message')));
		return await interaction.showModal(embedModal(`emb:edit:${message.id}`, message.payload.embeds[0], message.payload.content));
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
	}
}
