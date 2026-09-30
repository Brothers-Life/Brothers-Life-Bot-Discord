import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { fivemPayload } from '../../fivemUi.js';

export const data = new SlashCommandBuilder()
	.setName('fivem')
	.setDescription('Statut d’un serveur FiveM et joueurs connectés')
	.setContexts(InteractionContextType.Guild)
	.addStringOption(o => o.setName('serveur').setDescription('Le serveur (par défaut : le premier)').setAutocomplete(true));

export async function autocomplete(interaction) {
	const typed = interaction.options.getFocused().toLowerCase();
	const servers = interaction.client.core.fivem.list();
	await interaction.respond(servers.filter(s => s.name.toLowerCase().includes(typed)).slice(0, 25).map(s => ({ name: s.name, value: String(s.id) })));
}

export async function execute(interaction) {
	const { fivem } = interaction.client.core;
	const servers = fivem.list();
	const chosen = interaction.options.getString('serveur');
	const server = chosen ? servers.find(s => String(s.id) === chosen) : servers[0];
	if (!server) {
		await interaction.reply({ content: servers.length ? 'Serveur FiveM introuvable.' : 'Aucun serveur FiveM n’est configuré.', flags: MessageFlags.Ephemeral });
		return;
	}
	await interaction.deferReply();
	const fresh = await fivem.fresh(server.id);
	await interaction.editReply(fivemPayload({ server: fresh, status: fresh.status }));
}
