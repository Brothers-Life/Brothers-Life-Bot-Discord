import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Gamepad2, IdCard, LogIn, Skull } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Page, Pill, Section, StatCards } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, TimeChart } from '@/features/telemetry/charts'
import { isEmpty, type Serie } from '@/features/telemetry/chart-utils'
import { decimal, dt, fmt, msOf, n0, num } from '@/features/telemetry/format'
import type { Overview } from '@/features/telemetry/types'
import { ConsoleLine, Mono, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/')({
  component: TelemetryOverview,
})

const RANGES = [{ value: 6, label: '6 h' }, { value: 24, label: '24 h' }, { value: 168, label: '7 j' }]
const THREAD_COLOR: Record<string, string> = { svMain: 'var(--primary)', svNetwork: 'var(--info)', svSync: 'var(--success)' }

// Availability band: 48 slices over the period, green when every reading answered
// end: when the data was loaded
function Uptime({ up, hours, end }: { up: Overview['up']; hours: number; end: number }) {
  const seg = 48
  const start = end - hours * 3600e3
  const step = (end - start) / seg
  const buckets = Array.from({ length: seg }, () => ({ ok: 0, down: 0 }))
  let ok = 0
  for (const r of up) {
    const i = Math.floor((msOf(r.t) - start) / step)
    if (i < 0 || i >= seg) continue
    if (n0(r.value) === 1) {
      buckets[i].ok++
      ok++
    }
    else buckets[i].down++
  }
  const pct = up.length ? (ok / up.length) * 100 : null
  return (
    <Section
      title='Disponibilité du serveur'
      description='Un relevé toutes les 15 s de l’adresse du serveur FiveM (réglée dans Réglages).'
      actions={<Pill tone={pct === null ? 'neutral' : pct < 99 ? 'danger' : 'success'}>{pct === null ? 'aucun relevé' : `${decimal(pct, pct === 100 ? 0 : 2)} %`}</Pill>}
    >
      <div className='flex h-10 gap-0.5 p-4 pt-3' role='img' aria-label={`Disponibilité ${pct === null ? 'inconnue' : `${decimal(pct, 2)} %`}`}>
        {buckets.map((b, i) => {
          const from = new Date(start + i * step).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          const label = !b.ok && !b.down ? 'pas de relevé' : b.down ? `${b.down} relevé(s) en échec` : 'en ligne'
          return <span key={i} title={`${from} · ${label}`} className={cn('h-6 min-w-0 flex-1 rounded-sm', !b.ok && !b.down ? 'bg-muted' : !b.down ? 'bg-success' : !b.ok ? 'bg-destructive' : 'bg-warning')} />
        })}
      </div>
    </Section>
  )
}

