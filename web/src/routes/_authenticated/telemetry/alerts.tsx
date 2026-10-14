import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, Bell, Search, ShieldAlert, TrendingUp, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { EmptyState, Page, Pill, Section, StatCards } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { clean, dt, money, moneyCompact, n0 } from '@/features/telemetry/format'
import { TraceDialog, type TraceTarget } from '@/features/telemetry/trace-dialog'
import type { Alerts, Anomalies } from '@/features/telemetry/types'
import { PlayerLink, QueryError, Segmented, TableSection, When } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/alerts')({
  component: TelemetryAlerts,
})

const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  server_down: { label: 'Serveur tombé', icon: Activity },
  server_up: { label: 'Serveur revenu', icon: Activity },
  error_burst: { label: 'Rafale d’erreurs', icon: AlertTriangle },
  anticheat: { label: 'Anticheat', icon: ShieldAlert },
  money_jump: { label: 'Saut d’argent', icon: TrendingUp },
}
const SEVERITY: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  warn: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',
  ok: 'bg-success/15 text-success',
}
const MINS = [{ value: 100_000, label: '≥ 100 k$' }, { value: 1_000_000, label: '≥ 1 M$' }, { value: 10_000_000, label: '≥ 10 M$' }]
const RANGES = [{ value: 24, label: '24 h' }, { value: 168, label: '7 j' }, { value: 720, label: '30 j' }]

function AnomaliesSection() {
  const [min, setMin] = useState(1_000_000)
  const [hours, setHours] = useState(24)
  const [trace, setTrace] = useState<TraceTarget | null>(null)
  const q = useQuery({ queryKey: ['telemetry', 'anomalies', hours, min], queryFn: () => api<Anomalies>(`/telemetry/anomalies?h=${hours}&min=${min}`), refetchInterval: 60_000 })
  if (q.error) return <QueryError error={q.error} />
  return (
    <>
      <TableSection
        title='Sauts d’argent suspects'
        description='Le plus gros gain d’un joueur entre deux relevés, au-dessus du seuil. « Origine » cherche ce qui l’explique.'
        actions={<><Segmented label='Seuil' value={min} options={MINS} onChange={setMin} /><Segmented label='Période' value={hours} options={RANGES} onChange={setHours} /></>}
        exportName='sauts-argent'
        rows={q.data?.players}
        minWidth='46rem'
        empty='Aucun saut au-dessus du seuil sur la période.'
        rowKey={(p) => p.citizenid}
        columns={[
          { key: 'who', label: 'Joueur', render: (p) => <PlayerLink cid={p.citizenid} name={p.name} />, csv: (p) => p.name ?? p.citizenid },
          { key: 'jump', label: 'Saut', align: 'end', render: (p) => <b className='text-success'>+{money(p.jump)}</b>, csv: (p) => p.jump },
          { key: 'ts', label: 'Quand', render: (p) => <When at={p.ts} />, csv: (p) => dt(p.ts) },
          { key: 'from', label: 'Avant → après', align: 'end', render: (p) => `${moneyCompact(p.prev)} → ${moneyCompact(p.total)}`, csv: (p) => `${p.prev} → ${p.total}` },
          { key: 'net', label: 'Net sur la période', align: 'end', render: (p) => <span className={n0(p.net) >= 0 ? 'text-success' : 'text-destructive'}>{n0(p.net) >= 0 ? '+' : '−'}{moneyCompact(Math.abs(n0(p.net)))}</span>, csv: (p) => p.net },
          { key: 'trace', label: '', align: 'end', render: (p) => <Button variant='outline' size='sm' onClick={() => setTrace({ cid: p.citizenid, ts: p.ts, name: p.name })}><Search /> Origine</Button> },
        ]}
      />
      <TraceDialog target={trace} onClose={() => setTrace(null)} />
    </>
  )
}

function TelemetryAlerts() {
  const { can } = useMe()
  const q = useQuery({ queryKey: ['telemetry', 'alerts'], queryFn: () => api<Alerts>('/telemetry/alerts'), refetchInterval: 60_000 })
  const d = q.data
  const by = Object.fromEntries((d?.byKind ?? []).map((r) => [r.kind, n0(r.n)]))
  const cfg = d?.config
  return (
    <Page
      title='Télémétrie · Alertes'
      description='Serveur injoignable, rafales d’erreurs de la console, détections de l’anticheat et sauts d’argent. Chaque alerte part aussi en notification du panel et dans la catégorie de logs « FiveM — alertes ».'
      actions={can('logs.manage') && <Button asChild variant='outline'><Link to='/logs'><Bell /> Salon Discord des alertes</Link></Button>}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards items={[
            { label: KIND.server_down.label, value: by.server_down ?? 0, icon: Activity, tone: 'danger', hint: '24 h' },
            { label: KIND.error_burst.label, value: by.error_burst ?? 0, icon: AlertTriangle, tone: 'warning', hint: '24 h' },
            { label: KIND.anticheat.label, value: by.anticheat ?? 0, icon: ShieldAlert, tone: 'danger', hint: '24 h' },
            { label: KIND.money_jump.label, value: by.money_jump ?? 0, icon: TrendingUp, tone: 'accent', hint: '24 h' },
          ]} />
          {cfg && (
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <span className='text-muted-foreground'>Règles :</span>
              <Pill>≥ {cfg.errors5min ?? '–'} erreurs / 5 min</Pill>
              <Pill>saut ≥ {moneyCompact(cfg.moneyJump)}</Pill>
              <Pill>canal anticheat « {cfg.anticheatChannel || '–'} »</Pill>
              {can('telemetry.manage') && <Link to='/telemetry/settings' className='text-primary hover:underline'>Modifier</Link>}
            </div>
          )}
          <Section title='Historique' description={d.alerts.length ? `${d.alerts.length} dernières` : undefined}>
            {!d.alerts.length ? <EmptyState title='Aucune alerte. Le serveur est calme.' icon={Bell} /> : (
              <ul className='divide-y'>
                {d.alerts.map((a) => {
                  const k = KIND[a.kind] ?? { label: a.kind, icon: Bell }
                  return (
                    <li key={String(a.id)} className='flex items-start gap-3 px-4 py-3'>
                      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', SEVERITY[a.severity] ?? SEVERITY.info)} aria-hidden><k.icon className='size-4' /></span>
                      <div className='grid min-w-0 flex-1 gap-1'>
                        <p className='font-medium break-words'>{a.title}</p>
                        {a.detail && <p className='text-sm break-words whitespace-pre-line text-muted-foreground'>{clean(a.detail)}</p>}
                        <div className='flex flex-wrap items-center gap-2 text-xs'>
                          <When at={a.ts} />
                          <Pill>{k.label}</Pill>
                          {a.notified && <Pill tone='info'>envoyé sur Discord</Pill>}
                          {a.citizenid && <Link to='/telemetry/players/$cid' params={{ cid: a.citizenid }} className='text-primary hover:underline'>fiche joueur</Link>}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
          {can('telemetry.economy') && <AnomaliesSection />}
        </div>
      )}
    </Page>
  )
}
