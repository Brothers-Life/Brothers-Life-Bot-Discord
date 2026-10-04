// Shapes of the public page (GET /api/public-page) and of its settings

export type Inline = { t: 'text' | 'b' | 'i'; v: string } | { t: 'link'; v: string; href: string }
export type RichBlock =
  | { type: 'h'; level: 1 | 2 | 3; inline: Inline[] }
  | { type: 'p'; lines: Inline[][] }
  | { type: 'ul' | 'ol'; items: Inline[][] }
  | { type: 'hr' }

export type PublicServer = {
  name: string
  online: boolean
  players: number
  max: number
  onlineSince: number | null
  checkedAt: number | null
  joinUrl: string | null
  playerNames?: string[]
}

export type PublicView = {
  title: string
  tagline: string | null
  generatedAt: number
  status?: PublicServer[] | null
  maintenance?: { maintenance: { active: boolean; reason: string | null; since: number | null }; nextRestart: { at: number } | null } | null
  staff?: { name: string; color: string | null; members: { name: string; avatar: string | null }[] }[] | null
  rules?: RichBlock[]
  discord?: { guilds: { name: string; icon: string | null; members: number; isMain: boolean }[]; total: number } | null
  events?: { title: string; description: string | null; location: string | null; startsAt: number; endsAt: number | null; live: boolean; image: string | null; going: number; capacity: number | null }[] | null
  recruitment?: { name: string; description: string | null; server: string; closesAt: number | null; url: string | null }[] | null
  links?: { discordInvite: string | null; shop: string | null; items: { label: string; url: string }[] }
}

export type PublicConfig = {
  enabled: boolean
  title: string
  tagline: string
  status: { enabled: boolean; serverIds: number[]; showPlayerNames: boolean }
  maintenance: { enabled: boolean }
  staff: { enabled: boolean; rankIds: number[] }
  rules: { enabled: boolean; text: string }
  discord: { enabled: boolean; guildIds: string[] }
  events: { enabled: boolean; limit: number }
  recruitment: { enabled: boolean }
  links: { enabled: boolean; discordInvite: string; shop: string; items: { label: string; url: string }[] }
}

export type PublicConfigPayload = {
  config: PublicConfig
  options: {
    servers: { id: number; name: string }[]
    ranks: { id: number; name: string; color: string | null; level: number }[]
    guilds: { id: string; name: string; icon: string | null; isMain: boolean }[]
    maintenanceAvailable: boolean
  }
}
