import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, DoorOpen, Landmark, Users, Wifi } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Notice, Page, Pill, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChartCard, HBarChart, TimeChart, type Serie } from '@/features/telemetry/charts'
import { isEmpty } from '@/features/telemetry/chart-utils'
import { dt, fmt, money, moneyCompact, n0, num } from '@/features/telemetry/format'
import type { BusinessDetail, BusinessRow, Businesses, GangRow, Gangs } from '@/features/telemetry/types16'
import { PlayerLink, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/businesses')({
  component: TelemetryBusinesses,
})

const DAYS = [{ value: 1, label: '1 j' }, { value: 7, label: '7 j' }, { value: 30, label: '30 j' }]
const hours = (s: number | null | undefined) => (s == null ? '–' : `${(s / 3600).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`)

function NoData() {
  return <EmptyState title='Pas encore de relevé'>Les données arrivent avec bl_telemetry 1.6, un relevé toutes les 5 minutes.</EmptyState>
}

function Stale({ ts }: { ts: string | null | undefined }) {
  return <Notice tone='warning' title='Le jeu n’envoie plus de relevés'>Les chiffres affichés sont les derniers connus{ts ? ` (relevé du ${dt(ts)})` : ''}.</Notice>
}

function BusinessDialog({ row, onClose }: { row: BusinessRow | null; onClose: () => void }) {
  const [days, setDays] = useState(7)
  const job = row?.job
  const q = useQuery({
    queryKey: ['telemetry', 'business', job, days],
    queryFn: () => api<BusinessDetail>(`/telemetry/business?job=${encodeURIComponent(job!)}&days=${days}`),
    enabled: !!job,
  })
  const d = q.data
  const duty: Serie[] = [
    { key: 'on_duty', label: 'En service', color: 'var(--success)', data: (d?.history ?? []).map((h) => ({ x: h.t, y: num(h.on_duty) })) },
    { key: 'online', label: 'Connectés', color: 'var(--info)', data: (d?.history ?? []).map((h) => ({ x: h.t, y: num(h.online) })) },
  ]
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>{row?.label || row?.job}</DialogTitle>
          <DialogDescription>Activité, ouvertures et temps de service par employé.</DialogDescription>
        </DialogHeader>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
          <div><Segmented label='Période' value={days} options={DAYS} onChange={setDays} /></div>
          {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-60 w-full' /> : (
            <>
              {!d.live && <Stale ts={d.latest?.ts} />}
              <ChartCard title='Employés en service et connectés' empty={isEmpty(duty) && 'Aucun relevé sur la période'}><TimeChart series={duty} kind='line' /></ChartCard>
              <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
                <TableSection
                  title='Ouvertures et fermetures' rows={d.openings} minWidth='18rem' maxHeight='20rem' empty='Aucun changement sur la période.'
                  columns={[
                    { key: 'ts', label: 'Heure', render: (o) => <span className='whitespace-nowrap text-muted-foreground'>{dt(o.ts)}</span> },
                    { key: 'open', label: 'État', render: (o) => (o.open == null ? '–' : <Pill tone={o.open ? 'success' : 'neutral'}>{o.open ? 'ouvert' : 'fermé'}</Pill>) },
                    { key: 'on_duty', label: 'En service', align: 'end', render: (o) => fmt(o.on_duty) },
                  ]}
                />
                <TableSection
                  title='Temps de service par employé' exportName={`service-${d.job}`} rows={d.duty} minWidth='30rem' maxHeight='20rem' empty='Aucun service enregistré sur la période.'
                  columns={[
                    { key: 'name', label: 'Employé', render: (p) => <PlayerLink cid={p.citizenid} name={p.name} />, csv: (p) => p.name ?? p.citizenid },
                    { key: 'shifts', label: 'Services', align: 'end', render: (p) => fmt(p.shifts), csv: (p) => p.shifts },
                    { key: 'hours', label: 'Heures', align: 'end', render: (p) => hours(p.seconds), csv: (p) => Math.round(p.seconds / 360) / 10 },
                    { key: 'last', label: 'Dernière fin', render: (p) => <span className='whitespace-nowrap text-muted-foreground'>{dt(p.last)}</span>, csv: (p) => dt(p.last) },
                    { key: 'dropped', label: 'Coupés (déco.)', align: 'end', render: (p) => (p.dropped ? <span className='text-warning'>{fmt(p.dropped)}</span> : '0'), csv: (p) => p.dropped },
                  ]}
                />
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type SortKey = 'on_duty' | 'online' | 'employees' | 'balance' | 'week_duty_s' | 'level'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'on_duty', label: 'En service' }, { value: 'online', label: 'Connectés' }, { value: 'employees', label: 'Effectif' },
  { value: 'balance', label: 'Caisse' }, { value: 'week_duty_s', label: 'Service' }, { value: 'level', label: 'Niveau' },
]

