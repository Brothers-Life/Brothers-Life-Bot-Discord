import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

// For everyone: the member who opened the ticket (if the category allows it) and the staff.
// Everything else is in /ticket-staff.
export const data = new SlashCommandBuilder()
	.setName('ticket')
	.setDescription('Ton ticket')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('fermer').setDescription('Fermer le ticket de ce salon')
		.addStringOption(o => o.setName('raison').setDescription('Raison').setMaxLength(200)));

export { execute } from './ticket-staff.js';
