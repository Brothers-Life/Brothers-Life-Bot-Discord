import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { actorOf } from '../moderation.js';

// customId: emb:<create|edit>:<id> (forms of /embed)
export const prefix = 'emb';

export async function execute(interaction) {
	const [, action, id] = interaction.customId.split(':');
	const { embedBuilder } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		const value = (key) => interaction.fields.getTextInputValue(key).trim();
		const embed = { title: value('title'), description: value('description'), color: value('color') || '#ff9628', imageUrl: value('image') || null, fields: [] };
		if (action === 'create') {
			const saved = await embedBuilder.save(actor, { payload: { content: value('content'), embeds: [embed], buttons: [] } });
			await embedBuilder.post(actor, saved.id, { guildId: interaction.guildId, channelId: interaction.channelId });
			return await interaction.editReply('✅ Embed posté. Tu peux le modifier avec `/embed modifier` ou dans le panel (plusieurs embeds, boutons).');
		}
		const message = embedBuilder.get(Number(id));
		const embeds = [{ ...message.payload.embeds[0], ...embed }, ...message.payload.embeds.slice(1)];
		await embedBuilder.save(actor, { id: message.id, name: message.name, payload: { ...message.payload, content: value('content'), embeds } });
		await interaction.editReply('✅ Embed modifié.');
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}
