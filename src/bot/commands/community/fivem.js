import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AppError } from '../../../core/errors.js';
import { fivemPayload } from '../../fivemUi.js';
import { actorOf } from '../../moderation.js';

export const data = new SlashCommandBuilder()
	.setName('fivem')
	.setDescription('Serveur FiveM : statut, joueurs connectés, maintenance')
	.setContexts(InteractionContextType.Guild)
	.addSubcommand(s => s.setName('statut').setDescription('Statut d’un serveur FiveM et joueurs connectés')
		.addStringOption(o => o.setName('serveur').setDescription('Le serveur (par défaut : le premier)').setAutocomplete(true)))
	.addSubcommand(s => s.setName('maintenance').setDescription('Lancer ou terminer la maintenance du serveur FiveM (annonce sur Discord)')
		.addStringOption(o => o.setName('action').setDescription('Lancer ou terminer').setRequired(true).addChoices({ name: 'Lancer la maintenance', value: 'on' }, { name: 'Terminer la maintenance', value: 'off' }))
		.addStringOption(o => o.setName('raison').setDescription('Raison affichée dans l’annonce').setMaxLength(300)));

export async function autocomplete(interaction) {
	const typed = interaction.options.getFocused().toLowerCase();
	const servers = interaction.client.core.fivem.list();
	await interaction.respond(servers.filter(s => s.name.toLowerCase().includes(typed)).slice(0, 25).map(s => ({ name: s.name, value: String(s.id) })));
}

async function status(interaction) {
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

async function maintenance(interaction) {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const actor = await actorOf(interaction);
		const active = interaction.options.getString('action') === 'on';
		const result = await interaction.client.core.fivemEvents.setMaintenance(actor, { active, reason: interaction.options.getString('raison') });
		const announced = result.targets ? ` Annonce publiée dans ${result.announced}/${result.targets} salon${result.targets > 1 ? 's' : ''}.` : ' Aucun salon d’annonce n’est réglé (panel → Annonces FiveM).';
		await interaction.editReply(`${active ? '🛠️ Maintenance lancée.' : '✅ Maintenance terminée.'}${announced}`);
	}
	catch (error) {
		if (!(error instanceof AppError)) throw error;
		await interaction.editReply(`Impossible : ${error.message}`);
	}
}

export async function execute(interaction) {
	if (interaction.options.getSubcommand() === 'maintenance') return maintenance(interaction);
	return status(interaction);
}
