// What can be logged, type by type, and the ready-made layouts of log channels ("packs").

// Server events (src/bot/eventLog.js): category -> label, and type -> label
export const EVENT_CATEGORIES = {
	messages: 'Messages (modifiés, supprimés, épinglés)',
	members: 'Membres (arrivées, départs, pseudos, avatars, boosts)',
	member_roles: 'Rôles donnés ou retirés aux membres',
	discord_moderation: 'Modération faite sur Discord (bans, expulsions, exclusions, AutoMod)',
	roles: 'Rôles du serveur (créés, modifiés, supprimés)',
	channels: 'Salons (créés, modifiés, supprimés, permissions)',
	threads: 'Fils (créés, modifiés, supprimés)',
	voice: 'Vocal (arrivées, départs, micros coupés, partages d’écran, salons perso)',
	invites: 'Invitations',
	integrations: 'Bots, webhooks et intégrations',
	server: 'Serveur (réglages, émojis, autocollants, événements, règles AutoMod)',
};

export const EVENT_TYPES = {
	messages: {
		message_edit: 'Message modifié',
		message_delete: 'Message supprimé',
		message_bulk_delete: 'Suppression en masse',
		message_pin: 'Message épinglé ou désépinglé',
	},
	members: {
		member_join: 'Arrivée',
		member_leave: 'Départ',
		member_nickname: 'Surnom sur le serveur changé',
		member_avatar: 'Avatar de serveur changé',
		member_username: 'Pseudo ou avatar Discord changé',
		member_boost: 'Boost du serveur',
	},
	member_roles: {
		member_roles_update: 'Rôles d’un membre modifiés',
	},
	discord_moderation: {
		member_ban: 'Bannissement',
		member_unban: 'Débannissement',
		member_kick: 'Expulsion',
		member_timeout: 'Exclusion temporaire (timeout)',
		member_prune: 'Nettoyage des membres inactifs',
		automod_block: 'Message bloqué par l’AutoMod de Discord',
	},
	roles: {
		role_create: 'Rôle créé',
		role_update: 'Rôle modifié',
		role_delete: 'Rôle supprimé',
	},
	channels: {
		channel_create: 'Salon créé',
		channel_update: 'Salon modifié',
		channel_delete: 'Salon supprimé',
		channel_permissions: 'Permissions d’un salon modifiées',
	},
	threads: {
		thread_create: 'Fil créé',
		thread_update: 'Fil modifié (archivé, verrouillé, renommé)',
		thread_delete: 'Fil supprimé',
	},
	voice: {
		voice_join: 'Arrivée en vocal',
		voice_leave: 'Départ du vocal',
		voice_move: 'Changement de salon vocal',
		voice_server_mute: 'Micro coupé ou rendu par la modération',
		voice_server_deaf: 'Son coupé ou rendu par la modération',
		voice_stream: 'Partage d’écran ou caméra',
	},
	invites: {
		invite_create: 'Invitation créée',
		invite_delete: 'Invitation supprimée',
	},
	integrations: {
		bot_add: 'Bot ajouté',
		integration_create: 'Intégration ajoutée',
		integration_update: 'Intégration modifiée',
		integration_delete: 'Intégration retirée',
		webhook_create: 'Webhook créé',
		webhook_update: 'Webhook modifié',
		webhook_delete: 'Webhook supprimé',
	},
	server: {
		guild_update: 'Réglages du serveur modifiés',
		emoji_create: 'Émoji ajouté',
		emoji_update: 'Émoji modifié',
		emoji_delete: 'Émoji supprimé',
		sticker_create: 'Autocollant ajouté',
		sticker_update: 'Autocollant modifié',
		sticker_delete: 'Autocollant supprimé',
		event_create: 'Événement programmé créé',
		event_update: 'Événement programmé modifié',
		event_delete: 'Événement programmé supprimé',
		automod_rule: 'Règle AutoMod créée, modifiée ou supprimée',
	},
};

// Ready-made layouts: channel name -> categories. The channel marked `rest` also gets every
// category not listed (including ones added by later versions of the bot).
export const LOG_PACKS = {
	complet: {
		label: 'Complet',
		hint: 'Un salon par thème, 8 salons',
		channels: [
			{ name: 'logs-messages', categories: ['messages'] },
			{ name: 'logs-membres', categories: ['members', 'member_roles', 'invites'] },
			{ name: 'logs-moderation', categories: ['sanctions', 'discord_moderation', 'automod', 'antiraid', 'moderation', 'temproles', 'fivemevents'] },
			{ name: 'logs-vocal', categories: ['voice'] },
			{ name: 'logs-serveur', categories: ['roles', 'channels', 'threads', 'server', 'integrations', 'permissions'] },
			{ name: 'logs-staff', categories: ['ranks', 'staff_sync', 'tickets', 'recruitment', 'absences', 'dm', 'staffactivity'] },
			{ name: 'logs-communaute', categories: ['announcements', 'polls', 'giveaways', 'feedback', 'rpevents', 'onboarding', 'changelog', 'stream', 'feed', 'fivem', 'customcommands'] },
			{ name: 'logs-bot', categories: ['network', 'panel', 'system', 'logs', 'backups', 'templates'], rest: true },
		],
	},
	compact: {
		label: 'Compact',
		hint: 'Modération, serveur, bot : 3 salons',
		channels: [
			{ name: 'logs-moderation', categories: ['messages', 'sanctions', 'discord_moderation', 'automod', 'antiraid', 'moderation', 'temproles', 'fivemevents'] },
			{ name: 'logs-serveur', categories: ['members', 'member_roles', 'invites', 'voice', 'roles', 'channels', 'threads', 'server', 'integrations', 'permissions'] },
			{ name: 'logs-bot', categories: [], rest: true },
		],
	},
	minimal: {
		label: 'Tout dans un salon',
		hint: 'Un seul salon « logs »',
		channels: [{ name: 'logs', categories: [], rest: true }],
	},
	moderation: {
		label: 'Modération seulement',
		hint: 'Messages, sanctions, AutoMod, anti-raid',
		channels: [{ name: 'logs-moderation', categories: ['messages', 'sanctions', 'discord_moderation', 'automod', 'antiraid', 'moderation'] }],
	},
};
