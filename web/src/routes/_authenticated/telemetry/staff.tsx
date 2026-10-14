import { useDeferredValue, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Gavel, ListChecks, MapPinned, Search, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Page, Pill, StatCards, UserAvatar, type Tone } from '@/components/app/ui'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, Donut, TimeChart, type Serie } from '@/features/telemetry/charts'
import { clean, dt, fmt } from '@/features/telemetry/format'
import { sourceLabel } from '@/features/telemetry/labels'
import type { StaffView } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, Segmented, TableSection, When } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/staff')({
  component: TelemetryStaff,
})

const RANGES = [{ value: 1, label: '24 h' }, { value: 7, label: '7 j' }, { value: 30, label: '30 j' }]
const CAT_TONE: Record<string, Tone> = { ban: 'danger', unban: 'success', kick: 'warning', warn: 'warning', tp: 'info', soin: 'success', prison: 'danger', 'argent / objets': 'accent', annonce: 'info', 'accès panel': 'accent' }
const MAIN = ['ban', 'kick', 'warn', 'tp', 'soin', 'argent / objets']
const ALL = '__all'

function TelemetryStaff() {
  const [days, setDays] = useState(7)
  const [staff, setStaff] = useState('')
  const [cat, setCat] = useState('')
  const [text, setText] = useState('')
  const term = useDeferredValue(text.trim())
  const params = new URLSearchParams({ days: String(days) })
  if (staff) params.set('staff', staff)
  if (cat) params.set('cat', cat)
  if (term) params.set('q', term)
  const q = useQuery({ queryKey: ['telemetry', 'staff', params.toString()], queryFn: () => api<StaffView>(`/telemetry/staff?${params}`), refetchInterval: 60_000, placeholderData: (prev) => prev })
  const d = q.data
  const cats = d?.categories ?? {}
  const sum = (...k: string[]) => k.reduce((s, x) => s + (cats[x] ?? 0), 0)
  const period = days === 1 ? 'sur 24 h' : `sur ${days} jours`
  const daySerie: Serie[] = [{ key: 'n', label: 'Actions', color: 'var(--info)', data: Object.entries(d?.days_activity ?? {}).sort().map(([k, v]) => ({ x: new Date(k).getTime(), y: v })) }]
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }))
  return (
    <Page
      title='Télémétrie · Suivi staff'
      description='Qui ban, kick, téléporte, donne de l’argent… Actions de txAdmin, des menus staff du jeu et des annonces du panel.'
      actions={<Segmented label='Période' value={days} options={RANGES} onChange={setDays} />}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6 transition-opacity', q.isPlaceholderData && 'opacity-70')}>
          <StatCards items={[
            { label: 'Actions', value: d.total, icon: ListChecks, tone: 'accent', hint: `${period}${d.truncated ? ' · 3 000 dernières' : ''}` },
            { label: 'Membres du staff actifs', value: d.staff.filter((x) => x.actor !== '?').length, icon: Users, tone: 'info', hint: d.staff[0] ? `le plus actif : ${d.staff[0].actor}` : period },
            { label: 'Sanctions', value: sum('ban', 'kick', 'warn'), icon: Gavel, tone: 'danger', hint: `${cats.ban ?? 0} ban · ${cats.kick ?? 0} kick · ${cats.warn ?? 0} warn` },
            { label: 'Téléportations', value: cats.tp ?? 0, icon: MapPinned, tone: 'warning', hint: period },
          ]} />
          <TableSection
            title='Par membre du staff' description='Clique une ligne pour ne voir que ses actions.' exportName='staff' rows={d.staff} minWidth='56rem'
            empty='Aucune action staff sur la période.'
            rowKey={(x) => x.actor}
            onRowClick={(x) => setStaff(staff === x.actor ? '' : x.actor)}
            rowClassName={(x) => (x.actor === staff ? 'bg-primary/10' : undefined)}
            columns={[
              { key: 'actor', label: 'Staff', render: (x) => <span className='flex items-center gap-2 font-medium'><UserAvatar name={x.actor} className='size-6 text-[10px]' />{x.actor}</span>, csv: (x) => x.actor },
              { key: 'total', label: 'Total', align: 'end', render: (x) => <b>{fmt(x.total)}</b>, csv: (x) => x.total },
              ...MAIN.map((k) => ({ key: k, label: k, align: 'end' as const, render: (x: StaffView['staff'][number]) => (x.cats[k] ? <b>{fmt(x.cats[k])}</b> : <span className='text-muted-foreground'>–</span>), csv: (x: StaffView['staff'][number]) => x.cats[k] ?? 0 })),
              { key: 'other', label: 'Autres', align: 'end', render: (x) => fmt(x.total - MAIN.reduce((s, k) => s + (x.cats[k] ?? 0), 0)), csv: (x) => x.total - MAIN.reduce((s, k) => s + (x.cats[k] ?? 0), 0) },
              { key: 'last', label: 'Dernière', render: (x) => <When at={x.last} />, csv: (x) => dt(x.last) },
              { key: 'sources', label: 'Sources', render: (x) => <span className='flex flex-wrap gap-1'>{x.sources.map((s) => <Pill key={s}>{sourceLabel(null, s)}</Pill>)}</span>, csv: (x) => x.sources.map((s) => sourceLabel(null, s)).join(', ') },
            ]}
          />
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title='Actions par jour' empty={!daySerie[0].data.length && 'Aucune action'}><TimeChart series={daySerie} kind='bar' /></ChartCard>
            <ChartCard title='Types d’actions' empty={!catRows.length && 'Aucune action'}><Donut rows={catRows} /></ChartCard>
          </div>
          <TableSection
            title='Actions'
            description={`${fmt(d.items.length)}${d.items.length >= 500 ? '+' : ''} action${d.items.length > 1 ? 's' : ''}`}
            actions={
              <div className='flex w-full flex-wrap gap-2 sm:w-auto'>
                <Select value={staff || ALL} onValueChange={(v) => setStaff(v === ALL ? '' : v)}>
                  <SelectTrigger className='w-full sm:w-44' aria-label='Staff'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tout le staff</SelectItem>
                    {d.staff.map((x) => <SelectItem key={x.actor} value={x.actor}>{x.actor}</SelectItem>)}
                    {staff && !d.staff.some((x) => x.actor === staff) && <SelectItem value={staff}>{staff}</SelectItem>}
                  </SelectContent>
                </Select>
                <Select value={cat || ALL} onValueChange={(v) => setCat(v === ALL ? '' : v)}>
                  <SelectTrigger className='w-full sm:w-44' aria-label='Type d’action'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Toutes les actions</SelectItem>
                    {Object.keys(cats).sort().map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    {cat && !(cat in cats) && <SelectItem value={cat}>{cat}</SelectItem>}
                  </SelectContent>
                </Select>
                <div className='relative w-full sm:w-52'>
                  <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
                  <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Raison, cible…' aria-label='Chercher une action' className='ps-8' />
                </div>
              </div>
            }
            exportName='actions-staff' rows={d.items} minWidth='52rem' maxHeight='40rem' empty='Aucune action ne correspond aux filtres.'
            columns={[
              { key: 'ts', label: 'Heure', render: (it) => <span className='whitespace-nowrap text-muted-foreground'>{dt(it.ts)}</span>, csv: (it) => dt(it.ts) },
              { key: 'actor', label: 'Staff', render: (it) => <b>{it.actor}</b>, csv: (it) => it.actor },
              { key: 'cat', label: 'Action', render: (it) => <span className='flex flex-wrap items-center gap-1'><Pill tone={CAT_TONE[it.category] ?? 'neutral'}>{it.category}</Pill><span className='text-xs text-muted-foreground'>{it.action}</span></span>, csv: (it) => `${it.category} (${it.action ?? ''})` },
              { key: 'target', label: 'Cible', render: (it) => (it.targetCid ? <PlayerLink cid={it.targetCid} name={it.target || it.targetCid} /> : it.target || '–'), csv: (it) => it.target ?? it.targetCid },
              { key: 'reason', label: 'Raison', render: (it) => <span className='break-words'>{clean(it.reason ?? '')}{it.duration && <Mono className='ms-1'>{it.duration}</Mono>}</span>, csv: (it) => clean(it.reason ?? '') },
              { key: 'source', label: 'Source', render: (it) => <Pill>{sourceLabel(null, it.source)}</Pill>, csv: (it) => sourceLabel(null, it.source) },
            ]}
          />
        </div>
      )}
    </Page>
  )
}
