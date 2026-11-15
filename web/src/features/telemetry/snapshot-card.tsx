import { ChartCard, Donut, HBarChart } from '@/features/telemetry/charts'
import { fmt, rel } from '@/features/telemetry/format'
import type { DbView } from '@/features/telemetry/types'
import { TableSection, type Column } from '@/features/telemetry/ui'

export type SnapshotData = DbView['snapshots'][number]

const colLabel = (c: string) => String(c).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())
// "1. < 10 k$" -> "< 10 k$" (sort prefix of the game reads)
const cellLabel = (v: unknown) => String(v ?? '–').replace(/^\d+\.\s/, '')
const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))

// One read of the game database (table, bars or ring)
export function Snapshot({ s }: { s: SnapshotData }) {
  const rows = (Array.isArray(s.rows) ? s.rows : []).filter(Array.isArray)
  const subtitle = <span title={s.ts}>{rel(s.ts)}</span>
  if ((s.kind === 'bar' || s.kind === 'donut') && rows.length) {
    const data = rows.map((r) => ({ name: cellLabel(r[0]), n: Number(r[1]) || 0 }))
    return (
      <ChartCard title={s.label} actions={<span className='text-xs text-muted-foreground'>{subtitle}</span>} height='h-64'>
        {s.kind === 'donut' ? <Donut rows={data} /> : <HBarChart rows={data} series={[{ key: 'n', label: colLabel(s.columns?.[1] ?? 'valeur') }]} />}
      </ChartCard>
    )
  }
  const cols = s.columns ?? []
  const numeric = cols.map((_, j) => rows.length > 0 && rows.every((r) => r[j] == null || isNum(r[j])))
  const columns: Column<unknown[]>[] = cols.map((c, j) => ({
    key: `${j}`,
    label: colLabel(c),
    align: numeric[j] ? 'end' : undefined,
    render: (r) => (numeric[j] ? fmt(Number(r[j]) || 0) : cellLabel(r[j])),
    csv: (r) => (numeric[j] ? Number(r[j]) || 0 : cellLabel(r[j])),
  }))
  return <TableSection title={s.label} description={subtitle} exportName={`bdd-${s.name}`} rows={rows} columns={columns} minWidth={`${Math.max(18, cols.length * 9)}rem`} maxHeight='28rem' empty='Aucune ligne.' className={cols.length > 3 ? 'lg:col-span-2' : undefined} />
}
