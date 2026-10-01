export type Person = { name: string | null; avatar: string | null } | null
export type Group = { name: string; label: string; grade: number; gradeLabel: string | null; type: string; onDuty?: boolean; isBoss?: boolean }
export type Item = { name: string; count: number; slot?: number }

export type Summary = {
  userId: number; username: string; discordId: string | null; discord: Person
  characters: { citizenId: string; name: string; job: Group | null; gang: Group | null; lastUpdated: number | null }[]
  lastSeen: number | null; online: boolean; playSeconds: number; sessions: number
}

export type Character = {
  citizenId: string; slot: number; name: string; birthdate: string | null; gender: string | null; nationality: string | null; backstory: string | null; phone: string | null
  job: Group | null; gang: Group | null; money?: { cash?: number; bank?: number; crypto?: number }; coins?: number | null; vip: string | null
  status: { dead: boolean; lastStand: boolean; handcuffed: boolean; inJail: number; health: number | null; armor: number | null; hunger: number | null; thirst: number | null; stress: number | null }
  identity: { bloodType: string | null; fingerprint: string | null; callsign: string | null; licences: Record<string, boolean> | null; criminalRecord: { hasRecord?: boolean } | null }
  inventory?: Item[]; outfits: number; groups: (Group & { hiredAt: number | null })[]; duty: { job: string; label: string; seconds: number }[]; jail: number
  properties: { id: number; name: string; price: number }[]; lastUpdated: number | null; lastLoggedOut: number | null
}

export type Sheet = {
  account: { userId: number; username: string; discordId: string | null; license: string; license2: string | null; fivemId: string | null }; discord: Person
  playtime: { online: boolean; sessions: number; firstSeen: number | null; totalSeconds: number; weekSeconds: number; lastSessions: { joinedAt: number; leftAt: number | null; dropReason: string | null; characters: string[] }[] }
  characters: Character[]
  vehicles: { owner: string; model: string; plate: string; fakePlate: string | null; garage: string | null; state: string; fuel: number | null; engine: number; body: number; depotPrice: number | null; distance: number | null; nickname: string | null; lastOut: number | null; ownerJob: string | null; ownerGang: string | null; glovebox?: Item[]; trunk?: Item[] }[]
  sanctions: { id: number; type: string; reason: string | null; durationMinutes: string | null; by: string | null; at: number | null }[]
  bans: { id: number; reason: string | null; expire: number | null; by: string | null }[]
  reports: { id: number; message: string; status: string; priority: string | null; category: string | null; claimedBy: string | null; resolvedBy: string | null; at: number | null }[]
  economy: { total: number; flows: { at: number | null; kind: string; from: string | null; to: string | null; amount: number; note: string | null }[]; premium: { points: number; loyalty: number; logs: { action: string; label: string | null; amount: string | null; details: string | null; at: number | null }[] } } | null
  permissions: { economy: boolean; inventory: boolean; logs: boolean }
  activity: { day: string; sessions: number; hours: number }[]
  jobs: {
    checkins: { character: string; job: string; checkin: number | null; checkout: number | null }[]
    actions: { character: string; job: string; action: string; amount: number | null; at: number | null }[]
    safe: { character: string; place: string; action: string; item: string | null; amount: number | null; reason: string | null; at: number | null }[]
    payroll: { character: string; job: string; grade: number; amount: number; dutySeconds: number; failed: boolean; at: number | null }[]
    invoices: { job: string; amount: number; settled: boolean; at: number | null }[]
  }
  skills: { harvested: number; crafting: { character: string; item: string; crafted: number; requested: number; at: number | null }[] }
  police: {
    lookups: { by: string; role: string | null; field: string; effect: string; reason: string | null; at: number | null }[]
    calls: { code: string; title: string; place: string | null; state: string; at: number | null }[]
  }
  phone: {
    invoices: { character: string; from: string | null; title: string | null; amount: number; status: string; at: number | null; paidAt: number | null }[]
    bank: { character: string; kind: string; amount: number; label: string | null; at: number | null }[]
  } | null
  shop: {
    crates: { kind: string; label: string; rarity: string | null; refund: number; at: number | null }[]
    purchases: { label: string; price: number; at: number | null }[]
    gifts: { sent: boolean; from: string | null; label: string | null; points: number; status: string; at: number | null }[]
  } | null
  staff: { roles: string[]; sessions: number; seconds: number; recentSeconds: number; lastSeen: number | null; active: boolean; actions: { action: string; target: string | null; details: string | null; at: number | null }[] } | null
  creations: { mapEdits: { action: string; object: string | null; at: number | null }[]; carplay: { verdict: string; label: string | null; at: number | null }[] }
  stashes: { owner: string; name: string; items: Item[]; at: number | null }[]
}

