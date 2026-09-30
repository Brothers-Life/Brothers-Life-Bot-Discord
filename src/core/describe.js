// Turns an audit entry into a log message ({ title, description, fields, color }).
// Kept apart from Discord: the executor builds the actual embed.

const SOURCE_LABELS = { bot: 'Bot', panel: 'Panel', native: 'Discord', system: 'Système' };

const TITLES = {
	'network.bot_joined': 'Bot ajouté sur un serveur',
	'network.bot_left': 'Bot retiré d\'un serveur',
	'network.add': 'Serveur ajouté au réseau',
	'network.remove': 'Serveur retiré du réseau',
	'network.main': 'Serveur principal changé',
	'ranks.create': 'Rang créé',
	'ranks.update': 'Rang modifié',
	'ranks.delete': 'Rang supprimé',
	'ranks.roles': 'Rôles liés à un rang modifiés',
	'ranks.assign': 'Rang attribué',
	'ranks.unassign': 'Rang retiré',
	'ranks.import': 'Rangs importés depuis les rôles du serveur principal',
	'announcements.create': 'Annonce créée',
	'announcements.send': 'Annonce envoyée',
	'announcements.schedule': 'Annonce programmée',
	'announcements.unschedule': 'Programmation d’annonce annulée',
	'announcements.delete': 'Annonce supprimée',
	'panel.login': 'Connexion au panel',
	'panel.login_denied': 'Connexion au panel refusée',
	'panel.logout': 'Déconnexion du panel',
	'panel.session_revoked': 'Session révoquée',
	'logs.route': 'Salon de logs modifié',
	'system.start': 'Bot démarré',
	'system.restart': 'Redémarrage demandé',
	'system.stop': 'Arrêt demandé',
	'system.install': 'Installation d\'une version',
	'system.version_available': 'Nouvelle version disponible',
	'sanctions.ban': 'Bannissement',
	'sanctions.unban': 'Débannissement',
	'sanctions.kick': 'Expulsion',
	'sanctions.timeout': 'Timeout',
	'sanctions.untimeout': 'Fin de timeout',
	'sanctions.warn': 'Avertissement',
	'sanctions.unwarn': 'Avertissement retiré',
	'sanctions.sync': 'Bans synchronisés sur un serveur',
	'automod.trigger': 'Automod déclenché',
	'automod.config': 'Automod reconfiguré',
	'automod.reset': 'Automod : retour au réglage réseau',
	'staff_sync.member': 'Rôles du staff synchronisés',
	'staff_sync.links': 'Rôles liés à un rang sur un serveur',
	'members.role_add': 'Rôle ajouté à un membre',
	'members.role_remove': 'Rôle retiré à un membre',
	'members.nickname': 'Pseudo modifié',
	'tickets.open': 'Ticket ouvert',
	'tickets.claim': 'Ticket pris en charge',
	'tickets.close': 'Ticket fermé',
	'tickets.add_member': 'Membre ajouté à un ticket',
	'tickets.settings': 'Réglages des tickets modifiés',
	'tickets.category': 'Catégorie de tickets enregistrée',
	'tickets.category_delete': 'Catégorie de tickets supprimée',
	'tickets.panel': 'Panneau des tickets publié',
	'tickets.panel_save': 'Panneau de tickets enregistré',
	'tickets.panel_delete': 'Panneau de tickets supprimé',
	'tickets.statuses': 'Statuts des tickets modifiés',
	'tickets.status': 'Statut d’un ticket changé',
	'tickets.priority': 'Priorité d’un ticket changée',
	'tickets.transfer': 'Ticket transféré',
	'tickets.rename': 'Ticket renommé',
	'tickets.remove_member': 'Membre retiré d’un ticket',
	'tickets.reopen': 'Ticket rouvert',
	'tickets.delete': 'Ticket archivé supprimé',
	'tickets.rating': 'Ticket noté',
	'tickets.reply': 'Réponse à un ticket depuis le panel',
	'tickets.note': 'Note interne sur un ticket',
	'sanctions.restrict': 'Membre restreint',
	'sanctions.unrestrict': 'Restriction levée',
	'sanctions.edit': 'Raison d’une sanction modifiée',
	'restrictions.profiles': 'Profils de restriction modifiés',
	'restrictions.repair': 'Rôles de restriction réparés',
	'moderation.clear': 'Messages supprimés (/clear)',
	'moderation.lock': 'Salon verrouillé',
	'moderation.unlock': 'Salon déverrouillé',
	'moderation.lockdown': 'Lockdown du serveur',
	'moderation.unlockdown': 'Fin du lockdown',
	'moderation.slowmode': 'Mode lent réglé',
	'moderation.voice_disconnect': 'Membre déconnecté du vocal',
	'moderation.voice_move': 'Membre déplacé en vocal',
	'moderation.voice_mute': 'Membre rendu muet en vocal',
	'moderation.voice_unmute': 'Parole rendue en vocal',
	'temproles.add': 'Rôle temporaire donné',
	'temproles.extend': 'Rôle temporaire prolongé',
	'temproles.remove': 'Rôle temporaire retiré',
	'temproles.expire': 'Rôle temporaire expiré',
	'onboarding.save': 'Accueil modifié',
	'onboarding.rules_publish': 'Règlement publié',
	'onboarding.rules_accept': 'Règlement accepté',
	'onboarding.boost': 'Nouveau boost',
	'uploads.add': 'Image envoyée depuis le panel',
	'antiraid.config': 'Anti-raid configuré',
	'antiraid.start': 'Mode raid activé',
	'antiraid.end': 'Fin du mode raid',
	'stats.counter_add': 'Salon compteur ajouté',
	'stats.counter_delete': 'Salon compteur supprimé',
	'voice.hub_add': 'Salon « créer un vocal » ajouté',
	'voice.hub_update': 'Salon « créer un vocal » modifié',
	'voice.hub_delete': 'Salon « créer un vocal » supprimé',
	'voice.room_create': 'Vocal personnel créé',
	'voice.room_transfer': 'Vocal personnel transféré',
	'voice.room_close': 'Vocal personnel fermé',
	'messages.create': 'Message dynamique créé',
	'messages.update': 'Message dynamique modifié',
	'messages.publish': 'Message dynamique publié',
	'messages.delete': 'Message dynamique supprimé',
	'changelog.create': 'Entrée de changelog créée',
	'changelog.update': 'Entrée de changelog modifiée',
	'changelog.publish': 'Changelog publié',
	'changelog.delete': 'Entrée de changelog supprimée',
	'polls.create': 'Sondage créé',
	'polls.publish': 'Sondage publié',
	'polls.schedule': 'Sondage programmé',
	'polls.close': 'Sondage terminé',
	'polls.delete': 'Sondage supprimé',
	'giveaways.create': 'Giveaway créé',
	'giveaways.publish': 'Giveaway lancé',
	'giveaways.end': 'Giveaway terminé',
	'giveaways.reroll': 'Giveaway relancé',
	'giveaways.cancel': 'Giveaway annulé',
	'giveaways.delete': 'Giveaway supprimé',
	'giveaways.claim': 'Lot de giveaway réclamé',
	'permissions.profile': 'Profil de permissions modifié',
	'permissions.apply': 'Profils de permissions appliqués',
	'permissions.drift': 'Écart de permissions détecté',
};

