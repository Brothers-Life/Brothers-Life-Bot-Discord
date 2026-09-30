export type Me = {
  user: { id: string; username: string | null; avatar: string | null }
  isOwner: boolean
  level: number | null
  permissions: string[]
  ranks: RankSummary[]
  sessionExpiresAt: number
}

export type RankSummary = { id: number; name: string; level: number; color: string | null }

export type Guild = {
  id: string
  name: string
  icon: string | null
  status: 'pending' | 'active' | 'removed'
  isMain: boolean
  botPresent: boolean
  joinedNetworkAt: number | null
  firstSeenAt: number
}

export type Permission = { key: string; label: string; category: string }

export type Rank = RankSummary & {
  permissions: string[]
  roles: { guildId: string; roleId: string }[]
  createdAt: number
  updatedAt: number
}

export type Role = { id: string; name: string; color: string; position: number }

export type RanksPayload = {
  ranks: Rank[]
  permissions: Permission[]
  mainGuildId: string | null
  roles: Role[]
}

export type PanelMember = {
  id: string
  username: string | null
  globalName: string | null
  avatar: string | null
  level: number
  ranks: (RankSummary & { via: 'role' | 'direct'; roleId?: string; addedBy?: string; addedAt?: number })[]
}

export type DiscordUser = { id: string; username: string; globalName: string | null; avatar: string | null }

export type Channel = { id: string; name: string; parent: string | null; canSend: boolean }

export type LogRoute = { category: string; channelId: string; enabled: boolean }

export type LogsPayload = {
  categories: { key: string; label: string }[]
  mainGuildId: string | null
  guilds: { id: string; name: string; isMain: boolean; status: Guild['status']; routes: LogRoute[] }[]
  mirror: LogRoute[]
}

export type AuditEntry = {
  id: number
  at: number
  actorId: string
  actorName?: string | null
  source: 'bot' | 'panel' | 'native' | 'system'
  action: string
  guildId: string | null
  target: string | null
  details: Record<string, unknown> | null
  results: Record<string, unknown> | null
}

export type Session = {
  key: string
  discordId: string
  username: string | null
  avatar: string | null
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  ip: string | null
  userAgent: string | null
  current: boolean
}

export type Overview = {
  bot: {
    ready: boolean
    ping: number
    guilds: number
    uptime: number | null
    user: { id: string; username: string; avatar: string } | null
  }
  app: { version: string; supervised: boolean; startedAt: number; node: string; platform: string; memory: number }
  network: { main: Guild | null; active: number; pending: number; removed: number }
  ranks: number
  recent: AuditEntry[] | null
}

export type ConsoleLine = { id: number; at: number; stream: string; level: string; text: string }

export type Release = {
  version: string
  name: string
  publishedAt: string
  prerelease: boolean
  changelog: string
  schemaVersion: number | null
  compatible: boolean
  restoreBackup: Backup | null
  isCurrent: boolean
}

export type Backup = { file: string; at: number; schemaVersion: number | null; fromVersion: string | null; size: number }

export type InstallState = { version: string; step: string; error?: string; done?: boolean; at: number } | null

export type VersionsPayload = {
  current: { version: string; previous: string | null; managed: boolean }
  schemaVersion: number
  ignored: string | null
  releases: Release[]
  error: { code: string; message: string } | null
  backups: Backup[]
  supervised: boolean
  install: InstallState
}
