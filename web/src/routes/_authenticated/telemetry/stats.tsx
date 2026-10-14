import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, ServerCog, Skull, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { Page, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, Donut, HBarChart } from '@/features/telemetry/charts'
import { dt, fmt, n0, num, percent } from '@/features/telemetry/format'
import type { Insights } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, RankList, Segmented } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/stats')({
  component: TelemetryStats,
})

const RANGES = [{ value: 7, label: '7 jours' }, { value: 30, label: '30 jours' }, { value: 90, label: '90 jours' }]
const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

// Average players per weekday × hour
function Heat({ heat }: { heat: Insights['heat'] }) {
  const grid = new Map<string, { v: number; max: number }>()
  let max = 0
  for (const r of heat) {
    const v = n0(r.avg)
    grid.set(`${r.dow}-${r.hour}`, { v, max: n0(r.max) })
    max = Math.max(max, v)
  }
  return (
    <div className='overflow-x-auto p-4'>
      <table className='w-full min-w-[640px] table-fixed border-separate border-spacing-0.5 text-xs'>
        <thead>
          <tr>
            <th className='w-10' />
            {Array.from({ length: 24 }, (_, h) => <th key={h} className='font-normal text-muted-foreground'>{h % 3 === 0 ? `${h}h` : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {WEEK.map((day, d) => (
            <tr key={day}>
              <th className='pe-2 text-end font-normal text-muted-foreground'>{day}</th>
              {Array.from({ length: 24 }, (_, h) => {
                const c = grid.get(`${d + 1}-${h}`)
                const ratio = c && max ? c.v / max : 0
                return (
                  <td
                    key={h}
                    title={`${day} ${h}h–${h + 1}h · ${c ? `${c.v.toLocaleString('fr-FR')} en moyenne, pic ${c.max}` : 'aucun relevé'}`}
                    className='h-7 rounded-[3px]'
                    style={{ background: c && c.v ? `color-mix(in oklab, var(--primary) ${Math.round(12 + ratio * 88)}%, transparent)` : 'var(--muted)' }}
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TelemetryStats() {
  const [days, setDays] = useState(7)
  const q = useQuery({ queryKey: ['telemetry', 'insights', days], queryFn: () => api<Insights>(`/telemetry/insights?d=${days}`) })
  const d = q.data
  const deaths = (d?.causes ?? []).reduce((s, r) => s + n0(r.n), 0)
  return (
    <Page
      title='Télémétrie · Statistiques'
      description='Affluence par jour et par heure, métiers et gangs, tueurs, armes et causes de mort.'
      actions={<Segmented label='Période' value={days} options={RANGES} onChange={setDays} />}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards items={[
            { label: 'Pic de joueurs', value: d.peak ? n0(d.peak.n) : '–', icon: Users, tone: 'accent', hint: d.peak ? `le ${dt(d.peak.ts)}` : undefined },
            { label: 'Disponibilité 24 h', value: percent(d.uptime.day), icon: Activity, tone: num(d.uptime.day) !== null && n0(d.uptime.day) < 99 ? 'danger' : 'success' },
            { label: 'Disponibilité', value: percent(d.uptime.period), icon: ServerCog, tone: 'info', hint: `sur ${d.days} jours` },
            { label: 'Morts', value: deaths, icon: Skull, tone: 'danger', hint: `${fmt(Math.round(deaths / d.days))} / jour` },
          ]} />
          <Section title='Affluence' description={`Joueurs en moyenne · heure de ${String(d.tz).split('/').pop()?.replace('_', ' ')}`}>
            <Heat heat={d.heat} />
          </Section>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title='Métiers' height='h-72' empty={!d.jobs.length && 'Pas encore de relevé des joueurs'}><Donut rows={d.jobs.map((j) => ({ name: j.name, n: n0(j.n) }))} /></ChartCard>
            <ChartCard title='Gangs' height='h-72' empty={!d.gangs.length && 'Aucun gang'}>
              <HBarChart rows={d.gangs.map((g) => ({ name: g.name, n: n0(g.n), online: n0(g.online) }))} series={[{ key: 'n', label: 'Membres', color: 'var(--info)' }, { key: 'online', label: 'En ligne', color: 'var(--primary)' }]} />
            </ChartCard>
            <Section title='Meilleurs tueurs'>
              <RankList rows={d.killers.map((r) => ({ key: r.name, label: <PlayerLink cid={r.citizenid} name={r.name} />, value: n0(r.n) }))} />
            </Section>
            <Section title='Armes les plus utilisées'>
              <RankList rows={d.weapons.map((r) => ({ key: r.name, label: <Mono>{r.name.replace(/^WEAPON_/i, '').toLowerCase()}</Mono>, value: n0(r.n) }))} />
            </Section>
            <ChartCard title='Causes de mort' height='h-72' className='lg:col-span-2' empty={!d.causes.length && 'Aucune mort sur la période'}><Donut rows={d.causes.map((c) => ({ name: c.name, n: n0(c.n) }))} /></ChartCard>
          </div>
        </div>
      )}
    </Page>
  )
}
