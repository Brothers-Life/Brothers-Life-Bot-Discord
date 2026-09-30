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

export type Role = { id: string; name: string; color: string; position: number; editable?: boolean; dangerous?: boolean; permissions?: string }

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

export type SanctionType = 'ban' | 'kick' | 'timeout' | 'warn'

export type GuildResult = { ok: boolean; error?: string; code?: string | number | null; skipped?: string }

export type Sanction = {
  id: number
  type: SanctionType
  userId: string
  userName: string | null
  moderatorId: string
  source: 'bot' | 'panel' | 'native' | 'automod' | 'system'
  originGuildId: string | null
  scope: 'network' | 'local'
  reason: string | null
  createdAt: number
  expiresAt: number | null
  revokedAt: number | null
  revokedBy: string | null
  revokeReason: string | null
  results: Record<string, GuildResult>
  active: boolean
  user: { name: string | null; avatar: string | null } | null
  moderator: { name: string | null; avatar: string | null } | null
}

export type NetworkEvent = {
  id: number
  at: number
  guildId: string
  guildName: string
  category: string
  type: string
  userId: string | null
  actorId: string | null
  channelId: string | null
  summary: string
  details: Record<string, unknown> | null
  user: { name: string | null; avatar: string | null } | null
  actor: { name: string | null; avatar: string | null } | null
}

export type AutomodAction = 'delete' | 'warn' | 'timeout' | 'kick' | 'ban' | 'network_ban'

export type AutomodConfig = {
  enabled: boolean
  exemptRoles: string[]
  exemptChannels: string[]
  spam: { enabled: boolean; maxMessages: number; perSeconds: number; maxDuplicates: number; duplicateSeconds: number; maxMentions: number; action: AutomodAction; timeoutMinutes: number }
  uploads: { enabled: boolean; maxPerMessage: number; maxFiles: number; perSeconds: number; action: AutomodAction; timeoutMinutes: number }
  scam: { enabled: boolean; action: AutomodAction; customDomains: string[]; customPatterns: string[]; blockEveryoneLinks: boolean }
  invites: { enabled: boolean; action: AutomodAction; allowedCodes: string[] }
}

export type AutomodPayload = {
  network: AutomodConfig
  guilds: { id: string; name: string; custom: boolean; config: AutomodConfig }[]
  defaults: AutomodConfig
}

export type PersonProfile = {
  user: DiscordUser | null
  ranks: RankSummary[]
  level: number | null
  isOwner: boolean
  guilds: {
    id: string
    name: string
    isMain: boolean
    member: {
      nickname: string | null
      joinedAt: number
      timeoutUntil: number | null
      roles: { id: string; name: string; color: string; editable: boolean; linkedToRank: boolean }[]
    } | null
  }[]
  sanctions: { total: number; active: { id: number; type: SanctionType; expiresAt: number | null }[]; warns: number; banned: boolean }
}

export type StaffRolesPayload = {
  ranks: RankSummary[]
  guilds: { id: string; name: string; isMain: boolean; links: Record<string, string[]>; roles: Role[] }[]
}

export type Ticket = {
  id: number
  guildId: string
  guildName: string
  number: number
  categoryId: number | null
  channelId: string | null
  openerId: string
  openerName: string | null
  subject: string | null
  status: 'open' | 'closed'
  claimedBy: string | null
  createdAt: number
  closedAt: number | null
  closedBy: string | null
  closeReason: string | null
  hasTranscript?: boolean
  transcript?: string | null
  opener: { name: string | null; avatar: string | null } | null
  claimer: { name: string | null; avatar: string | null } | null
}

export type TicketCategory = {
  id: number
  guildId: string
  name: string
  emoji: string | null
  description: string | null
  parentChannelId: string | null
  rankIds: number[]
  roleIds: string[]
  position: number
}

export type TicketConfig = {
  settings: { guildId: string; panelChannelId: string | null; panelMessageId: string | null; panelTitle: string; panelText: string; maxOpen: number }
  categories: TicketCategory[]
  channels: Channel[]
  categoryChannels: { id: string; name: string }[]
  roles: Role[]
  ranks: RankSummary[]
}

export type DiscordPermission = { key: string; label: string; group: string; ownerOnly: boolean }

export type PermissionsPayload = {
  catalogue: DiscordPermission[]
  profiles: Record<string, { permissions: string[]; updatedAt: number; updatedBy: string }>
  ranks: (RankSummary & { linkedRoles: number })[]
}

export type PermissionRow = {
  rankId: number
  rankName: string
  guildId: string
  guildName: string
  roleId: string
  roleName: string | null
  missing: string[]
  extra: string[]
  editable: boolean
  error?: string
}
