import type { SeeAlsoLink } from '@/components/app/confirm'

// The four "Rangs et accès" pages, linked from each other
export const RANKS_SEE_ALSO: SeeAlsoLink[] = [
  { to: '/ranks', label: 'Rangs', hint: 'niveaux et permissions du panel' },
  { to: '/staff-roles', label: 'Rôles du staff', hint: 'rôle Discord de chaque rang' },
  { to: '/permissions', label: 'Permissions Discord', hint: 'droits des salons par rang' },
  { to: '/members', label: 'Accès au panel', hint: 'qui a quel rang' },
]

// Pages that publish messages on Discord
export const MESSAGES_SEE_ALSO: SeeAlsoLink[] = [
  { to: '/announcements', label: 'Annonces', hint: 'message unique, programmable, avec pings' },
  { to: '/embeds', label: 'Créateur d’embeds', hint: 'message durable avec boutons, modifiable' },
  { to: '/messages', label: 'Messages dynamiques', hint: 'contenu mis à jour automatiquement' },
  { to: '/changelog', label: 'Changelog', hint: 'notes de mise à jour' },
]

// Pages that keep track of what happened
export const HISTORY_SEE_ALSO: SeeAlsoLink[] = [
  { to: '/events', label: 'Historique Discord', hint: 'tout ce qui se passe sur les serveurs' },
  { to: '/audit', label: 'Actions du staff', hint: 'ce que le staff a fait via le bot et le panel' },
  { to: '/logs', label: 'Salons de logs', hint: 'où ces événements sont envoyés sur Discord' },
]

// Protection pages
export const PROTECTION_SEE_ALSO: SeeAlsoLink[] = [
  { to: '/automod', label: 'Automod', hint: 'messages : spam, liens, mots interdits' },
  { to: '/antiraid', label: 'Anti-raid', hint: 'arrivées en masse, comptes récents' },
  { to: '/antinuke', label: 'Anti-nuke', hint: 'actions destructrices du staff' },
  { to: '/verification', label: 'Vérification', hint: 'bouton ou captcha à l’arrivée' },
]

export const others = (links: SeeAlsoLink[], current: string) => links.filter((l) => l.to !== current)
