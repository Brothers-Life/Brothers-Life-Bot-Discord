import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Page, Pill, type Tone } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, TimeChart, type Serie } from '@/features/telemetry/charts'
import { clean, dt, msOf, num } from '@/features/telemetry/format'
import { explosionLabel } from '@/features/telemetry/labels'
import type { Admin } from '@/features/telemetry/types'
import { PlayerLink, QueryError, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/security')({
  component: TelemetrySecurity,
})

const ACTION_TONE: Record<string, Tone> = { ban: 'danger', kick: 'warning', warn: 'warning', unban: 'success', jail: 'info' }

function TelemetrySecurity() {
  const q = useQuery({ queryKey: ['telemetry', 'admin'], queryFn: () => api<Admin>('/telemetry/admin'), refetchInterval: 60_000 })
  const d = q.data
  const deaths: Serie[] = [{ key: 'n', label: 'Morts', color: 'var(--destructive)', data: (d?.deathsByHour ?? []).map((r) => ({ x: msOf(r.t), y: num(r.n) })) }]
  return (
    <Page title='Télémétrie · Sécurité' description='Actions de txAdmin, connexions et déconnexions, explosions, et morts par heure sur 7 jours.'>
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <ChartCard title='Morts par heure (7 j)' height='h-48' empty={!deaths[0].data.length && 'Aucune mort sur 7 jours'}><TimeChart series={deaths} kind='bar' /></ChartCard>
          <TableSection
            title='Actions txAdmin' exportName='actions-txadmin' rows={d.actions} minWidth='48rem' maxHeight='32rem' empty='Aucune action staff.'
            columns={[
              { key: 'ts', label: 'Heure', render: (a) => <span className='whitespace-nowrap text-muted-foreground'>{dt(a.ts)}</span>, csv: (a) => dt(a.ts) },
              { key: 'action', label: 'Action', render: (a) => <Pill tone={ACTION_TONE[String(a.action).toLowerCase()] ?? 'neutral'}>{a.action ?? '?'}</Pill>, csv: (a) => a.action },
              { key: 'staff', label: 'Staff', render: (a) => <b>{a.staff ?? '–'}</b>, csv: (a) => a.staff },
              { key: 'target', label: 'Cible', render: (a) => a.target ?? '–', csv: (a) => a.target },
              { key: 'reason', label: 'Raison', render: (a) => <span className='break-words'>{clean(a.reason) || '–'}</span>, csv: (a) => clean(a.reason) },
              { key: 'duration', label: 'Durée', render: (a) => <span className='whitespace-nowrap'>{a.duration ?? '–'}</span>, csv: (a) => a.duration },
            ]}
          />
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
            <TableSection
              title='Connexions' exportName='connexions' rows={d.connections} minWidth='36rem' maxHeight='32rem' empty='Aucune connexion.'
              columns={[
                { key: 'start', label: 'Arrivée', render: (c) => <span className='whitespace-nowrap text-muted-foreground'>{dt(c.start_ts)}</span>, csv: (c) => dt(c.start_ts) },
                { key: 'who', label: 'Joueur', render: (c) => <PlayerLink cid={c.citizenid} name={c.player_name} />, csv: (c) => c.player_name ?? c.citizenid },
                { key: 'end', label: 'Départ', render: (c) => (c.end_ts ? <span className='whitespace-nowrap text-muted-foreground'>{dt(c.end_ts)}</span> : <Pill tone='success'>en ligne</Pill>), csv: (c) => (c.end_ts ? dt(c.end_ts) : 'en ligne') },
                { key: 'reason', label: 'Raison', render: (c) => <span className='break-words text-muted-foreground'>{c.drop_reason ?? '–'}</span>, csv: (c) => c.drop_reason },
              ]}
            />
            <TableSection
              title='Explosions' exportName='explosions' rows={d.explosions} minWidth='26rem' maxHeight='32rem' empty='Aucune explosion.'
              columns={[
                { key: 'ts', label: 'Heure', render: (e) => <span className='whitespace-nowrap text-muted-foreground'>{dt(e.ts)}</span>, csv: (e) => dt(e.ts) },
                { key: 'who', label: 'Joueur', render: (e) => <PlayerLink cid={e.citizenid} name={e.player_name} />, csv: (e) => e.player_name ?? e.citizenid },
                { key: 'type', label: 'Type', render: (e) => <Pill tone='danger'>{explosionLabel(e.type)}</Pill>, csv: (e) => explosionLabel(e.type) },
              ]}
            />
          </div>
        </div>
      )}
    </Page>
  )
}
