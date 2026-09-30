import {
  Gauge,
  Network,
  ShieldHalf,
  Users,
  ScrollText,
  History,
  KeyRound,
  SquareTerminal,
  PackageCheck,
  Gavel,
  Activity,
  ShieldAlert,
  UserSearch,
  Link2,
  LifeBuoy,
  KeySquare,
  Megaphone,
  SquareSlash,
  DoorOpen,
  Siren,
  ChartColumn,
  Headphones,
  MessagesSquare,
  Vote,
  Gift,
  ScrollText as ChangelogIcon,
} from 'lucide-react'

export type NavEntry = {
  title: string
  url: string
  icon: React.ElementType
  // Entry shown only with this permission (null: every panel user)
  permission: string | null
}

export type NavSection = { title: string; items: NavEntry[] }

export const navSections: NavSection[] = [
  {
    title: 'Réseau',
    items: [
      { title: 'Vue d’ensemble', url: '/', icon: Gauge, permission: null },
      { title: 'Serveurs', url: '/network', icon: Network, permission: 'network.view' },
    ],
  },
  {
    title: 'Modération',
    items: [
      { title: 'Sanctions', url: '/sanctions', icon: Gavel, permission: 'sanctions.view' },
      { title: 'Automod', url: '/automod', icon: ShieldAlert, permission: 'automod.view' },
      { title: 'Anti-raid', url: '/antiraid', icon: Siren, permission: 'antiraid.view' },
      { title: 'Tickets', url: '/tickets', icon: LifeBuoy, permission: 'tickets.view' },
      { title: 'Annonces', url: '/announcements', icon: Megaphone, permission: 'announcements.view' },
      { title: 'Commandes', url: '/commands', icon: SquareSlash, permission: null },
    ],
  },
  {
    title: 'Communauté',
    items: [
      { title: 'Accueil', url: '/onboarding', icon: DoorOpen, permission: 'onboarding.view' },
      { title: 'Statistiques', url: '/stats', icon: ChartColumn, permission: 'stats.view' },
      { title: 'Vocaux perso', url: '/voice', icon: Headphones, permission: 'voice.view' },
      { title: 'Sondages', url: '/polls', icon: Vote, permission: 'polls.view' },
      { title: 'Giveaways', url: '/giveaways', icon: Gift, permission: 'giveaways.view' },
      { title: 'Messages dynamiques', url: '/messages', icon: MessagesSquare, permission: 'messages.view' },
      { title: 'Changelog', url: '/changelog', icon: ChangelogIcon, permission: 'changelog.view' },
    ],
  },
  {
    title: 'Staff',
    items: [
      { title: 'Membres du réseau', url: '/people', icon: UserSearch, permission: 'members.view' },
      { title: 'Rangs', url: '/ranks', icon: ShieldHalf, permission: 'ranks.view' },
      { title: 'Rôles du staff', url: '/staff-roles', icon: Link2, permission: 'ranks.view' },
      { title: 'Permissions Discord', url: '/permissions', icon: KeySquare, permission: 'permsync.view' },
      { title: 'Membres du panel', url: '/members', icon: Users, permission: 'ranks.view' },
    ],
  },
  {
    title: 'Suivi',
    items: [
      { title: 'Événements', url: '/events', icon: Activity, permission: 'events.view' },
      { title: 'Salons de logs', url: '/logs', icon: ScrollText, permission: 'logs.manage' },
      { title: 'Journal', url: '/audit', icon: History, permission: 'audit.view' },
      { title: 'Sessions', url: '/sessions', icon: KeyRound, permission: null },
    ],
  },
  {
    title: 'Système',
    items: [
      { title: 'Console', url: '/console', icon: SquareTerminal, permission: 'console.view' },
      { title: 'Versions', url: '/versions', icon: PackageCheck, permission: 'versions.view' },
    ],
  },
]
