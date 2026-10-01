import { MessageFlags } from 'discord.js';
import { AppError } from '../../core/errors.js';
import { actorOf } from '../moderation.js';
import { detailPayload } from '../fivemDataUi.js';

// customId: fd:<veh|sanc|sess|inv|eco>:<userId> (buttons of /joueur); permissions checked again on each click
export const prefix = 'fd';

const NEED = { inv: 'fivemdata.inventory', eco: 'fivemdata.economy' };

export async function execute(interaction) {
	const [, part, id] = interaction.customId.split(':');
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		if (NEED[part] && !actor.can(NEED[part])) return await interaction.editReply(`Il te faut la permission ${NEED[part]}.`);
		const sheet = await interaction.client.core.fivemData.player(actor, Number(id));
		await interaction.editReply({ ...detailPayload(sheet, part), allowedMentions: { parse: [] } });
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}
