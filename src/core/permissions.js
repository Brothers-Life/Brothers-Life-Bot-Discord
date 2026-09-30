// Registry of every permission of the bot. Each feature declares its own at import time;
// the panel builds its rank editor from this list.
const registry = new Map();

export function definePermission(key, { label, category }) {
	if (!/^[a-z]+(\.[a-z_]+)+$/.test(key)) throw new Error(`Invalid permission key: ${key}`);
	registry.set(key, { key, label, category });
}

export function listPermissions() {
	return [...registry.values()];
}

export function isKnownPermission(key) {
	return registry.has(key);
}

definePermission('panel.access', { label: 'Accéder au panel', category: 'Panel' });
definePermission('network.view', { label: 'Voir les serveurs du réseau', category: 'Réseau' });
definePermission('network.manage', { label: 'Gérer le réseau (ajout, retrait, serveur principal)', category: 'Réseau' });
definePermission('ranks.view', { label: 'Voir les rangs et les membres du panel', category: 'Rangs' });
definePermission('ranks.manage', { label: 'Créer, modifier et supprimer des rangs', category: 'Rangs' });
definePermission('members.assign', { label: 'Attribuer des rangs directs', category: 'Rangs' });
definePermission('logs.manage', { label: 'Configurer les salons de logs', category: 'Logs' });
definePermission('audit.view', { label: 'Consulter le journal', category: 'Logs' });
definePermission('sessions.manage', { label: 'Voir et révoquer les sessions des autres', category: 'Panel' });
definePermission('console.view', { label: 'Voir la console', category: 'Système' });
definePermission('console.control', { label: 'Redémarrer et arrêter le bot', category: 'Système' });
definePermission('versions.view', { label: 'Voir les versions', category: 'Système' });
definePermission('versions.install', { label: 'Installer une version, restaurer une sauvegarde', category: 'Système' });

// What a user is allowed to do. The owner (OWNER_ID) implicitly has every permission,
// including the ones added by future features.
export function createPrincipal({ id, isOwner = false, level = 0, permissions = [], ranks = [] }) {
	const granted = new Set(permissions);
	return {
		id,
		isOwner,
		level: isOwner ? Infinity : level,
		ranks,
		permissions: isOwner ? listPermissions().map(p => p.key) : [...granted].sort(),
		can(permission) {
			return isOwner || granted.has(permission);
		},
	};
}

export const SYSTEM = createPrincipal({ id: 'system', isOwner: true });
