// bl_telemetry 1.6 views (companies, gangs, money flows, server health)
export type BusinessRow = {
  job: string; ts: string; label: string | null; type: string | null; open: boolean | null
  online: number; on_duty: number; employees: number; balance: number | null; level: number | null; xp: number | null; week_duty_s: number | null
}
export type Businesses = {
  ts: string | null; current: boolean
  totals: { ts: string; jobs: number; open: number; on_duty: number; online: number; safes: number | null; duty_by_type: Record<string, number> } | null
  rows: BusinessRow[]
}
export type BusinessDetail = {
  job: string; days: number; current: boolean; latest: BusinessRow | null
  history: { t: number; online: number | null; on_duty: number | null; employees: number | null; balance: number | null; open: boolean | null }[]
  openings: { ts: string; open: boolean | null; on_duty: number | null }[]
  duty: { citizenid: string; name: string | null; shifts: number; seconds: number; last: string | null; dropped: number }[]
  // null = viewer lacks the economy permission, [] = no data
  payroll: { ts: string; total: number; employees: number; by: string | null }[] | null
  sales: { day: string; n: number; total: number }[] | null
}
export type GangRow = { gang: string; label: string | null; online: number; members: number | null; xp: number | null; category: string | null; max_members: number | null; territories: number | null }
export type Gangs = { ts: string | null; current: boolean; rows: GangRow[] }

export type MoneyFlows = {
  hours: number; in: number; out: number
  reasons: { money_type: string | null; action: 'add' | 'remove' | 'set'; reason: string | null; total: number; n: number; max: number | null }[]
  curve: { t: number; in: number; out: number }[]
}
export type MoveData = {
  money?: string | null; action?: string | null; amount?: number | null; reason?: string | null
  item?: string | null; count?: number | null; from?: string | null; from_type?: string | null; to?: string | null; to_type?: string | null; weapon?: boolean | string | null
}
export type Moves = { hours: number; rows: { ts: string; subtype: 'money_move' | 'item_move'; citizenid: string | null; player_name: string | null; data: MoveData | null }[] }

export type Health = {
  hours: number; current: boolean
  latest: {
    ts: string; window_s: number | null; players: number | null; max_players: number | null; staff_on_duty: number | null
    ping_avg: number | null; ping_max: number | null; hitches: number | null; hitch_max_ms: number | null; queue: number | null
    data: { server_uptime_s?: number; telemetry_uptime_s?: number; resources?: { total: number; started: number; stopped: number } } | null
  } | null
  curve: { t: number; players: number | null; ping_avg: number | null; ping_max: number | null; hitches: number | null; hitch_max_ms: number | null; queue: number | null }[]
  errors: { resource: string; n: number; sample: string | null }[]
  slowQueries: { resource: string; n: number; max_ms: number | null }[]
  drops: Record<string, number>
  connects: { attempts?: number; joined?: number; loaded?: number }
}
