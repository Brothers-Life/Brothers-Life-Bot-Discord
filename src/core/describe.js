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