function CompaniesTab() {
  const [sort, setSort] = useState<SortKey>('on_duty')
  const [picked, setPicked] = useState<BusinessRow | null>(null)
  const q = useQuery({ queryKey: ['telemetry', 'businesses'], queryFn: () => api<Businesses>('/telemetry/businesses'), refetchInterval: 60_000 })
  const d = q.data
  if (q.error) return <QueryError error={q.error} />
  if (!d) return <Skeleton className='h-96 w-full' />
  if (!d.rows.length && !d.totals) return <NoData />
  const t = d.totals
  const showBalance = d.rows.some((r) => r.balance != null)
  const rows = [...d.rows].sort((a, b) => n0(b[sort]) - n0(a[sort]) || (a.label ?? a.job).localeCompare(b.label ?? b.job))
  const byType = Object.entries(t?.duty_by_type ?? {}).map(([name, v]) => ({ name, n: n0(v) })).sort((a, b) => b.n - a.n)
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {!d.live && <Stale ts={d.ts} />}
      <StatCards items={[
        { label: 'Entreprises ouvertes', value: t ? fmt(t.open) : '–', icon: DoorOpen, tone: 'success', hint: t ? `sur ${fmt(t.jobs)}` : undefined },
        { label: 'En service', value: t ? fmt(t.on_duty) : '–', icon: Briefcase, tone: 'accent' },
        { label: 'Connectés', value: t ? fmt(t.online) : '–', icon: Wifi, tone: 'info' },
        ...(t && t.safes != null ? [{ label: 'Caisses', value: moneyCompact(t.safes), icon: Landmark, tone: 'warning' as const }] : []),
      ]} />
      <ChartCard title='Employés en service par type' height='h-56' empty={!byType.some((r) => r.n) && 'Personne en service'}>
        <HBarChart rows={byType} series={[{ key: 'n', label: 'En service' }]} />
      </ChartCard>
      <TableSection
        title='Entreprises' description='Clique sur une ligne pour le détail.' exportName='entreprises' rows={rows} minWidth='52rem' empty='Aucune entreprise.'
        rowKey={(r) => r.job} onRowClick={setPicked}
        actions={<Segmented label='Trier par' value={sort} options={SORTS} onChange={setSort} />}
        columns={[
          { key: 'name', label: 'Entreprise', render: (r) => <span className='flex flex-wrap items-center gap-2'><b>{r.label || r.job}</b>{r.type && <span className='text-xs text-muted-foreground'>{r.type}</span>}</span>, csv: (r) => r.label ?? r.job },
          { key: 'open', label: 'État', render: (r) => (r.open == null ? '—' : <Pill tone={r.open ? 'success' : 'neutral'}>{r.open ? 'ouvert' : 'fermé'}</Pill>), csv: (r) => (r.open == null ? '' : r.open ? 'ouvert' : 'fermé') },
          { key: 'online', label: 'Connectés', align: 'end', render: (r) => fmt(r.online), csv: (r) => r.online },
          { key: 'on_duty', label: 'En service', align: 'end', render: (r) => <b>{fmt(r.on_duty)}</b>, csv: (r) => r.on_duty },
          { key: 'employees', label: 'Effectif', align: 'end', render: (r) => fmt(r.employees), csv: (r) => r.employees },
          ...(showBalance ? [{ key: 'balance', label: 'Caisse', align: 'end' as const, render: (r: BusinessRow) => money(r.balance), csv: (r: BusinessRow) => r.balance }] : []),
          { key: 'level', label: 'Niveau', align: 'end', render: (r) => (r.level == null ? '–' : fmt(r.level)), csv: (r) => r.level },
          { key: 'week', label: 'Service (semaine)', align: 'end', render: (r) => hours(r.week_duty_s), csv: (r) => r.week_duty_s },
        ]}
      />
      <BusinessDialog row={picked} onClose={() => setPicked(null)} />
    </div>
  )
}

function GangsTab() {
  const q = useQuery({ queryKey: ['telemetry', 'gangs'], queryFn: () => api<Gangs>('/telemetry/gangs'), refetchInterval: 60_000 })
  const d = q.data
  if (q.error) return <QueryError error={q.error} />
  if (!d) return <Skeleton className='h-96 w-full' />
  if (!d.rows.length) return <NoData />
  const rows = [...d.rows].sort((a, b) => n0(b.online) - n0(a.online) || n0(b.members) - n0(a.members))
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {!d.live && <Stale ts={d.ts} />}
      <TableSection
        title='Gangs' exportName='gangs' rows={rows} minWidth='40rem' empty='Aucun gang.' rowKey={(r) => r.gang}
        columns={[
          { key: 'name', label: 'Gang', render: (r: GangRow) => <b>{r.label || r.gang}</b>, csv: (r) => r.label ?? r.gang },
          { key: 'category', label: 'Catégorie', render: (r) => (r.category ? <Pill>{r.category}</Pill> : '—'), csv: (r) => r.category },
          { key: 'online', label: 'Connectés', align: 'end', render: (r) => fmt(r.online), csv: (r) => r.online },
          { key: 'members', label: 'Membres', align: 'end', render: (r) => (r.members == null ? '–' : r.max_members ? `${fmt(r.members)} / ${fmt(r.max_members)}` : fmt(r.members)), csv: (r) => r.members },
          { key: 'territories', label: 'Territoires', align: 'end', render: (r) => fmt(r.territories), csv: (r) => r.territories },
          { key: 'xp', label: 'XP', align: 'end', render: (r) => fmt(r.xp), csv: (r) => r.xp },
        ]}
      />
    </div>
  )
}

function TelemetryBusinesses() {
  return (
    <Page title='Télémétrie · Entreprises' description='Métiers et gangs : ouverture, joueurs connectés et en service, caisse, niveau et temps de service.'>
      <Tabs defaultValue='companies' className='gap-4'>
        <TabsList className='h-auto max-w-full flex-wrap justify-start [&>button]:h-8 [&>button]:flex-none'>
          <TabsTrigger value='companies'><Users className='size-4' /> Entreprises</TabsTrigger>
          <TabsTrigger value='gangs'>Gangs</TabsTrigger>
        </TabsList>
        <TabsContent value='companies'><CompaniesTab /></TabsContent>
        <TabsContent value='gangs'><GangsTab /></TabsContent>
      </Tabs>
    </Page>
  )
}
