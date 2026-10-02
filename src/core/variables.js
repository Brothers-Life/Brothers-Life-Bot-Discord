import { ForbiddenError } from './errors.js';
import { FIVEM_VARIABLES } from './fivemData.js';
import { accountCreatedAt } from './ticketConfig.js';

const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const FIVEM_TIMEOUT_MS = 4000;

// Variables shared by every message template of the bot (tickets, welcome, announcements, custom commands…).
// Each feature adds its own on top ({number} of a ticket, {inviter} of a welcome…).
export const SERVER_VARIABLES = [
	{ group: 'Serveur', key: 'server', label: 'Nom du serveur' },
	{ group: 'Serveur', key: 'server.icon', label: 'URL de l’icône du serveur' },
	{ group: 'Serveur', key: 'memberCount', label: 'Nombre de membres' },
	{ group: 'Serveur', key: 'boosts', label: 'Nombre de boosts' },
	{ group: 'Serveur', key: 'boost.tier', label: 'Niveau de boost' },
	{ group: 'Date', key: 'date', label: 'Date du jour' },
	{ group: 'Date', key: 'time', label: 'Heure' },
];

export const MEMBER_VARIABLES = [
	{ group: 'Membre', key: 'user', label: 'Mention du membre' },
	{ group: 'Membre', key: 'user.name', label: 'Nom affiché' },
	{ group: 'Membre', key: 'user.username', label: 'Nom d’utilisateur Discord' },
	{ group: 'Membre', key: 'user.id', label: 'ID Discord' },
	{ group: 'Membre', key: 'user.avatar', label: 'URL de l’avatar' },
	{ group: 'Membre', key: 'account.age', label: 'Âge du compte Discord' },
	{ group: 'Membre', key: 'member.since', label: 'Arrivée sur le serveur' },
	{ group: 'Membre', key: 'member.nickname', label: 'Pseudo sur le serveur' },
	{ group: 'Membre', key: 'member.roles', label: 'Rôles du membre' },
];

export function ageText(ms) {
	const days = Math.floor(ms / 86_400_000);
	if (days >= 365) return `${Math.floor(days / 365)} an${days >= 730 ? 's' : ''}`;
	if (days >= 30) return `${Math.floor(days / 30)} mois`;
	return `${days} jour${days > 1 ? 's' : ''}`;
}

// The promise's value, or null after `ms` (the timer never keeps the process alive)
export function withTimeout(promise, ms) {
	let timer;
	const limit = new Promise((resolve) => {
		timer = setTimeout(resolve, ms, null);
		timer.unref?.();
	});
	return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const FIVEM_KEYS = new Set(FIVEM_VARIABLES.map(v => v.key));
const textOf = texts => texts.map(t => (typeof t === 'string' ? t : t ? JSON.stringify(t) : '')).join('\n');

// The {fivem.*} account variables used by the texts ({fivem.players} of the server counters is not one)
export function fivemKeysIn(...texts) {
	return [...new Set([...textOf(texts).matchAll(/\{(fivem\.[\w.]+)\}/g)].map(m => m[1]).filter(k => FIVEM_KEYS.has(k)))];
}

// True when one of the texts uses a FiveM account variable: the FiveM database is only asked then
export function usesFivem(...texts) {
	return fivemKeysIn(...texts).length > 0;
}

// Putting FiveM account data in a message needs the right to see it: no way around fivemdata.view.
// Only the variables added compared to `previous` count, so anyone may still edit the rest of the text.
export function assertFivemAllowed(actor, next, previous = null) {
	if (actor?.can?.('fivemdata.view')) return;
	const before = new Set(fivemKeysIn(previous));
	const added = fivemKeysIn(next).filter(k => !before.has(k));
	if (added.length) throw new ForbiddenError(`Les variables {fivem.*} (${added.map(k => `{${k}}`).join(', ')}) demandent la permission fivemdata.view (voir les fiches joueurs FiveM).`);
}

// fivemVars(discordId) -> { 'fivem.*': … } or null (database off); fivemEnabled() -> boolean
export function createVariables({ executor, fivemVars = async () => null, fivemEnabled = () => false, logger = console, now = Date.now }) {
	const paris = { timeZone: 'Europe/Paris' };
	const day = ms => new Date(ms).toLocaleDateString('fr-FR', paris);

	const service = {
		// {server}, {memberCount}, {date}…
		async server(guildId) {
			const guild = guildId ? await executor.getGuildInfo(guildId).catch(() => null) : null;
			const at = new Date(now());
			return {
				'server': guild?.name ?? '',
				'server.icon': guild?.iconUrl ?? DEFAULT_AVATAR,
				'memberCount': guild?.memberCount ?? '',
				'boosts': guild?.boosts ?? 0,
				'boost.tier': guild?.tier ?? 0,
				'date': day(at),
				'time': at.toLocaleTimeString('fr-FR', { ...paris, hour: '2-digit', minute: '2-digit' }),
			};
		},

		// Server variables + {user.*}, {member.*} and, when asked, {fivem.*} (never blocks more than 4 s)
		async member(guildId, userId, { fivem = false, user: known = null } = {}) {
			const [server, user, member, linked] = await Promise.all([
				service.server(guildId),
				known ?? executor.getUser(userId).catch(() => null),
				guildId ? executor.getMemberInfo(guildId, userId).catch(() => null) : null,
				fivem ? withTimeout(Promise.resolve().then(() => fivemVars(userId)), FIVEM_TIMEOUT_MS).catch((error) => {
					logger.warn('FiveM variables:', error.message);
					return null;
				}) : null,
			]);
			const name = user?.globalName ?? user?.username ?? userId;
			return {
				...server,
				'user': `<@${userId}>`,
				'user.name': name,
				'user.username': user?.username ?? userId,
				'user.id': userId,
				'user.avatar': user?.avatar ?? user?.avatarUrl ?? DEFAULT_AVATAR,
				'account.age': ageText(now() - (user?.createdAt ?? accountCreatedAt(userId))),
				'member.since': member?.joinedAt ? day(member.joinedAt) : 'inconnu',
				'member.nickname': member?.nickname ?? name,
				'member.roles': member?.roles?.map(r => r.name).join(', ') || 'aucun',
				...(linked ?? {}),
			};
		},

		// Groups shown by the panel "Variables" button; FiveM only when its database is set up
		// actor: the FiveM group is only offered to people allowed to see that data
		catalog(scope = 'member', actor = null) {
			const list = scope === 'member' ? [...MEMBER_VARIABLES, ...SERVER_VARIABLES] : SERVER_VARIABLES;
			const groups = new Map();
			for (const v of list) {
				if (!groups.has(v.group)) groups.set(v.group, { title: v.group, items: [] });
				groups.get(v.group).items.push({ key: v.key, label: v.label });
			}
			const out = [...groups.values()];
			if (scope === 'member' && fivemEnabled() && (!actor || actor.can('fivemdata.view'))) {
				out.push({ title: 'Compte FiveM', hint: 'Rempli si le compte Discord du membre est lié en jeu, sinon « inconnu ».', items: FIVEM_VARIABLES });
			}
			return out;
		},
	};
	return service;
}
