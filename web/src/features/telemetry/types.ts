// Shapes of the /api/telemetry/* views (rows as PostgreSQL gives them: numerics may be strings)
type N = number | string | null

export type Overview = {
  online: { t: N; value: N }[]
  tick: { t: N; thread: string; ms: N }[]
  counts: { online?: N; max?: N; up?: N; chars?: N; events24?: N; logs24?: N; sessions24?: N; deaths24?: N }
  errors: { ts: string; channel: string | null; line: string }[]
  up: { t: N; value: N }[]
}

export type Economy = {
  mass: { t: N; total_cash: N; total_bank: N }[]
  top: { name: string | null; citizenid: string; cash: N; bank: N; total: N }[]
  shops: { shop: string; ca: N; n: N }[]
  purchases: { ts: string; player_name: string | null; citizenid: string | null; shop: string | null; article: string | null; qty: N; total: N; currency: string | null }[]
  flows: { ts: string; kind: string | null; from_cid: string | null; to_cid: string | null; amount: N; note: string | null }[]
  flowsByHour: { t: string; kind: string; total: N }[]
  latest: { ts?: string; player_count?: N; chars_total?: N; total_cash?: N; total_bank?: N; total_crypto?: N; society_total?: N }
  extra: { t: N; crypto: N; society: N }[]
}

export type Inflation = {
  days: number
  daily: { day: string; cash: N; bank: N; chars: N; players: N }[]
  flows: { day: string; kind: string; total: N; n: number }[]
  wealth: { median?: N; mean?: N; n?: number }
}

export type PlayerRow = { citizenid: string; name: string | null; job: string | null; gang: string | null; cash: N; bank: N; online: boolean | null; ts: string }

export type Player = {
  ident: { name: string | null; citizenid: string; job: string | null; job_grade: N; gang: string | null; cash: N; bank: N; crypto: N; online: boolean | null; ts: string } | null
  money: { t: N; cash: N; bank: N }[]
  deaths: { ts: string; cause: string | null; killer_name: string | null; killer_cid: string | null; weapon: string | null; x: N; y: N; z: N; screenshot_url: string | null }[]
  purchases: { ts: string; shop: string | null; article: string | null; qty: N; total: N }[]
  sessions: { start_ts: string; end_ts: string | null; minutes: N; drop_reason: string | null }[]
  vehicles: { plate: string; model: string | null; garage: string | null; state: N }[]
  inventory: { name: string; count: N }[]
  events: { ts: string; type: string; subtype: string | null; data: unknown }[]
  flows: { ts: string; kind: string | null; from_cid: string | null; to_cid: string | null; amount: N; note: string | null }[]
  stats: { hours?: N; deaths?: N; purchases?: N }
}

export type Alert = { id: N; ts: string; kind: string; severity: string; title: string; detail: string | null; citizenid: string | null; notified: boolean }
export type Alerts = {
  alerts: Alert[]
  byKind: { kind: string; n: number }[]
  config: { logCategory: string; errors5min?: number; moneyJump?: number; anticheatChannel?: string }
}
export type Anomalies = { min: number; hours: number; players: { citizenid: string; name: string | null; ts: string; prev: N; total: N; jump: N; first_total: N; last_total: N; net: N }[] }

export type Insights = {
  days: number
  tz: string
  heat: { dow: number; hour: number; avg: N; max: N }[]
  jobs: { name: string; n: number; online: number }[]
  gangs: { name: string; n: number; online: number }[]
  killers: { name: string; citizenid: string | null; n: number }[]
  weapons: { name: string; n: number }[]
  causes: { name: string; n: number }[]
  peak: { n: N; ts: string } | null
  uptime: { day?: N; period?: N }
}

export type DeathPoint = { ts: string; citizenid: string | null; player_name: string | null; cause: string | null; killer_cid?: string | null; killer_name: string | null; weapon: string | null; x: N; y: N; z?: N; screenshot_url: string | null }
export type DeathMap = { points: DeathPoint[]; screenshots: DeathPoint[] }

