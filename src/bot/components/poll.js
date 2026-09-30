import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';

// customId: poll:<action>:<pollId>[:<optionId>]
export const prefix = 'poll';

export async function execute(interaction) {
	const [, action, rawId, optionId] = interaction.customId.split(':');
	const pollId = Number(rawId);
	const { polls } = interaction.client.core;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		switch (action) {
		case 'vote': {
			const result = await polls.vote(pollId, interaction.user.id, interaction.guildId, [optionId]);
			return await interaction.editReply(result.message);
		}
		case 'select': {
			const result = await polls.vote(pollId, interaction.user.id, interaction.guildId, interaction.values);
			return await interaction.editReply(result.message);
		}
		case 'mine': {
			const poll = polls.get(pollId);
			const mine = poll.results.options.filter(o => polls.voters(pollId, o.id, { own: interaction.user.id }).includes(interaction.user.id));
			return await interaction.editReply(mine.length ? `Ton vote : ${mine.map(o => o.label).join(', ')}` : 'Tu n’as pas encore voté.');
		}
		case 'who': {
			const poll = polls.get(pollId);
			const lines = poll.options.map((o) => {
				const ids = polls.voters(pollId, o.id);
				return `**${o.label}** (${ids.length}) : ${ids.slice(0, 30).map(id => `<@${id}>`).join(' ') || '—'}${ids.length > 30 ? ' …' : ''}`;
			});
			return await interaction.editReply({ content: lines.join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
		}
		}
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(error.message);
	}
}
