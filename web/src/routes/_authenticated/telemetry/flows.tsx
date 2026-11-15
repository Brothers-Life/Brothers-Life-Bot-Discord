import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, Scale } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Notice, Page, Pill, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, TimeChart, type Serie } from '@/features/telemetry/charts'
import { isEmpty } from '@/features/telemetry/chart-utils'
import { dt, fmt, money, moneyCompact, n0 } from '@/features/telemetry/format'
import type { MoneyFlows, Moves } from '@/features/telemetry/types16'
import { Mono, PlayerLink, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/flows')({
  component: TelemetryFlows,
})

const RANGES = [{ value: 24, label: '24 h' }, { value: 168, label: '7 j' }, { value: 720, label: '30 j' }]
const KINDS = [{ value: 'money', label: 'Argent' }, { value: 'item', label: 'Objets' }]

type Reason = MoneyFlows['reasons'][number]

const reasonColumns = (name: string) => [
  { key: 'reason', label: 'Raison', render: (r: Reason) => <span className='break-words'>{r.reason || 'sans raison'}</span>, csv: (r: Reason) => r.reason },
  { key: 'type', label: 'Type', render: (r: Reason) => <Pill>{r.money_type ?? '?'}</Pill>, csv: (r: Reason) => r.money_type },
  { key: 'total', label: 'Total', align: 'end' as const, render: (r: Reason) => <b>{money(r.total)}</b>, csv: (r: Reason) => r.total },
  { key: 'n', label: 'Mouvements', align: 'end' as const, render: (r: Reason) => fmt(r.n), csv: (r: Reason) => r.n },
  { key: 'max', label: 'Plus gros', align: 'end' as const, render: (r: Reason) => money(r.max), csv: (r: Reason) => r.max },
].map((c) => ({ ...c, key: `${name}-${c.key}` }))

function MovesSection({ hours }: { hours: number }) {
  const [kind, setKind] = useState('money')
  const q = useQuery({ queryKey: ['telemetry', 'moves', hours, kind], queryFn: () => api<Moves>(`/telemetry/moves?h=${hours}&kind=${kind}`) })
  const rows = q.data?.rows
  return (
    <TableSection
      title='Gros mouvements à contrôler' description='Les plus gros mouvements remontés par le jeu sur la période.'
      exportName={`mouvements-${kind}`} rows={rows} minWidth='46rem' maxHeight='32rem' empty='Aucun mouvement sur la période.'
      actions={<Segmented label='Type de mouvement' value={kind} options={KINDS} onChange={setKind} />}
      columns={[
        { key: 'ts', label: 'Date', render: (m) => <span className='whitespace-nowrap text-muted-foreground'>{dt(m.ts)}</span>, csv: (m) => dt(m.ts) },
        { key: 'who', label: 'Joueur', render: (m) => <PlayerLink cid={m.citizenid} name={m.player_name} />, csv: (m) => m.player_name ?? m.citizenid },
        {
          key: 'what', label: 'Quoi',
          render: (m) => (m.subtype === 'money_move'
            ? <span className='flex flex-wrap items-center gap-1.5'><Pill tone={m.data?.action === 'remove' ? 'danger' : 'success'}>{m.data?.action === 'remove' ? 'retrait' : m.data?.action === 'set' ? 'fixé' : 'ajout'}</Pill><b>{money(m.data?.amount)}</b><Mono>{m.data?.money ?? '?'}</Mono></span>
            : <span className='flex flex-wrap items-center gap-1.5'><b>{m.data?.item ?? '?'} × {fmt(m.data?.count)}</b>{m.data?.weapon ? <Pill tone='warning'>arme</Pill> : null}</span>),
          csv: (m) => (m.subtype === 'money_move' ? `${m.data?.action ?? ''} ${m.data?.amount ?? ''} ${m.data?.money ?? ''}` : `${m.data?.item ?? ''} x${m.data?.count ?? ''}`),
        },
        {
          key: 'route', label: 'De → vers',
          render: (m) => (m.subtype === 'item_move' ? <span className='break-words'>{m.data?.from ?? '?'} → {m.data?.to ?? '?'}</span> : <span className='text-muted-foreground'>—</span>),
          csv: (m) => (m.subtype === 'item_move' ? `${m.data?.from ?? ''} -> ${m.data?.to ?? ''}` : ''),
        },
        { key: 'reason', label: 'Raison', render: (m) => <span className='break-words text-muted-foreground'>{m.data?.reason ?? m.data?.action ?? '—'}</span>, csv: (m) => m.data?.reason ?? m.data?.action },
      ]}
    />
  )
}

function TelemetryFlows() {
  const [hours, setHours] = useState(168)
  const q = useQuery({ queryKey: ['telemetry', 'flows', hours], queryFn: () => api<MoneyFlows>(`/telemetry/flows?h=${hours}`) })
  const d = q.data
  const net = d ? n0(d.in) - n0(d.out) : null
  const curve: Serie[] = [
    { key: 'in', label: 'Entrées', color: 'var(--success)', data: (d?.curve ?? []).map((p) => ({ x: p.t, y: n0(p.in) })) },
    { key: 'out', label: 'Sorties', color: 'var(--destructive)', data: (d?.curve ?? []).map((p) => ({ x: p.t, y: n0(p.out) })) },
  ]
  const byTotal = (a: Reason, b: Reason) => n0(b.total) - n0(a.total)
  const added = (d?.reasons ?? []).filter((r) => r.action === 'add').sort(byTotal)
  const removed = (d?.reasons ?? []).filter((r) => r.action === 'remove').sort(byTotal)
  return (
    <Page
      title='Télémétrie · Flux d’argent'
      description='Argent qui entre et sort de l’économie du jeu, par raison, et gros mouvements à contrôler.'
      actions={<Segmented label='Période' value={hours} options={RANGES} onChange={setHours} />}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {!d.reasons.length && !d.curve.length ? (
            <Section title='Flux'><EmptyState title='Pas encore de relevé'>Les données arrivent avec bl_telemetry 1.6, un relevé toutes les 5 minutes.</EmptyState></Section>
          ) : (
            <>
              <StatCards className='lg:grid-cols-3' items={[
                { label: 'Entrées', value: moneyCompact(d.in), icon: ArrowDownToLine, tone: 'success' },
                { label: 'Sorties', value: moneyCompact(d.out), icon: ArrowUpFromLine, tone: 'danger' },
                { label: 'Création nette', value: net === null ? '–' : `${net >= 0 ? '+' : '−'}${moneyCompact(Math.abs(net))}`, icon: Scale, tone: net !== null && net < 0 ? 'danger' : 'accent', hint: 'entrées − sorties' },
              ]} />
              <ChartCard title='Entrées et sorties' empty={isEmpty(curve) && 'Aucun flux sur la période'}><TimeChart series={curve} unit='money' kind='line' /></ChartCard>
              <Notice tone='info' title='À savoir'>
                Un virement entre deux joueurs compte une fois en sortie et une fois en entrée : ce n’est pas de l’argent créé. Les nombres dans les raisons sont remplacés par #.
              </Notice>
              <div className='grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2'>
                <TableSection title='D’où vient l’argent' exportName='argent-entrant' rows={added} columns={reasonColumns('in')} minWidth='32rem' maxHeight='30rem' empty='Aucune entrée sur la période.' />
                <TableSection title='Où part l’argent' exportName='argent-sortant' rows={removed} columns={reasonColumns('out')} minWidth='32rem' maxHeight='30rem' empty='Aucune sortie sur la période.' />
              </div>
            </>
          )}
          <MovesSection hours={hours} />
        </div>
      )}
    </Page>
  )
}
