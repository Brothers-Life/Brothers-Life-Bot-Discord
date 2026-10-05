// What the panel shows on its "Commandes" page: every slash command and the rank permission it checks.
// Keep in sync with src/bot/commands (a test compares both lists).
// /aide lists a command to someone who has one of its permissions, or to everyone when it has none.
// forMembers: members use it too without any of these permissions (the permissions unlock more).
export const COMMANDS = [
	{ name: 'ban', category: 'Sanctions', description: 'Bannir un membre du réseau (ou de ce serveur), avec une durée', permissions: ['sanctions.ban'] },
	{ name: 'kick', category: 'Sanctions', description: 'Expulser un membre de ce serveur (ou du réseau)', permissions: ['sanctions.kick'] },
	{ name: 'timeout', category: 'Sanctions', description: 'Exclure temporairement un membre (timeout)', permissions: ['sanctions.timeout'] },
	{ name: 'warn', category: 'Sanctions', description: 'Avertir un membre', permissions: ['sanctions.warn'] },
	{ name: 'restreindre', category: 'Sanctions', description: 'Restreindre un membre : muet écrit, muet vocal, pas de vocal…', permissions: ['sanctions.restrict'] },
	{ name: 'unban', category: 'Sanctions', description: 'Débannir un membre', permissions: ['sanctions.revoke'] },
	{ name: 'untimeout', category: 'Sanctions', description: 'Lever le timeout d’un membre', permissions: ['sanctions.revoke'] },
	{ name: 'unwarn', category: 'Sanctions', description: 'Retirer un avertissement', permissions: ['sanctions.revoke'] },
	{ name: 'sanction', category: 'Sanctions', description: 'Sanctionner avec un modèle ; voir, lever (y compris une restriction) ou corriger une sanction', permissions: ['sanctions.view', 'sanctions.revoke', 'sanctions.edit', 'sanctions.warn', 'sanctions.timeout', 'sanctions.kick', 'sanctions.ban', 'sanctions.restrict'] },
	{ name: 'historique', category: 'Sanctions', description: 'Voir les sanctions d’un membre sur tout le réseau', permissions: ['sanctions.view'] },
	{ name: 'clear', category: 'Modération', description: 'Supprimer des messages en masse (filtre membre, texte, bots)', permissions: ['commands.clear'] },
	{ name: 'lock', category: 'Modération', description: 'Verrouiller un salon', permissions: ['commands.lock'] },
	{ name: 'unlock', category: 'Modération', description: 'Déverrouiller un salon', permissions: ['commands.lock'] },
	{ name: 'lockdown', category: 'Modération', description: 'Verrouiller (activer) ou rouvrir (désactiver) tout le serveur', permissions: ['commands.lockdown'] },
	{ name: 'slowmode', category: 'Modération', description: 'Régler le mode lent', permissions: ['commands.slowmode'] },
	{ name: 'role', category: 'Modération', description: 'Donner ou retirer un rôle, éventuellement temporaire', permissions: ['commands.roles'] },
	{ name: 'nick', category: 'Modération', description: 'Changer le pseudo d’un membre', permissions: ['commands.nick'] },
	{ name: 'voc', category: 'Modération', description: 'Déconnecter, déplacer, rendre muet ou rendre la parole en vocal', permissions: ['commands.voice'] },
	{ name: 'fiche', category: 'Modération', description: 'Fiche réseau d’un membre : rangs, serveurs, sanctions', permissions: ['commands.userinfo'] },
	{ name: 'archive', category: 'Modération', description: 'Archiver un salon en page HTML (aussi depuis le panel)', permissions: ['archives.manage'] },
	{ name: 'raid', category: 'Modération', description: 'Activer ou désactiver le mode raid', permissions: ['antiraid.manage'] },
	{ name: 'ticket', category: 'Tickets', description: 'Fermer ton ticket (ou un ticket, pour le staff)', permissions: [] },
	{ name: 'ticket-staff', category: 'Tickets', description: 'Gérer le ticket du salon : ajouter, statut, priorité, transférer, réponses enregistrées, demande de fermeture, rouvrir…', permissions: ['tickets.handle'] },
	{ name: 'musique', category: 'Communauté', description: 'Musique en vocal (YouTube, Spotify…) : jouer, file, volume, vitesse, position, boucle, effets', permissions: ['music.use'], forMembers: true },
	{ name: 'embed', category: 'Communauté', description: 'Créer ou modifier un embed (le panel permet plusieurs embeds et des boutons)', permissions: ['embeds.manage'] },
	{ name: 'info', category: 'Communauté', description: 'Informations : serveur, membre, avatar, rôle, salon, giveaways en cours, bot', permissions: [] },
	{ name: 'aide', category: 'Communauté', description: 'Les commandes que tu peux utiliser', permissions: [] },
	{ name: 'reunion', category: 'Staff', description: 'Réunions du staff : prochaines, présences en direct, démarrer, terminer, notes et tâches', permissions: ['meetings.view', 'meetings.manage'] },
	{ name: 'joueur', category: 'FiveM', description: 'Fiche FiveM d’un joueur : personnages, métier, temps de jeu, véhicules, sanctions', permissions: ['fivemdata.view', 'fivemdata.economy', 'fivemdata.inventory'] },
	{ name: 'stats', category: 'Communauté', description: 'Statistiques du serveur, d’un membre, classements', permissions: [] },
	{ name: 'changelog', category: 'Communauté', description: 'Voir les dernières nouveautés', permissions: [] },
	{ name: 'sondage', category: 'Communauté', description: 'Créer un sondage rapide, fermer un sondage', permissions: ['polls.manage'] },
	{ name: 'giveaway', category: 'Communauté', description: 'Lancer, finir, relancer un giveaway, voir ceux en cours', permissions: ['giveaways.manage'] },
	{ name: 'proposer', category: 'Communauté', description: 'Faire une suggestion (boîtes à suggestions)', permissions: [] },
	{ name: 'bug', category: 'Communauté', description: 'Signaler un bug (boîtes de bugs, y compris les bugs internes du staff)', permissions: [] },
	{ name: 'candidature', category: 'Staff', description: 'Postuler dans le staff', permissions: [] },
	{ name: 'absence', category: 'Staff', description: 'Déclarer, annuler ou terminer une absence ; voir le staff absent (staff)', permissions: ['absences.declare', 'absences.view'] },
	{ name: 'fivem', category: 'FiveM', description: 'Statut d’un serveur FiveM et joueurs connectés', permissions: [] },
	{ name: 'maintenance', category: 'FiveM', description: 'Lancer ou terminer la maintenance du serveur FiveM (annonce sur Discord)', permissions: ['fivemevents.maintenance'] },
	{ name: 'dm', category: 'Messages privés', description: 'Bloquer ou débloquer un membre des MP du bot', permissions: ['dm.manage'] },
	{ name: 'evenements', category: 'Communauté', description: 'Les prochains événements RP', permissions: [] },
	{ name: 'ping', category: 'Divers', description: 'Latence du bot', permissions: [] },
];

// The commands someone may use (for /aide): no permission needed, made for members, or one of its permissions
export function commandsFor(can) {
	return COMMANDS.filter(c => !c.permissions.length || c.forMembers || c.permissions.some(p => can(p)));
}