function TelemetryOverview() {
  const [hours, setHours] = useState(24)
  const q = useQuery({ queryKey: ['telemetry', 'overview', hours], queryFn: () => api<Overview>(`/telemetry/overview?h=${hours}`), refetchInterval: 30_000 })
  const d = q.data
  const k = d?.counts ?? {}
  const online = num(k.online)
  const max = num(k.max)
  const up = n0(k.up) === 1
  const fill = max ? Math.min(100, Math.round(((online ?? 0) / max) * 100)) : 0
  const threads = new Map<string, Serie>()
  for (const r of d?.tick ?? []) {
    const s = threads.get(r.thread) ?? { key: r.thread, label: r.thread, color: THREAD_COLOR[r.thread], data: [] }
    s.data.push({ x: msOf(r.t), y: num(r.ms) })
    threads.set(r.thread, s)
  }
  const onlineSerie: Serie[] = [{ key: 'online', label: 'Joueurs', data: (d?.online ?? []).map((r) => ({ x: msOf(r.t), y: num(r.value) })) }]
  // 48 bars of the online history, as the HUD of the old panel
  const hist = d?.online ?? []
  const peak = Math.max(1, max ?? 0, ...hist.map((p) => n0(p.value)))

  return (
    <Page
      title='Télémétrie · Vue d’ensemble'
      description='Ce que le serveur FiveM envoie au bot (ressource bl_telemetry) : joueurs en ligne, santé du serveur, erreurs récentes.'
      actions={<Segmented label='Période' value={hours} options={RANGES} onChange={setHours} />}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <section className='brackets grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border bg-card p-5 md:grid-cols-[auto_minmax(0,1fr)]'>
            <div className='flex items-center gap-4'>
              <div className='relative grid size-24 shrink-0 place-items-center rounded-full' style={{ background: `conic-gradient(var(--primary) ${fill * 3.6}deg, var(--muted) 0deg)` }}>
                <div className='grid size-20 place-items-center rounded-full bg-card text-center'>
                  <div>
                    <div className='font-display text-2xl leading-none font-semibold tabular-nums'>{fmt(online)}</div>
                    <div className='text-[11px] text-muted-foreground'>{max ? `/ ${fmt(max)}` : 'en ligne'}</div>
                  </div>
                </div>
              </div>
              <div className='grid gap-1'>
                <div className='flex items-center gap-2'>
                  <span className={cn('live-dot size-2.5 rounded-full', up ? 'bg-success' : 'bg-destructive')} aria-hidden />
                  <span className='font-medium'>{up ? 'Serveur en ligne' : 'Serveur injoignable'}</span>
                </div>
                <span className='text-sm text-muted-foreground'>{max ? `${fill} % de remplissage · ${fmt(max)} places` : 'capacité inconnue'}</span>
                <Button asChild variant='outline' size='sm' className='w-fit'><Link to='/telemetry/live'><Activity /> Suivre en direct</Link></Button>
              </div>
            </div>
            <div className='flex h-24 items-end gap-0.5 overflow-hidden' aria-hidden>
              {Array.from({ length: 48 }, (_, i) => {
                const p = hist[Math.floor((i * hist.length) / 48)]
                const v = p ? n0(p.value) : 0
                return <span key={i} title={p ? `${dt(msOf(p.t))} · ${fmt(v)} joueurs` : ''} className={cn('min-w-0 flex-1 rounded-t-sm', v > 0 ? 'bg-primary/70' : 'bg-muted')} style={{ height: `${Math.max(4, (v / peak) * 96)}px` }} />
              })}
            </div>
          </section>

          <StatCards items={[
            { label: 'Personnages', value: n0(k.chars), icon: IdCard, tone: 'accent' },
            { label: 'Connexions (24 h)', value: n0(k.sessions24), icon: LogIn, tone: 'success' },
            { label: 'Morts (24 h)', value: n0(k.deaths24), icon: Skull, tone: 'danger' },
            { label: 'Événements (24 h)', value: n0(k.events24), icon: Gamepad2, tone: 'info', hint: `${fmt(k.logs24)} lignes de console` },
          ]} />

          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title='Joueurs en ligne' empty={isEmpty(onlineSerie) && 'Pas encore de relevé'}><TimeChart series={onlineSerie} /></ChartCard>
            <ChartCard title='Temps par tick du serveur (ms)' empty={!threads.size && 'Pas de mesure de tick'}><TimeChart series={[...threads.values()]} kind='line' yUnit='ms' /></ChartCard>
          </div>

          <Uptime up={d.up} hours={hours} end={q.dataUpdatedAt} />

          <TableSection
            title='Erreurs récentes de la console'
            description={d.errors.length ? `${d.errors.length} dernières` : undefined}
            exportName='erreurs-console'
            rows={d.errors}
            empty='Aucune erreur récente. Tout roule.'
            minWidth='36rem'
            maxHeight='28rem'
            columns={[
              { key: 'ts', label: 'Heure', render: (e) => <span className='whitespace-nowrap text-muted-foreground'>{dt(e.ts)}</span>, csv: (e) => dt(e.ts) },
              { key: 'channel', label: 'Ressource', render: (e) => <Mono>{e.channel ?? '?'}</Mono>, csv: (e) => e.channel },
              { key: 'line', label: 'Message', render: (e) => <ConsoleLine line={e.line} />, csv: (e) => e.line },
            ]}
          />
        </div>
      )}
    </Page>
  )
}
