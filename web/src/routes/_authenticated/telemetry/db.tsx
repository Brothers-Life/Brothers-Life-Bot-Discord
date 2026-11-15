import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Database, HardDrive, Rows3, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Page, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { bytes, compact, fmt, rel } from '@/features/telemetry/format'
import { Snapshot } from '@/features/telemetry/snapshot-card'
import type { DbView } from '@/features/telemetry/types'
import { Mono, QueryError, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/db')({
  component: TelemetryDb,
})

function Growth({ now, before }: { now: number; before: number | null }) {
  if (before === null) return <span className='text-muted-foreground'>–</span>
  const d = now - before
  if (!d) return <span className='text-muted-foreground'>0</span>
  return <span className={d > 0 ? 'text-success' : 'text-destructive'}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}</span>
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