export type Overview = {
  accounts: number; characters: number; online: number; week: { players: number; seconds: number }
  staff: { name: string; role: string; seconds: number; active: boolean }[]
  jobs: { name: string; label: string; type: string; members: number }[]
  topPlaytime: { userId: number; username: string; seconds: number }[]
}

export type Job = {
  name: string; label: string; type: string
  grades: { grade: number; name: string; payment: number | null; isBoss: boolean }[]
  members: number; onDuty: number; dutySeconds: number; weekDutySeconds: number; weekPeople: number
  level: { level: number; xp: number; title: string | null } | null
  open: { isOpen: boolean; by: string | null } | null
  payroll: { total: number; employees: number; by: string | null; at: number | null } | null
  invoices: { count: number; total: number; unpaid: number } | null
  safeMoves: number
  gang: { category: string | null; maxMembers: number | null; xp: number } | null
}

export type ServerReport = {
  at: number
  activity: {
    days: { day: string; players: number; sessions: number; hours: number; peak: number; newPlayers: number }[]
    heatmap: number[][]
    totals: { sessions: number; players: number; hours: number; avgMinutes: number; peak: number }
    drops: { reason: string; count: number }[]
    online: { userId: number; username: string; since: number | null }[]
  }
  jobs: Job[]
  vehicles: { total: number; out: number; garage: number; impound: number; damaged: number; fakePlates: number; customGarages: number; models: { model: string; count: number }[]; garages: { garage: string; count: number }[] }
  justice: {
    jailed: { citizenId: string; name: string; months: number }[]
    sanctions30: Record<string, number>
    sanctions: { id: number; userId: number | null; target: string | null; type: string; reason: string | null; durationMinutes: string | null; by: string | null; at: number | null }[]
    bans: { id: number; name: string | null; reason: string | null; expire: number | null; by: string | null }[]
    reports: { id: number; sender: string | null; message: string; status: string; priority: string | null; category: string | null; claimedBy: string | null; resolvedBy: string | null; at: number | null; resolvedAt: number | null }[]
    calls: { id: number; code: string; title: string; place: string | null; priority: string | null; state: string; caller: string | null; closedBy: string | null; at: number | null; closedAt: number | null }[]
  }
  world: {
    counts: Record<string, number>
    safezones: { name: string; active: boolean; visits: number; seconds: number }[]
    harvest: { id: number; label: string; item: string; amount: number; enabled: boolean; stock: { current: number; max: number } | null; access: string | null }[]
    harvesters: { name: string; total: number }[]
  }
  staff: {
    roles: { id: number; name: string; label: string; protected: boolean; actions: number }[]
    members: { name: string; roles: string[]; seconds: number; sessions: number; lastSeen: number | null; active: boolean; actions: number; sanctions: number; reports: number }[]
    messages: { by: string; line: string; target: string | null; at: number | null }[]
  }
  economy: {
    cash: number; bank: number; crypto: number
    fortunes: { citizenId: string; name: string; cash: number; bank: number }[]
    accounts: { total: number; list: { id: string; amount: number; creator: string | null; frozen: boolean; savings: boolean }[] }
    flows: { kind: string; count: number; total: number }[]
    phone: { kind: string; count: number; total: number }[]
    premium: { points: number; loyalty: number; purchases30: number; crates: { rarity: string | null; count: number }[]; topItems: { label: string; count: number; price: number }[]; gifts: { sent: number; opened: number }; promos: number }
    cryptoMarkets: { id: string; price: number; supply: number; status: string }[]
  } | null
}

export type GameLog = { source: string; at: number | null; actor: string | null; action: string | null; target: string | null; details: string | null }
export type LogSource = { key: string; label: string; total: number; recent: number }
