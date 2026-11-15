import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Gauge, PackageCheck, Timer, UserCog, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Notice, Page, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, Donut, TimeChart, type Serie } from '@/features/telemetry/charts'
import { isEmpty } from '@/features/telemetry/chart-utils'
import { decimal, fmt, n0, num, percent } from '@/features/telemetry/format'
import type { Health } from '@/features/telemetry/types16'
import { ConsoleLine, Mono, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/health')({
  component: TelemetryHealth,
})

const RANGES = [{ value: 24, label: '24 h' }, { value: 168, label: '7 j' }, { value: 720, label: '30 j' }]
const DROPS: Record<string, string> = {
  quit: 'Départ volontaire', crash: 'Crash', timeout: 'Perte de connexion', kick: 'Expulsion', ban: 'Bannissement', restart: 'Redémarrage', other: 'Autre',
}

// "3 j 4 h", "2 h 10 min"
function span(seconds: number | null | undefined) {
  if (seconds == null) return '–'
  const m = Math.floor(seconds / 60)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d) return `${d} j ${h} h`
  return h ? `${h} h ${m % 60} min` : `${m} min`
}

function Funnel({ c }: { c: Health['connects'] }) {
  const steps = [
    { label: 'Tentatives de connexion', n: c.attempts },
    { label: 'Entrés sur le serveur', n: c.joined },
    { label: 'Personnage chargé', n: c.loaded },
  ].filter((s) => s.n != null)
  if (!steps.length) return <EmptyState title='Pas encore de connexions relevées' />
  const top = Math.max(1, ...steps.map((s) => n0(s.n)))
  return (
    <ul className='grid gap-3 p-4'>
      {steps.map((s, i) => {
        const prev = i ? n0(steps[i - 1].n) : null
        const lost = prev === null ? null : Math.max(0, prev - n0(s.n))
        return (
          <li key={s.label} className='grid gap-1'>
            {lost !== null && prev! > 0 && <p className='text-xs text-muted-foreground'>↓ {fmt(lost)} perdu(s) ({percent((lost / prev!) * 100, 1)})</p>}
            <div className='relative overflow-hidden rounded-md bg-muted px-3 py-2 text-sm'>
              <span className='absolute inset-y-0 start-0 bg-primary/20' style={{ width: `${(n0(s.n) / top) * 100}%` }} aria-hidden />
              <span className='relative flex justify-between gap-2'><span>{s.label}</span><b className='tabular-nums'>{fmt(s.n)}</b></span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function TelemetryHealth() {
  const [hours, setHours] = useState(24)
  const q = useQuery({ queryKey: ['telemetry', 'health', hours], queryFn: () => api<Health>(`/telemetry/health?h=${hours}`), refetchInterval: 60_000 })
  const d = q.data
  const l = d?.latest
  const res = l?.data?.resources
  const hitches = (d?.curve ?? []).reduce((s, p) => s + n0(p.hitches), 0)
  const series = (key: 'players' | 'ping_avg' | 'ping_max' | 'hitches') => (d?.curve ?? []).map((p) => ({ x: p.t, y: num(p[key]) }))
  const players: Serie[] = [{ key: 'players', label: 'Joueurs', data: series('players') }]
  const ping: Serie[] = [
    { key: 'ping_avg', label: 'Ping moyen', color: 'var(--info)', data: series('ping_avg') },
    { key: 'ping_max', label: 'Ping max', color: 'var(--warning)', data: series('ping_max') },
  ]
  const hitch: Serie[] = [{ key: 'hitches', label: 'Hitchs', color: 'var(--warning)', data: series('hitches') }]
  const drops = Object.entries(d?.drops ?? {}).map(([k, v]) => ({ name: DROPS[k] ?? k, n: n0(v) })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n)
  return (
    <Page
      title='Télémétrie · Santé du serveur'
      description='Joueurs, ping, ralentissements, erreurs des ressources, requêtes lentes, déconnexions et parcours de connexion.'
      actions={<Segmented label='Période' value={hours} options={RANGES} onChange={setHours} />}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : !l && !d.curve.length ? (
        <Section title='Santé'><EmptyState title='Pas encore de relevé'>Les données arrivent avec bl_telemetry 1.6, un relevé toutes les 5 minutes.</EmptyState></Section>
      ) : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {!d.current && <Notice tone='warning' title='Le jeu n’envoie plus de relevés'>Les chiffres affichés sont les derniers connus{l ? ` (relevé du ${new Date(l.ts).toLocaleString('fr-FR')})` : ''}.</Notice>}
          {n0(l?.queue) > 500 && <Notice tone='warning' title='Le jeu a des envois en attente'>L’API répond lentement : {fmt(l?.queue)} envois attendent d’être transmis.</Notice>}
          <StatCards items={[
            { label: 'Joueurs', value: l?.players == null ? '–' : `${fmt(l.players)}${l.max_players ? ` / ${fmt(l.max_players)}` : ''}`, icon: Users, tone: 'accent' },
            { label: 'Staff en service', value: fmt(l?.staff_on_duty), icon: UserCog, tone: 'info' },
            { label: 'Ping', value: l?.ping_avg == null ? '–' : `${decimal(l.ping_avg, 0)} ms`, icon: Activity, tone: 'success', hint: l?.ping_max != null ? `max ${fmt(l.ping_max)} ms` : undefined },
            { label: 'Hitchs sur la période', value: fmt(hitches), icon: Gauge, tone: 'warning', hint: l?.hitch_max_ms ? `dernier relevé : pire ${fmt(l.hitch_max_ms)} ms` : undefined },
            { label: 'Ressources', value: res ? fmt(res.started) : '–', icon: PackageCheck, tone: 'success', hint: res ? `démarrées · ${fmt(res.stopped)} arrêtée(s)` : undefined },
            { label: 'Depuis le démarrage', value: span(l?.data?.server_uptime_s), icon: Timer },
          ]} />
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title='Joueurs connectés' empty={isEmpty(players) && 'Aucun relevé'}><TimeChart series={players} /></ChartCard>
            <ChartCard title='Ping' empty={isEmpty(ping) && 'Aucun relevé'}><TimeChart series={ping} kind='line' yUnit='ms' /></ChartCard>
            <ChartCard title='Hitchs (ralentissements du serveur)' className='lg:col-span-2' height='h-48' empty={isEmpty(hitch) && 'Aucun relevé'}><TimeChart series={hitch} kind='bar' /></ChartCard>
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2'>
            <TableSection
              title='Erreurs par ressource' exportName='erreurs-ressources' rows={d.errors} minWidth='34rem' maxHeight='30rem' empty='Aucune erreur sur la période.'
              columns={[
                { key: 'resource', label: 'Ressource', render: (r) => <Mono>{r.resource}</Mono>, csv: (r) => r.resource },
                { key: 'n', label: 'Erreurs', align: 'end', render: (r) => <b className='text-destructive'>{fmt(r.n)}</b>, csv: (r) => r.n },
                { key: 'sample', label: 'Exemple', render: (r) => (r.sample ? <span className='line-clamp-2 block max-w-md'><ConsoleLine line={r.sample.slice(0, 240)} /></span> : '–'), csv: (r) => r.sample },
              ]}
            />
            <TableSection
              title='Requêtes lentes par ressource' exportName='requetes-lentes' rows={d.slowQueries} minWidth='24rem' maxHeight='30rem' empty='Aucune requête lente sur la période.'
              columns={[
                { key: 'resource', label: 'Ressource', render: (r) => <Mono>{r.resource}</Mono>, csv: (r) => r.resource },
                { key: 'n', label: 'Requêtes', align: 'end', render: (r) => <b>{fmt(r.n)}</b>, csv: (r) => r.n },
                { key: 'max', label: 'La plus lente', align: 'end', render: (r) => (r.max_ms == null ? '–' : `${fmt(r.max_ms)} ms`), csv: (r) => r.max_ms },
              ]}
            />
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title='Déconnexions par cause' empty={!drops.length && 'Aucune déconnexion relevée'}><Donut rows={drops} /></ChartCard>
            <Section title='Parcours de connexion' description='Tentative, entrée sur le serveur, personnage chargé.'><Funnel c={d.connects ?? {}} /></Section>
          </div>
        </div>
      )}
    </Page>
  )
}
