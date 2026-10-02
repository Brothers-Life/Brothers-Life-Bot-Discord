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
  inherit: boolean
  syncRoles: boolean
  inherited: { permission: string; from: string }[]
  effectivePermissions: string[]
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

export type DiscordUser = { id: string; username: string; globalName: string | null; avatar: string | null; bot?: boolean; banner?: string | null; accentColor?: string | null }

export type Channel = { id: string; name: string; parent: string | null; canSend: boolean; announcement?: boolean }

export type LogRoute = { category: string; channelId: string; enabled: boolean }

export type LogsPayload = {
  categories: { key: string; label: string; types: { key: string; label: string }[] }[]
  packs: { key: string; label: string; hint: string; channels: string[] }[]
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

export type SanctionType = 'ban' | 'kick' | 'timeout' | 'warn' | 'restrict'

export type RestrictionProfile = { key: string; label: string; deny: string[]; position: number }

export type TempRole = {
  id: number
  guildId: string
  userId: string
  roleId: string
  roleName: string | null
  expiresAt: number
  reason: string | null
  createdBy: string
  createdAt: number
  removedAt: number | null
  removedBy: string | null
}

export type CommandInfo = { name: string; category: string; description: string; permissions: { key: string; label: string }[] }

export type GuildResult = { ok: boolean; error?: string; code?: string | number | null; skipped?: string }

export type Sanction = {
  id: number
  type: SanctionType
  profile?: string | null
  profileLabel?: string | null
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
  invites: { enabled: boolean; action: AutomodAction; allowNetwork: boolean; allowedCodes: string[] }
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
      boostingSince?: number | null
      serverAvatar?: string | null
      pending?: boolean
      color?: string | null
      voice?: { channelId: string; channelName: string | null; muted: boolean; deafened: boolean; streaming: boolean; camera: boolean } | null
      roles: { id: string; name: string; color: string; editable: boolean; linkedToRank: boolean }[]
    } | null
  }[]
  sanctions: { total: number; active: { id: number; type: SanctionType; expiresAt: number | null }[]; warns: number; banned: boolean }
}

export type StaffRolesPayload = {
  ranks: RankSummary[]
  guilds: { id: string; name: string; isMain: boolean; links: Record<string, string[]>; roles: Role[] }[]
}

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export type TicketAnswer = { id: string; label: string; value: string }

export type Ticket = {
  id: number
  guildId: string
  guildName: string
  number: number
  categoryId: number | null
  categoryName: string | null
  categoryEmoji: string | null
  channelId: string | null
  openerId: string
  openerName: string | null
  subject: string | null
  answers: TicketAnswer[]
  status: 'open' | 'closed'
  statusKey: string
  statusHistory: { key: string; by: string; at: number }[]
  priority: TicketPriority
  archived: boolean
  claimedBy: string | null
  createdAt: number
  lastActivityAt: number | null
  closedAt: number | null
  closedBy: string | null
  closeReason: string | null
  rating: number | null
  ratingComment: string | null
  hasTranscript?: boolean
  transcript?: string | null
  opener: { name: string | null; avatar: string | null } | null
  claimer: { name: string | null; avatar: string | null } | null
}

export type TicketMessage = {
  id: string
  ticketId: number
  authorId: string | null
  authorName: string | null
  authorAvatar: string | null
  bot: boolean
  panelUser: string | null
  content: string
  attachments: { name: string; url: string; contentType: string | null; size?: number }[]
  embeds: { title: string | null; description: string | null; color: string | null; fields: { name: string; value: string }[] }[]
  internal: boolean
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
}

export type TicketDetail = Ticket & {
  messages: TicketMessage[]
  statuses: TicketStatus[]
  priorities: { key: TicketPriority; label: string }[]
}

export type FormFieldType = 'short' | 'paragraph' | 'select' | 'user' | 'role' | 'channel' | 'file'

export type FormField = {
  id: string
  type: FormFieldType
  label: string
  description: string
  required: boolean
  placeholder?: string
  minLength?: number
  maxLength?: number
  defaultValue?: string
  options?: { label: string; value: string; description: string; emoji: string }[]
  minValues?: number
  maxValues?: number
}

export type FormStep = { title: string; when: { field: string; equals: string } | null; questions: FormField[] }
export type FormDef = { steps: FormStep[] }

export type TicketHoursDay = { open: boolean; from: string; to: string }

export type TicketCategoryConfig = {
  buttonStyle: 'primary' | 'secondary' | 'success' | 'danger'
  form: FormDef
  nameTemplate: string
  ping: 'staff' | 'none' | 'roles'
  pingRoleIds: string[]
  welcome: { title: string; message: string; color: string; showAnswers: boolean }
  access: {
    requiredRoleIds: string[]
    requiredMode: 'any' | 'all'
    blockedRoleIds: string[]
    maxOpen: number
    cooldownMinutes: number
    minAccountAgeDays: number
    hours: { enabled: boolean; timezone: string; days: TicketHoursDay[]; closedMessage: string }
  }
  claim: { exclusiveWrite: boolean }
  close: { requireReason: boolean; openerCanClose: boolean; confirm: boolean; mode: 'delete' | 'archive'; deleteDelaySeconds: number }
  inactivity: { reminderHours: number; closeHours: number }
  rating: { enabled: boolean }
  transcriptDm: boolean
  statusParents: Record<string, string>
}

