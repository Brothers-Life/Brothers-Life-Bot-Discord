import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlarmClock, CheckCircle2, Inbox, Star, Timer, TimerReset } from 'lucide-react'
import { api } from '@/lib/api'
import type { TicketConfig } from '@/lib/types'
import { duration } from '@/lib/format'
import { EmptyState, Section, StatCards, UserAvatar } from '@/components/app/ui'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type TicketStats = {
  from: number
  to: number
  totals: {
    opened: number; closed: number; answered: number
    firstResponseAvg: number | null; firstResponseMedian: number | null
    resolutionAvg: number | null; resolutionMedian: number | null
    slaTracked: number; slaBreaches: number
    ratingAvg: number | null; ratings: number
  }
  volume: { day: string; opened: number; closed: number }[]
  staff: { userId: string; user: { name: string | null; avatar: string | null } | null; claimed: number; closed: number; answered: number; firstResponseAvg: number | null; ratingAvg: number | null; ratings: number }[]
  categories: { categoryId: number | null; name: string | null; emoji: string | null; opened: number; firstResponseAvg: number | null; slaBreaches: number }[]
}

const ALL = '__all__'
const PERIODS = [
  { days: 7, label: '7 derniers jours' },
  { days: 30, label: '30 derniers jours' },
  { days: 90, label: '3 derniers mois' },
  { days: 365, label: '12 derniers mois' },
]

const shortDay = (day: string) => {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}
const axis = { stroke: 'var(--muted-foreground)', fontSize: 12, tickLine: false, axisLine: false }
const tooltip = {
  contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)', fontSize: 12 },
  labelFormatter: (label: unknown) => shortDay(String(label)),
}
const stars = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR')} ★`)

export function TicketStatsPanel({ guildId, config }: { guildId: string; config?: TicketConfig }) {
  const [days, setDays] = useState(30)
  const [categoryId, setCategoryId] = useState(ALL)
  const [network, setNetwork] = useState(false)
  // Rounded to the minute: the query key stays the same while the page is open
  const [now] = useState(() => Math.floor(Date.now() / 60_000) * 60_000)
  const params = new URLSearchParams({ from: String(now - days * 86_400_000), to: String(now) })
  if (!network) params.set('guildId', guildId)
  if (!network && categoryId !== ALL) params.set('categoryId', categoryId)
  const search = params.toString()
  const { data, isLoading } = useQuery({
    queryKey: ['ticket-stats', search],
    queryFn: () => api<TicketStats>(`/tickets/stats?${search}`),
  })

  const t = data?.totals
  const slaRate = t && t.slaTracked ? Math.round(((t.slaTracked - t.slaBreaches) / t.slaTracked) * 100) : null

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <div className='flex flex-wrap items-center gap-3'>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className='w-48' aria-label='Période'><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODS.map((p) => <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={network ? ALL : categoryId} onValueChange={setCategoryId} disabled={network}>
          <SelectTrigger className='w-48' aria-label='Type de ticket'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les types</SelectItem>
            {config?.categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.emoji} {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className='flex items-center gap-2'>
          <Switch id='stats-network' checked={network} onCheckedChange={setNetwork} />
          <Label htmlFor='stats-network'>Tout le réseau</Label>
        </div>
      </div>

      {isLoading || !data || !t ? <Skeleton className='h-96 w-full' /> : (
        <>
          <StatCards
            className='lg:grid-cols-3'
            items={[
              { label: 'Tickets ouverts', value: t.opened, icon: Inbox, hint: `${t.closed} fermé${t.closed > 1 ? 's' : ''}` },
              { label: 'Première réponse moyenne', value: duration(t.firstResponseAvg), icon: Timer, hint: `médiane ${duration(t.firstResponseMedian)}` },
              { label: 'Résolution moyenne', value: duration(t.resolutionAvg), icon: TimerReset, hint: `médiane ${duration(t.resolutionMedian)}` },
              { label: 'Délais (SLA) dépassés', value: t.slaBreaches, icon: AlarmClock, tone: t.slaBreaches ? 'warning' : 'neutral', hint: slaRate === null ? 'aucun SLA réglé' : `${slaRate} % dans les temps` },
              { label: 'Satisfaction', value: stars(t.ratingAvg), icon: Star, tone: 'accent', hint: `${t.ratings} note${t.ratings > 1 ? 's' : ''}` },
              { label: 'Tickets avec réponse du staff', value: t.answered, icon: CheckCircle2, tone: 'success', hint: t.opened ? `${Math.round((t.answered / t.opened) * 100)} %` : undefined },
            ]}
          />

          <div className='rounded-lg border bg-card p-4'>
            <h3 className='mb-3 text-sm font-semibold'>Tickets ouverts et fermés par jour</h3>
            <div className='h-64'>
              <ResponsiveContainer>
                <BarChart data={data.volume} margin={{ left: -12, right: 8, top: 4 }}>
                  <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
                  <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip {...tooltip} cursor={{ fill: 'var(--accent)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey='opened' name='Ouverts' fill='var(--primary)' radius={[4, 4, 0, 0]} />
                  <Bar dataKey='closed' name='Fermés' fill='var(--success)' radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <Section title='Par membre du staff' description='Pris en charge et premières réponses : tickets ouverts sur la période. Fermés et notes : tickets fermés sur la période (la note va à qui a traité le ticket).'>
            {!data.staff.length ? <EmptyState title='Pas encore d’activité du staff sur la période' /> : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead className='text-end'>Pris en charge</TableHead>
                      <TableHead className='text-end'>Fermés</TableHead>
                      <TableHead className='text-end'>1res réponses</TableHead>
                      <TableHead className='text-end'>Délai moyen</TableHead>
                      <TableHead className='text-end'>Note moyenne</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.staff.map((s) => (
                      <TableRow key={s.userId}>
                        <TableCell>
                          <span className='flex items-center gap-2'>
                            <UserAvatar src={s.user?.avatar} name={s.user?.name ?? s.userId} className='size-6' />
                            <span className='truncate'>{s.user?.name ?? s.userId}</span>
                          </span>
                        </TableCell>
                        <TableCell className='text-end tabular-nums'>{s.claimed}</TableCell>
                        <TableCell className='text-end tabular-nums'>{s.closed}</TableCell>
                        <TableCell className='text-end tabular-nums'>{s.answered}</TableCell>
                        <TableCell className='text-end tabular-nums'>{duration(s.firstResponseAvg)}</TableCell>
                        <TableCell className='text-end tabular-nums'>{s.ratings ? `${stars(s.ratingAvg)} (${s.ratings})` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {data.categories.length > 1 && (
            <Section title='Par type de ticket'>
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className='text-end'>Ouverts</TableHead>
                      <TableHead className='text-end'>1re réponse moyenne</TableHead>
                      <TableHead className='text-end'>SLA dépassés</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.categories.map((c) => (
                      <TableRow key={c.categoryId ?? 0}>
                        <TableCell>{c.emoji} {c.name ?? 'Type supprimé'}</TableCell>
                        <TableCell className='text-end tabular-nums'>{c.opened}</TableCell>
                        <TableCell className='text-end tabular-nums'>{duration(c.firstResponseAvg)}</TableCell>
                        <TableCell className='text-end tabular-nums'>{c.slaBreaches}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
