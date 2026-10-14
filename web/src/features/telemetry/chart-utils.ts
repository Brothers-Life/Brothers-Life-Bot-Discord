// Look and data helpers of the telemetry charts
export const PALETTE = ['var(--primary)', 'var(--info)', 'var(--success)', 'var(--destructive)', 'var(--warning)', '#a78bfa', '#2dd4bf', '#f472b6', '#94a3b8', '#84cc16', '#fb7185', '#38bdf8']
export const axis = { stroke: 'var(--muted-foreground)', fontSize: 11, tickLine: false, axisLine: false }
export const tooltipStyle = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)', fontSize: 12 }

export type Point = { x: number; y: number | null }
export type Serie = { key: string; label: string; color?: string; data: Point[] }

// One row per timestamp, one column per serie (what recharts wants)
export function mergeSeries(series: Serie[]) {
  const rows = new Map<number, Record<string, number | null>>()
  for (const s of series) {
    for (const p of s.data) {
      if (!Number.isFinite(p.x)) continue
      const row = rows.get(p.x) ?? { x: p.x }
      row[s.key] = p.y
      rows.set(p.x, row)
    }
  }
  return [...rows.values()].sort((a, b) => (a.x as number) - (b.x as number))
}

export const isEmpty = (series: Serie[]) => series.every((s) => !s.data.some((p) => p.y !== null))