export type TicketCategory = {
  id: number
  guildId: string
  name: string
  emoji: string | null
  description: string | null
  parentChannelId: string | null
  transcriptChannelId: string | null
  rankIds: number[]
  roleIds: string[]
  position: number
  config: TicketCategoryConfig
}

export type TicketStatus = { key: string; label: string; emoji: string | null; color: string; parentChannelId: string | null; position: number; builtin: boolean }

export type MessagePayload = { content: string; embed: AnnouncementEmbed }

export type TicketPanel = {
  id: number
  guildId: string
  name: string
  channelId: string | null
  messageId: string | null
  payload: MessagePayload
  style: 'buttons' | 'select'
  placeholder: string | null
  categoryIds: number[]
}

export type TicketConfig = {
  settings: { guildId: string; maxOpen: number; statusPrefix: boolean }
  categories: TicketCategory[]
  panels: TicketPanel[]
  statuses: TicketStatus[]
  channels: Channel[]
  categoryChannels: { id: string; name: string }[]
  roles: Role[]
  ranks: RankSummary[]
  variables: { group: string; key: string; label: string }[]
  fivemVariables: { key: string; label: string }[]
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

export type AnnouncementEmbed = {
  enabled: boolean
  title: string
  url: string | null
  description: string
  color: string
  authorName: string
  authorIconUrl: string | null
  thumbnailUrl: string | null
  imageUrl: string | null
  footerText: string
  footerIconUrl: string | null
  timestamp: boolean
  fields: { name: string; value: string; inline: boolean }[]
}

export type AnnouncementOptions = {
  autoDeleteHours: number
  pin: boolean
  thread: { enabled: boolean; name: string }
  reactions: string[]
  buttons: { label: string; url: string; emoji: string | null }[]
  gallery: string[]
  attachments: string[]
}

export type Recurrence = {
  type: 'daily' | 'weekly' | 'monthly' | 'interval'
  time: string
  days: number[]
  dayOfMonth: number | null
  everyHours: number | null
  endAt: number | null
  maxRuns: number | null
  timeZone: string
}

export type AnnouncementTemplate = { id: number; name: string; payload: { content: string; embed: AnnouncementEmbed }; options: AnnouncementOptions; targets: AnnouncementTarget[]; createdAt: number }

export type AnnouncementTarget = {
  guildId: string
  channelId: string
  ping: 'none' | 'everyone' | 'here' | 'roles'
  roleIds: string[]
  publish: boolean
}

export type Announcement = {
  id: number
  name: string
  payload: { content: string; embed: AnnouncementEmbed }
  targets: AnnouncementTarget[]
  options: AnnouncementOptions
  recurrence: Recurrence | null
  runCount: number
  history: { at: number; ok: number; total: number }[]
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed' | 'deleted'
  scheduledAt: number | null
  sentAt: number | null
  results: (AnnouncementTarget & { ok: boolean; messageId?: string; error?: string; deleted?: boolean })[] | null
  createdBy: string
  createdAt: number
  updatedAt: number
  author: { name: string | null; avatar: string | null } | null
}

export type AnnouncementTargetsPayload = {
  id: string
  name: string
  isMain: boolean
  channels: Channel[]
  roles: { id: string; name: string; color: string }[]
}[]

export type CardLayer =
  | { id: string; type: 'avatar'; x: number; y: number; size: number; shape: 'circle' | 'rounded' | 'square'; borderWidth: number; borderColor: string }
  | { id: string; type: 'text'; x: number; y: number; text: string; font: string; size: number; color: string; align: 'left' | 'center' | 'right'; maxWidth: number; shadow: boolean; uppercase: boolean }
  | { id: string; type: 'rect'; x: number; y: number; w: number; h: number; color: string; opacity: number; radius: number }
  | { id: string; type: 'image'; x: number; y: number; w: number; h: number; src: string | null; radius: number }

export type CardDesign = {
  width: number
  height: number
  background: { type: 'color' | 'gradient' | 'image'; color: string; color2: string; angle: number; image: string | null; overlay: number }
  layers: CardLayer[]
}

export type OnboardingSection = {
  enabled: boolean
  channelId: string | null
  payload: MessagePayload
  card: { enabled: boolean; design: CardDesign }
}

export type OnboardingConfig = {
  welcome: OnboardingSection & { includeBots: boolean; dm: { enabled: boolean; payload: MessagePayload } }
  leave: OnboardingSection
  boost: OnboardingSection & { bonusRoleIds: string[]; end: { enabled: boolean; payload: MessagePayload }; dm: { enabled: boolean; payload: MessagePayload } }
  autoroles: { humanRoleIds: string[]; botRoleIds: string[] }
  rules: {
    enabled: boolean
    channelId: string | null
    messageId: string | null
    payload: MessagePayload
    buttonLabel: string
    buttonEmoji: string
    buttonStyle: 'primary' | 'secondary' | 'success' | 'danger'
    acceptRoleIds: string[]
    removeRoleIds: string[]
    autorolesOnAccept: boolean
    minAccountAgeDays: number
    acceptedMessage: string
  }
}

export type OnboardingPayload = { config: OnboardingConfig; channels: Channel[]; roles: Role[]; fonts: string[] }
