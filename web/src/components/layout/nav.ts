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
    ],
  },
  {
    title: 'Staff',
    items: [
      { title: 'Rangs', url: '/ranks', icon: ShieldHalf, permission: 'ranks.view' },
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