const COLORS = {
	'network.bot_left': 'danger',
	'network.remove': 'danger',
	'ranks.delete': 'danger',
	'ranks.unassign': 'warning',
	'panel.login_denied': 'danger',
	'panel.session_revoked': 'warning',
	'system.stop': 'danger',
	'system.restart': 'warning',
	'sanctions.ban': 'danger',
	'sanctions.kick': 'danger',
	'sanctions.timeout': 'warning',
	'sanctions.warn': 'warning',
	'sanctions.unban': 'success',
	'sanctions.untimeout': 'success',
	'sanctions.unwarn': 'success',
	'automod.trigger': 'danger',
	'permissions.drift': 'warning',
};

function actorLabel(actorId) {
	return /^\d{17,20}$/.test(actorId) ? `<@${actorId}>` : actorId;
}

function formatValue(value) {
	if (Array.isArray(value)) return value.length ? value.map(v => `\`${v}\``).join(', ') : '—';
	if (value && typeof value === 'object') return '```json\n' + JSON.stringify(value, null, 1).slice(0, 900) + '\n```';
	return String(value);
}

export function describeAuditEntry(entry) {
	const fields = [{ name: 'Par', value: `${actorLabel(entry.actorId)} (${SOURCE_LABELS[entry.source] ?? entry.source})`, inline: true }];
	if (entry.target) fields.push({ name: 'Cible', value: /^\d{17,20}$/.test(entry.target) && entry.action.startsWith('ranks.') && !entry.action.endsWith('.create') ? `<@${entry.target}> (${entry.target})` : entry.target, inline: true });

	for (const [key, value] of Object.entries(entry.details ?? {})) {
		fields.push({ name: key, value: formatValue(value).slice(0, 1000), inline: typeof value !== 'object' });
	}

	if (entry.results && Object.keys(entry.results).length) {
		const values = Object.values(entry.results);
		const failed = values.filter(r => !r.ok).length;
		fields.push({ name: 'Serveurs', value: failed ? `${values.length - failed}/${values.length} OK, ${failed} en échec` : `${values.length}/${values.length} OK`, inline: true });
	}

	return {
		title: TITLES[entry.action] ?? entry.action,
		fields: fields.slice(0, 25),
		color: COLORS[entry.action] ?? 'info',
		timestamp: entry.at,
		footer: `#${entry.id} · ${entry.action}`,
	};
}
