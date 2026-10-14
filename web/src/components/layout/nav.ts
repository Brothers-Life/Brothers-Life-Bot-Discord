import {
  Gauge,
  CalendarDays,
  Trophy,
  DatabaseBackup,
  Wand2,
  LayoutTemplate,
  Mail,
  Gamepad2,
  Contact,
  Radio,
  Music,
  UserPlus,
  CalendarOff,
  Network,
  ShieldHalf,
  Users,
  ScrollText,
  History,
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
  Radiation,
  ChartColumn,
  Headphones,
  MessagesSquare,
  Vote,
  Gift,
  Lightbulb,
  ScrollText as ChangelogIcon,
  ShieldCheck,
  Hash,
  Braces,
  Shield,
  Users2,
  Sparkles,
  Headset,
  Server,
  Eye,
  Cog,
  Scale,
  CalendarClock,
  Archive,
  Presentation,
  Plug,
  Wrench,
  ShoppingCart,
  Globe,
  Radar,
  Satellite,
  Wallet,
  UsersRound,
  Terminal,
  BellRing,
  ChartPie,
  MapPinned,
  Zap,
  Cpu,
  ShieldEllipsis,
  Search,
  Database,
  MessageSquareShare,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react'

export type NavEntry = {
  title: string
  url: string
  icon: React.ElementType
  // Entry shown only with this permission (null: every panel user)
  permission: string | null
  // Other words the quick search (Ctrl+K) should find it with
  keywords?: string
  // Active only on this exact URL (an overview whose children have entries of their own)
  exact?: boolean
}

export type NavSection = { title: string; icon: React.ElementType; items: NavEntry[] }

// Grouped by what people come to do; each group folds away in the sidebar
export const navSections: NavSection[] = [
  {
    title: 'Réseau',
    icon: Server,
    items: [
      { title: 'Serveurs', url: '/network', icon: Network, permission: 'network.view' },
      { title: 'Modèles de serveur', url: '/templates', icon: LayoutTemplate, permission: 'templates.view' },
      { title: 'Sauvegardes', url: '/backups', icon: DatabaseBackup, permission: 'backups.view', keywords: 'backup restaurer' },
      { title: 'Archives de salons', url: '/archives', icon: Archive, permission: 'archives.view', keywords: 'export sauvegarde html transcript' },
    ],
  },
  {
    title: 'FiveM',
    icon: Gamepad2,
    items: [
      { title: 'FiveM · Statut', url: '/fivem', icon: Gamepad2, permission: 'fivem.view', keywords: 'jeu serveur statut joueurs' },
      { title: 'FiveM · txAdmin et maintenance', url: '/fivem-events', icon: Wrench, permission: 'fivemevents.view', keywords: 'txadmin maintenance redémarrage restart reboot annonce pont bridge' },
      { title: 'FiveM · Base de données', url: '/fivem-players', icon: Contact, permission: 'fivemdata.view', keywords: 'joueur personnage citizen véhicule plaque inventaire argent bdd base métier gang logs staff prison mdt économie activité données' },
      { title: 'Boutique', url: '/tebex', icon: ShoppingCart, permission: 'tebex.view', keywords: 'tebex achat paiement vip remboursement' },
    ],
  },
  {
    title: 'Télémétrie FiveM',
    icon: Radar,
    items: [
      { title: 'Télémétrie · Vue d’ensemble', url: '/telemetry', icon: Radar, permission: 'telemetry.view', exact: true, keywords: 'fivem jeu en ligne tick disponibilité uptime erreurs' },
      { title: 'Télémétrie · Direct', url: '/telemetry/live', icon: Satellite, permission: 'telemetry.view', keywords: 'temps réel live flux connexions morts chat' },
      { title: 'Télémétrie · Joueurs', url: '/telemetry/players', icon: UsersRound, permission: 'telemetry.view', keywords: 'personnage citizenid fiche journal inventaire véhicules comptes liés' },
      { title: 'Télémétrie · Économie', url: '/telemetry/economy', icon: Wallet, permission: 'telemetry.economy', keywords: 'argent masse monétaire inflation banque boutiques achats crypto sociétés' },
      { title: 'Télémétrie · Logs', url: '/telemetry/logs', icon: Terminal, permission: 'telemetry.logs', keywords: 'console chat commandes erreurs' },
      { title: 'Télémétrie · Alertes', url: '/telemetry/alerts', icon: BellRing, permission: 'telemetry.view', keywords: 'anticheat serveur tombé saut d’argent rafale erreurs' },
      { title: 'Télémétrie · Statistiques', url: '/telemetry/stats', icon: ChartPie, permission: 'telemetry.view', keywords: 'affluence métiers gangs tueurs armes causes pic' },
      { title: 'Télémétrie · Carte des morts', url: '/telemetry/deathmap', icon: MapPinned, permission: 'telemetry.view', keywords: 'carte chaleur zones captures' },
      { title: 'Télémétrie · Performances', url: '/telemetry/perf', icon: Zap, permission: 'telemetry.view', keywords: 'fps tick mlo intérieurs zones entités profiler ressources optimiser' },
      { title: 'Télémétrie · Scripts', url: '/telemetry/scripts', icon: Cpu, permission: 'telemetry.view', keywords: 'ressources erreurs hitch ralentissements redémarrages' },
      { title: 'Télémétrie · Suivi staff', url: '/telemetry/staff', icon: UserCog, permission: 'telemetry.view', keywords: 'ban kick tp téléportation qui fait quoi txadmin' },
      { title: 'Télémétrie · Sécurité', url: '/telemetry/security', icon: ShieldEllipsis, permission: 'telemetry.view', keywords: 'actions staff connexions explosions morts' },
      { title: 'Télémétrie · Recherche', url: '/telemetry/search', icon: Search, permission: 'telemetry.view', keywords: 'chercher joueurs logs chat journaux' },
      { title: 'Télémétrie · Base de données', url: '/telemetry/db', icon: Database, permission: 'telemetry.view', keywords: 'tables lignes taille fortunes bans' },
      { title: 'Télémétrie · Annonces en jeu', url: '/telemetry/announce', icon: MessageSquareShare, permission: 'telemetry.announce', keywords: 'message joueurs notification chat' },
      { title: 'Télémétrie · Réglages', url: '/telemetry/settings', icon: SlidersHorizontal, permission: 'telemetry.manage', keywords: 'jeton token ingestion seuils conservation fuseau' },
    ],
  },
  {
    title: 'Modération',
    icon: Shield,
    items: [
      { title: 'Sanctions', url: '/sanctions', icon: Gavel, permission: 'sanctions.view', keywords: 'ban kick timeout warn avertissement expulsion bannissement modèles' },
      { title: 'Appels de sanction', url: '/appeals', icon: Scale, permission: 'appeals.view', keywords: 'appel débannir contester' },
    ],
  },
  {
    title: 'Protection',
    icon: ShieldCheck,
    items: [
      { title: 'Automod', url: '/automod', icon: ShieldAlert, permission: 'automod.view', keywords: 'spam filtre arnaque invitation' },
      { title: 'Anti-raid', url: '/antiraid', icon: Siren, permission: 'antiraid.view', keywords: 'raid lockdown comptes récents' },
      { title: 'Anti-nuke', url: '/antinuke', icon: Radiation, permission: 'antinuke.view', keywords: 'nuke quarantaine piratage compte staff compromis rôles' },
      { title: 'Vérification', url: '/verification', icon: ShieldCheck, permission: 'verification.view', keywords: 'captcha nouveaux robot' },
    ],
  },
  {
    title: 'Support',
    icon: Headset,
    items: [
      { title: 'Tickets', url: '/tickets', icon: LifeBuoy, permission: 'tickets.view' },
      { title: 'Messages privés', url: '/dms', icon: Mail, permission: 'dm.view', keywords: 'mp dm' },
      { title: 'Suggestions et bugs', url: '/feedback', icon: Lightbulb, permission: null },
    ],
  },
  {
    title: 'Messages',
    icon: Megaphone,
    items: [
      { title: 'Annonces', url: '/announcements', icon: Megaphone, permission: 'announcements.view', keywords: 'programmer' },
      { title: 'Créateur d’embeds', url: '/embeds', icon: Braces, permission: 'embeds.view', keywords: 'embed message boutons' },
      { title: 'Messages dynamiques', url: '/messages', icon: MessagesSquare, permission: 'messages.view' },
      { title: 'Changelog', url: '/changelog', icon: ChangelogIcon, permission: 'changelog.view' },
      { title: 'Streams, vidéos et flux', url: '/streams', icon: Radio, permission: 'notifications.view', keywords: 'twitch youtube kick tiktok rss flux shorts' },
    ],
  },
  {
    title: 'Salons et vocal',
    icon: Hash,
    items: [
      { title: 'Salons automatiques', url: '/channel-features', icon: Hash, permission: 'channelfeatures.view', keywords: 'compteur un mot sticky publication média' },
      { title: 'Horaires des salons', url: '/channel-schedules', icon: CalendarClock, permission: 'schedules.view', keywords: 'ouvrir fermer heure date programmer' },
      { title: 'Musique', url: '/music', icon: Music, permission: 'music.use', keywords: 'youtube spotify playlist' },
      { title: 'Vocaux personnels', url: '/voice', icon: Headphones, permission: 'voice.view', keywords: 'vocaux perso temporaire' },
    ],
  },
  {
    title: 'Commandes',
    icon: SquareSlash,
    items: [
      { title: 'Commandes', url: '/commands', icon: SquareSlash, permission: null, keywords: 'slash' },
      { title: 'Commandes perso', url: '/custom-commands', icon: Wand2, permission: 'customcommands.view' },
    ],
  },
  {
    title: 'Communauté',
    icon: Sparkles,
    items: [
      { title: 'Bienvenue et arrivées', url: '/onboarding', icon: DoorOpen, permission: 'onboarding.view', keywords: 'accueil bienvenue règlement boost départ' },
      { title: 'Statistiques', url: '/stats', icon: ChartColumn, permission: 'stats.view' },
      { title: 'Événements RP', url: '/rp-events', icon: CalendarDays, permission: 'rpevents.view' },
      { title: 'Sondages', url: '/polls', icon: Vote, permission: 'polls.view' },
      { title: 'Giveaways', url: '/giveaways', icon: Gift, permission: 'giveaways.view' },
      { title: 'Page publique', url: '/public-page', icon: Globe, permission: 'public.manage', keywords: 'site vitrine statut règlement équipe lien' },
    ],
  },
  {
    title: 'Rangs et accès',
    icon: KeySquare,
    items: [
      { title: 'Rangs', url: '/ranks', icon: ShieldHalf, permission: 'ranks.view', keywords: 'permissions niveaux' },
      { title: 'Rôles du staff', url: '/staff-roles', icon: Link2, permission: 'ranks.view', keywords: 'rôle discord rang synchronisation' },
      { title: 'Permissions Discord', url: '/permissions', icon: KeySquare, permission: 'permsync.view', keywords: 'droits salons' },
      { title: 'Accès au panel', url: '/members', icon: Users, permission: 'ranks.view', keywords: 'membres du panel rang direct' },
    ],
  },
  {
    title: 'Membres et staff',
    icon: Users2,
    items: [
      { title: 'Membres du réseau', url: '/people', icon: UserSearch, permission: 'members.view', keywords: 'joueur profil fiche' },
      { title: 'Recrutement', url: '/recruitment', icon: UserPlus, permission: 'recruitment.view', keywords: 'candidature' },
      { title: 'Réunions', url: '/meetings', icon: Presentation, permission: 'meetings.view', keywords: 'réu convocation présence staff' },
      { title: 'Absences', url: '/absences', icon: CalendarOff, permission: null },
      { title: 'Activité du staff', url: '/staff-activity', icon: Trophy, permission: 'staffactivity.view' },
    ],
  },
  {
    title: 'Suivi',
    icon: Eye,
    items: [
      { title: 'Historique Discord', url: '/events', icon: Activity, permission: 'events.view', keywords: 'événements historique messages supprimés' },
      { title: 'Actions du staff', url: '/audit', icon: History, permission: 'audit.view', keywords: 'audit journal' },
      { title: 'Salons de logs', url: '/logs', icon: ScrollText, permission: 'logs.manage' },
    ],
  },
  {
    title: 'Système',
    icon: Cog,
    items: [
      { title: 'Console', url: '/console', icon: SquareTerminal, permission: 'console.view' },
      { title: 'Versions', url: '/versions', icon: PackageCheck, permission: 'versions.view', keywords: 'mise à jour' },
      { title: 'API', url: '/developer', icon: Plug, permission: 'api.use', keywords: 'clé token bruno développeur intégration openapi' },
    ],
  },
]

export const homeEntry: NavEntry = { title: 'Vue d’ensemble', url: '/', icon: Gauge, permission: null }