export type LogsView = {
  logs: { ts: string; channel: string | null; level: string | null; line: string }[]
  chat: { ts: string; player_name: string | null; citizenid: string | null; subtype: string; message: string | null }[]
  volume: { t: string; level: string; n: N }[]
}

export type Admin = {
  actions: { ts: string; action: string | null; staff: string | null; target: string | null; reason: string | null; duration: string | null }[]
  connections: { start_ts: string; end_ts: string | null; player_name: string | null; citizenid: string | null; drop_reason: string | null }[]
  explosions: { ts: string; player_name: string | null; citizenid: string | null; type: string | null }[]
  deathsByHour: { t: string; n: N }[]
}

export type DbView = {
  tablesTs: string | null
  tables: { name: string; rows: number; bytes: number; rows24h: number | null; rows7d: number | null }[]
  snapshots: { name: string; label: string; kind: string; pos: N; ts: string; columns: string[]; rows: unknown[][] }[]
}

export type SearchView = {
  q: string
  days: number
  players: { citizenid: string; name: string | null; job: string | null; gang: string | null; online: boolean | null; ts: string }[]
  logs: LogsView['logs']
  chat: LogsView['chat']
  events: { ts: string; type: string; subtype: string | null; citizenid: string | null; player_name: string | null; data: unknown }[]
}

export type ScriptsView = {
  resources: { channel: string; errors: number; warns: number; last: string | null; lastError: { ts: string; line: string } | null }[]
  hitches: { count: number; hours: { t: number; n: number; max: number; total: number }[]; worst: number }
  list: { ts: string; rows: unknown[][] } | null
  restarts: string[]
}

export type StaffItem = { ts: string; source: string; action: string | null; category: string; actor: string; target: string | null; targetCid?: string | null; reason: string | null; duration?: string | null }
export type StaffView = {
  days: number
  total: number
  truncated: boolean
  staff: { actor: string; total: number; cats: Record<string, number>; last: string; sources: string[] }[]
  categories: Record<string, number>
  days_activity: Record<string, number>
  items: StaffItem[]
}

type Bucket = { key: string; n: number; fps: N; fps_min: N; worst: N; obj: N; peds?: N; veh?: N; x: N; y: N; z?: N; players?: N }
export type Entities = Record<'vehicles' | 'peds' | 'objects', { total: number; top?: { model: string | number; n: number }[] } | undefined>
export type PerfView = {
  hours: number
  server: { threads: { thread: string; avg: N; p95: N; max: N; n: number }[]; correlation: { t: N; ms: N; players: N }[]; hitches: { count: number; worst: number } }
  clients: { samples: number; fps: number | null; fpsMin: number | null; worst: number | null; hist: number[]; timeline: { t: string; fps: N; players: N; n: N }[] }
  interiors: Bucket[]
  zones: Bucket[]
  players: { key: string; name: string | null; n: number; fps: N; fps_min: N; worst: N; ping: N }[]
  entities: Partial<Entities> | null
  profiler: { runs: number; resources: { name: string; msPerSec: number; runs: number; calls: number; pct: number }[]; last: { ts: string; top: { name: string; res: string; ms: N; n: N }[] | null } | null }
  installed: { ts: string | null; total: number; started: number; maps: unknown[]; list: { name: string; state: string; version: string | null; map: boolean; dataFiles: number; clientScripts: number; serverScripts: number; files: number }[] }
  recommendations: { severity: 'critical' | 'warn' | 'info'; title: string; detail: string | null; link?: string }[]
}

export type Command = { id: N; ts: string; type: string; payload: { message?: string; title?: string; mode?: string; type?: string; duration?: number } | null; author: string | null; status: string; sent_at: string | null; done_at: string | null; result: string | null }

export type TelemetryConfig = {
  hasIngestToken: boolean
  ingestTokenEnd: string | null
  fivemBase: string | null
  alerts: { errors5min: number; moneyJump: number; anticheatChannel: string }
  retention: Record<string, number>
  timezone: string
}
