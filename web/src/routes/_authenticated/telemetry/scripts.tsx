import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Gauge, PackageCheck, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { Page, Pill, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, TimeChart, type Serie } from '@/features/telemetry/charts'
import { dt, fmt, rel } from '@/features/telemetry/format'
import type { ScriptsView } from '@/features/telemetry/types'
import { ConsoleLine, Mono, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/scripts')({
  component: TelemetryScripts,
})

const FILTERS = [{ value: '', label: 'Toutes' }, { value: 'started', label: 'Démarrées' }, { value: 'stopped', label: 'Arrêtées' }]

function TelemetryScripts() {
  const [filter, setFilter] = useState('')
  const q = useQuery({ queryKey: ['telemetry', 'scripts'], queryFn: () => api<ScriptsView>('/telemetry/scripts'), refetchInterval: 60_000 })
  const d = q.data
  const rows = (d?.list?.rows ?? []).filter(Array.isArray).map((r) => ({ name: String(r[0] ?? ''), state: String(r[1] ?? ''), version: r[2] ? String(r[2]) : null, author: r[3] ? String(r[3]) : null }))
  const started = rows.filter((r) => r.state === 'started').length
  const list = rows.filter((r) => !filter || (filter === 'started' ? r.state === 'started' : r.state !== 'started')).sort((a, b) => a.name.localeCompare(b.name))
  const errors = (d?.resources ?? []).reduce((s, r) => s + r.errors, 0)
  const hitches: Serie[] = [{ key: 'n', label: 'Ralentissements', color: 'var(--warning)', data: (d?.hitches.hours ?? []).map((h) => ({ x: h.t, y: h.n })) }]
  return (
    <Page title='Télémétrie · Scripts' description='Erreurs et avertissements par ressource sur 24 h, ralentissements du serveur, redémarrages et ressources installées.'>
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards items={[
            { label: 'Ressources démarrées', value: rows.length ? started : '–', icon: PackageCheck, tone: 'success', hint: rows.length ? `sur ${rows.length} · ${rows.length - started} arrêtée(s)` : 'en attente de bl_telemetry' },
            { label: 'Erreurs (24 h)', value: errors, icon: AlertTriangle, tone: 'danger', hint: `${d.resources.filter((r) => r.errors).length} ressource(s)` },
            { label: 'Ralentissements (24 h)', value: d.hitches.count, icon: Gauge, tone: 'warning', hint: d.hitches.worst ? `pire ${fmt(d.hitches.worst)} ms` : undefined },
            { label: 'Redémarrages (30 j)', value: d.restarts.length, icon: RotateCcw, tone: 'info', hint: d.restarts.length ? `dernier ${rel(d.restarts[0])}` : undefined },
          ]} />
          <ChartCard title='Ralentissements du serveur par heure' height='h-48' empty={!d.hitches.hours.length && 'Aucun ralentissement sur 24 h'}><TimeChart series={hitches} kind='bar' /></ChartCard>
          <TableSection
            title='Erreurs par ressource (24 h)' exportName='erreurs-ressources' rows={d.resources} minWidth='44rem' empty='Aucune erreur ni avertissement sur 24 h.'
            columns={[
              { key: 'channel', label: 'Ressource', render: (r) => <Mono>{r.channel}</Mono>, csv: (r) => r.channel },
              { key: 'errors', label: 'Erreurs', align: 'end', render: (r) => <b className={r.errors ? 'text-destructive' : ''}>{fmt(r.errors)}</b>, csv: (r) => r.errors },
              { key: 'warns', label: 'Avert.', align: 'end', render: (r) => fmt(r.warns), csv: (r) => r.warns },
              { key: 'last', label: 'Dernière erreur', render: (r) => (r.lastError ? <span className='grid gap-0.5'><span className='text-xs text-muted-foreground' title={dt(r.lastError.ts)}>{rel(r.lastError.ts)}</span><ConsoleLine line={r.lastError.line} /></span> : '–'), csv: (r) => r.lastError?.line ?? '' },
            ]}
          />
          <TableSection
            title='Ressources installées'
            description={d.list ? `lu ${rel(d.list.ts)}` : undefined}
            actions={<Segmented label='Filtre' value={filter} options={FILTERS} onChange={setFilter} />}
            exportName='ressources' rows={list} minWidth='32rem' maxHeight='32rem' empty={rows.length ? 'Rien dans cette catégorie.' : 'Liste pas encore reçue (bl_telemetry 1.2).'}
            columns={[
              { key: 'name', label: 'Ressource', render: (r) => <Mono>{r.name}</Mono>, csv: (r) => r.name },
              { key: 'state', label: 'État', render: (r) => <Pill tone={r.state === 'started' ? 'success' : r.state === 'stopped' ? 'danger' : 'warning'}>{r.state}</Pill>, csv: (r) => r.state },
              { key: 'version', label: 'Version', render: (r) => r.version ?? '–', csv: (r) => r.version },
              { key: 'author', label: 'Auteur', render: (r) => <span className='text-muted-foreground'>{r.author ?? '–'}</span>, csv: (r) => r.author },
            ]}
          />
        </div>
      )}
    </Page>
  )
}
