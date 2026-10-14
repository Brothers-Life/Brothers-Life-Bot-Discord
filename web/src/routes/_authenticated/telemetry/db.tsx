import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Database, HardDrive, Rows3, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Page, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, Donut, HBarChart } from '@/features/telemetry/charts'
import { bytes, compact, fmt, rel } from '@/features/telemetry/format'
import type { DbView } from '@/features/telemetry/types'
import { Mono, QueryError, TableSection, type Column } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/db')({
  component: TelemetryDb,
})

const colLabel = (c: string) => String(c).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())
// "1. < 10 k$" -> "< 10 k$" (sort prefix of the game reads)
const cellLabel = (v: unknown) => String(v ?? '–').replace(/^\d+\.\s/, '')
const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))

function Growth({ now, before }: { now: number; before: number | null }) {
  if (before === null) return <span className='text-muted-foreground'>–</span>
  const d = now - before
  if (!d) return <span className='text-muted-foreground'>0</span>
  return <span className={d > 0 ? 'text-success' : 'text-destructive'}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}</span>
}

// One read of the game database (table, bars or ring)
function Snapshot({ s }: { s: DbView['snapshots'][number] }) {
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

function TelemetryDb() {
  const q = useQuery({ queryKey: ['telemetry', 'db'], queryFn: () => api<DbView>('/telemetry/db'), refetchInterval: 120_000 })
  const d = q.data
  const tables = d?.tables ?? []
  const totalRows = tables.reduce((s, t) => s + t.rows, 0)
  const before = tables.filter((t) => t.rows24h != null)
  const grown = before.reduce((s, t) => s + (t.rows - t.rows24h!), 0)
  const top = before.map((t) => ({ ...t, g: t.rows - t.rows24h! })).sort((a, b) => b.g - a.g)[0]
  const maxBytes = Math.max(1, ...tables.map((t) => t.bytes))
  return (
    <Page title='Télémétrie · Base de données' description='Taille et croissance des tables de la base du jeu, et les lectures préparées par bl_telemetry (fortunes, objets, véhicules, bans…).'>
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards items={[
            { label: 'Tables', value: tables.length || '–', icon: Database, tone: 'accent', hint: d.tablesTs ? `lu ${rel(d.tablesTs)}` : 'en attente de bl_telemetry' },
            { label: 'Lignes', value: tables.length ? compact(totalRows) : '–', icon: Rows3, tone: 'info', hint: before.length ? <><Growth now={totalRows} before={totalRows - grown} /> sur 24 h</> : 'estimation MySQL' },
            { label: 'Taille', value: tables.length ? bytes(tables.reduce((s, t) => s + t.bytes, 0)) : '–', icon: HardDrive },
            { label: 'Plus forte croissance', value: top && top.g > 0 ? `+${compact(top.g)}` : '–', icon: TrendingUp, tone: 'success', hint: top && top.g > 0 ? `${top.name} · 24 h` : 'pas encore d’historique' },
          ]} />
          <TableSection
            title='Tables' exportName='tables' rows={tables} minWidth='40rem' maxHeight='32rem'
            empty='Aucune donnée : installe bl_telemetry 1.1 (module dbsync) sur le serveur.'
            columns={[
              { key: 'name', label: 'Table', render: (t) => <Mono>{t.name}</Mono>, csv: (t) => t.name },
              { key: 'rows', label: 'Lignes', align: 'end', render: (t) => fmt(t.rows), csv: (t) => t.rows },
              { key: 'd1', label: '24 h', align: 'end', render: (t) => <Growth now={t.rows} before={t.rows24h} />, csv: (t) => (t.rows24h === null ? '' : t.rows - t.rows24h) },
              { key: 'd7', label: '7 j', align: 'end', render: (t) => <Growth now={t.rows} before={t.rows7d} />, csv: (t) => (t.rows7d === null ? '' : t.rows - t.rows7d) },
              {
                key: 'size', label: 'Taille', render: (t) => (
                  <span className='flex items-center gap-2'>
                    <span className='h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted'><span className='block h-full rounded-full bg-primary' style={{ width: `${Math.max(2, Math.round((t.bytes / maxBytes) * 100))}%` }} /></span>
                    <span className='whitespace-nowrap tabular-nums'>{bytes(t.bytes)}</span>
                  </span>
                ),
                csv: (t) => t.bytes,
              },
            ]}
          />
          {!d.snapshots.length ? (
            <Section title='Lectures de la base'><EmptyState title='Rien pour le moment'>Les lectures de la base apparaîtront ici après la mise à jour de <Mono>bl_telemetry</Mono> sur le serveur.</EmptyState></Section>
          ) : (
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
              {d.snapshots.map((s) => <Snapshot key={s.name} s={s} />)}
            </div>
          )}
        </div>
      )}
    </Page>
  )
}
