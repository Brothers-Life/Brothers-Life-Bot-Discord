import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Banknote, Bitcoin, Building2, Coins, Landmark, ShoppingBag, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Page, Pill, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, HBarChart, TimeChart } from '@/features/telemetry/charts'
import { axis, isEmpty, tooltipStyle, type Serie } from '@/features/telemetry/chart-utils'
import { compact, decimal, dt, fmt, money, moneyCompact, msOf, n0, num, timeLabel } from '@/features/telemetry/format'
import type { Economy, Inflation } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/economy')({
  component: TelemetryEconomy,
})

const RANGES = [{ value: 24, label: '24 h' }, { value: 168, label: '7 j' }, { value: 720, label: '30 j' }]
const INF_RANGES = [{ value: 30, label: '30 j' }, { value: 90, label: '90 j' }, { value: 365, label: '1 an' }]

// "↑ 1,2 %" between the first and the last value of a period
function Trend({ first, last }: { first: number | null; last: number | null }) {
  if (!first || last === null) return <span>—</span>
  const pct = ((last - first) / Math.abs(first)) * 100
  if (Math.abs(pct) < 0.05) return <span>stable</span>
  return <span className={pct > 0 ? 'text-success' : 'text-destructive'}>{pct > 0 ? '↑' : '↓'} {decimal(Math.abs(pct), 1)} %</span>
}

function InflationSection() {
  const [days, setDays] = useState(30)
  const q = useQuery({ queryKey: ['telemetry', 'inflation', days], queryFn: () => api<Inflation>(`/telemetry/inflation?d=${days}`) })
  const d = q.data
  const daily = (d?.daily ?? []).map((r) => ({ t: new Date(r.day).getTime(), total: n0(r.cash) + n0(r.bank), chars: n0(r.chars) }))
  const net = daily.length > 1 ? daily[daily.length - 1].total - daily[0].total : null
  const last = daily[daily.length - 1]
  const deltas = daily.slice(1).map((x, i) => ({ x: x.t, y: x.total - daily[i].total }))
  const kinds = new Map<string, { n: number; total: number }>()
  for (const f of d?.flows ?? []) {
    const k = kinds.get(f.kind) ?? { n: 0, total: 0 }
    k.n += n0(f.n)
    k.total += n0(f.total)
    kinds.set(f.kind, k)
  }
  const flowRows = [...kinds.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.total - a.total)
  const span = deltas.length ? deltas[deltas.length - 1].x - deltas[0].x : 0
  return (
    <Section title='Inflation' description='Création ou destruction nette d’argent jour par jour, et répartition des richesses.' actions={<Segmented label='Période de l’inflation' value={days} options={INF_RANGES} onChange={setDays} />}>
      {q.error ? <div className='p-4'><QueryError error={q.error} /></div> : !d ? <Skeleton className='m-4 h-60' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4'>
          <StatCards items={[
            { label: 'Fortune médiane', value: moneyCompact(d.wealth.median), icon: Users, tone: 'info' },
            { label: 'Fortune moyenne', value: moneyCompact(d.wealth.mean), icon: Coins, tone: 'accent', hint: d.wealth.n ? `sur ${fmt(d.wealth.n)} personnages` : undefined },
            {
              label: 'Création nette', icon: net !== null && net < 0 ? TrendingDown : TrendingUp, tone: net !== null && net < 0 ? 'danger' : 'success',
              value: net === null ? '–' : `${net >= 0 ? '+' : '−'}${moneyCompact(Math.abs(net))}`,
              hint: daily.length > 1 ? `en ${daily.length - 1} j · ${moneyCompact(Math.abs(net!) / (daily.length - 1))}/j` : 'pas encore assez de jours',
            },
            { label: 'Argent par personnage', value: last && last.chars ? moneyCompact(last.total / last.chars) : '–', icon: Banknote },
          ]} />
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'>
            <ChartCard title='Création nette par jour' empty={!deltas.length && 'Il faut au moins deux jours de relevés'}>
              <BarChart data={deltas} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
                <XAxis dataKey='x' type='number' scale='time' domain={['dataMin', 'dataMax']} padding={{ left: 12, right: 12 }} tickFormatter={(v) => timeLabel(Number(v), span)} {...axis} minTickGap={32} />
                <YAxis {...axis} width={56} tickFormatter={(v) => moneyCompact(v)} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--accent)' }} labelFormatter={(v) => new Date(Number(v)).toLocaleDateString('fr-FR')} formatter={(v) => [money(Number(v)), 'Création nette']} />
                <Bar dataKey='y' maxBarSize={22} radius={[3, 3, 0, 0]}>
                  {deltas.map((p) => <Cell key={p.x} fill={p.y >= 0 ? 'var(--success)' : 'var(--destructive)'} />)}
                </Bar>
              </BarChart>
            </ChartCard>
            <TableSection
              title='Flux bancaires par type' exportName='flux-par-type' rows={flowRows} minWidth='18rem' empty='Aucun flux bancaire sur la période.'
              columns={[
                { key: 'kind', label: 'Type', render: (r) => <Pill>{r.kind}</Pill>, csv: (r) => r.kind },
                { key: 'n', label: 'Nombre', align: 'end', render: (r) => fmt(r.n), csv: (r) => r.n },
                { key: 'total', label: 'Total', align: 'end', render: (r) => money(r.total), csv: (r) => r.total },
              ]}
            />
          </div>
        </div>
      )}
    </Section>
  )
}

function TelemetryEconomy() {
  const [hours, setHours] = useState(168)
  const q = useQuery({ queryKey: ['telemetry', 'economy', hours], queryFn: () => api<Economy>(`/telemetry/economy?h=${hours}`) })
  const d = q.data
  const mass = d?.mass ?? []
  const first = mass[0]
  const last = mass[mass.length - 1]
  const tot = (r?: Economy['mass'][number]) => (!r || (r.total_cash == null && r.total_bank == null) ? null : n0(r.total_cash) + n0(r.total_bank))
  const extra = d?.extra ?? []
  const firstX = extra.find((r) => r.society != null)
  const lastX = [...extra].reverse().find((r) => r.society != null)
  const firstC = extra.find((r) => r.crypto != null)
  const lastC = [...extra].reverse().find((r) => r.crypto != null)
  const shops = (d?.shops ?? []).map((s) => ({ name: s.shop, ca: n0(s.ca), n: n0(s.n) }))
  const ca = shops.reduce((s, x) => s + x.ca, 0)
  const massSeries: Serie[] = [
    { key: 'cash', label: 'Cash', data: mass.map((r) => ({ x: msOf(r.t), y: num(r.total_cash) })) },
    { key: 'bank', label: 'Banque', color: 'var(--info)', data: mass.map((r) => ({ x: msOf(r.t), y: num(r.total_bank) })) },
  ]
  const flowKinds = new Map<string, Serie>()
  for (const r of d?.flowsByHour ?? []) {
    const s = flowKinds.get(r.kind) ?? { key: `k${flowKinds.size}`, label: r.kind, data: [] }
    s.data.push({ x: msOf(r.t), y: num(r.total) })
    flowKinds.set(r.kind, s)
  }
  const society: Serie[] = [{ key: 'society', label: 'Sociétés', color: 'var(--info)', data: extra.map((r) => ({ x: msOf(r.t), y: num(r.society) })) }]
  const crypto: Serie[] = [{ key: 'crypto', label: 'Crypto', color: '#a78bfa', data: extra.map((r) => ({ x: msOf(r.t), y: num(r.crypto) })) }]

  return (
    <Page
      title='Télémétrie · Économie'
      description='Masse monétaire du serveur, flux bancaires, boutiques, plus grosses fortunes et inflation.'
      actions={<Segmented label='Période' value={hours} options={RANGES} onChange={setHours} />}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards className='lg:grid-cols-3' items={[
            { label: 'Masse monétaire', value: moneyCompact(tot(last)), icon: Landmark, tone: 'accent', hint: <Trend first={tot(first)} last={tot(last)} /> },
            { label: 'Cash', value: moneyCompact(last?.total_cash), icon: Banknote, tone: 'success', hint: <Trend first={num(first?.total_cash)} last={num(last?.total_cash)} /> },
            { label: 'Banque', value: moneyCompact(last?.total_bank), icon: Landmark, tone: 'info', hint: <Trend first={num(first?.total_bank)} last={num(last?.total_bank)} /> },
            { label: 'Chiffre d’affaires des boutiques', value: moneyCompact(ca), icon: ShoppingBag, tone: 'warning', hint: shops.length ? `${shops.length} boutiques · top : ${shops[0].name}` : 'aucune vente' },
            { label: 'Crypto', value: compact(d.latest.total_crypto), icon: Bitcoin, hint: <Trend first={num(firstC?.crypto)} last={num(lastC?.crypto)} /> },
            { label: 'Comptes des sociétés', value: moneyCompact(d.latest.society_total), icon: Building2, hint: <Trend first={num(firstX?.society)} last={num(lastX?.society)} /> },
          ]} />

          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title='Masse monétaire' empty={isEmpty(massSeries) && 'Pas encore de relevé de l’économie'}><TimeChart series={massSeries} unit='money' /></ChartCard>
            <ChartCard title='Flux bancaires par heure' empty={!flowKinds.size && 'Aucun flux sur la période'}><TimeChart series={[...flowKinds.values()]} kind='bar' stacked unit='money' /></ChartCard>
            <ChartCard title='Chiffre d’affaires par boutique' empty={!shops.length && 'Aucune vente sur la période'} height='h-72'>
              <HBarChart rows={shops} unit='money' series={[{ key: 'ca', label: 'Chiffre d’affaires' }]} />
            </ChartCard>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
              <ChartCard title='Comptes des sociétés' height='h-28' empty={isEmpty(society) && 'Pas de relevé'}><TimeChart series={society} unit='money' /></ChartCard>
              <ChartCard title='Crypto en circulation' height='h-28' empty={isEmpty(crypto) && 'Pas de relevé'}><TimeChart series={crypto} /></ChartCard>
            </div>
          </div>

          <InflationSection />

          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2'>
            <TableSection
              title='Plus grosses fortunes' exportName='fortunes' rows={d.top} minWidth='30rem' empty='Pas encore de relevé des joueurs.'
              columns={[
                { key: 'name', label: 'Joueur', render: (p, i) => <span className='flex items-center gap-2'><span className={cn('w-5 text-xs tabular-nums', i < 3 ? 'font-bold text-primary' : 'text-muted-foreground')}>{i + 1}</span><PlayerLink cid={p.citizenid} name={p.name} /></span>, csv: (p) => p.name },
                { key: 'cash', label: 'Cash', align: 'end', render: (p) => money(p.cash), csv: (p) => p.cash },
                { key: 'bank', label: 'Banque', align: 'end', render: (p) => money(p.bank), csv: (p) => p.bank },
                { key: 'total', label: 'Total', align: 'end', render: (p) => <b>{money(p.total)}</b>, csv: (p) => p.total },
              ]}
            />
            <TableSection
              title='Derniers flux bancaires' exportName='flux-bancaires' rows={d.flows} minWidth='34rem' maxHeight='30rem' empty='Aucun flux bancaire.'
              columns={[
                { key: 'ts', label: 'Heure', render: (f) => <span className='whitespace-nowrap text-muted-foreground'>{dt(f.ts)}</span>, csv: (f) => dt(f.ts) },
                { key: 'kind', label: 'Type', render: (f) => <Pill>{f.kind ?? '?'}</Pill>, csv: (f) => f.kind },
                { key: 'from', label: 'De', render: (f) => <PlayerLink cid={f.from_cid} />, csv: (f) => f.from_cid },
                { key: 'to', label: 'Vers', render: (f) => <PlayerLink cid={f.to_cid} />, csv: (f) => f.to_cid },
                { key: 'amount', label: 'Montant', align: 'end', render: (f) => money(f.amount), csv: (f) => f.amount },
              ]}
            />
          </div>
          <TableSection
            title='Derniers achats' exportName='achats' rows={d.purchases} minWidth='42rem' maxHeight='32rem' empty='Aucun achat.'
            columns={[
              { key: 'ts', label: 'Heure', render: (p) => <span className='whitespace-nowrap text-muted-foreground'>{dt(p.ts)}</span>, csv: (p) => dt(p.ts) },
              { key: 'who', label: 'Joueur', render: (p) => <PlayerLink cid={p.citizenid} name={p.player_name} />, csv: (p) => p.player_name ?? p.citizenid },
              { key: 'shop', label: 'Boutique', render: (p) => p.shop ?? '?', csv: (p) => p.shop },
              { key: 'article', label: 'Article', render: (p) => <b>{p.article}</b>, csv: (p) => p.article },
              { key: 'qty', label: 'Qté', align: 'end', render: (p) => fmt(p.qty ?? 1), csv: (p) => p.qty ?? 1 },
              { key: 'total', label: 'Total', align: 'end', render: (p) => <>{money(p.total)}{p.currency && p.currency !== 'cash' && <Mono className='ms-1'>{p.currency}</Mono>}</>, csv: (p) => p.total },
            ]}
          />
        </div>
      )}
    </Page>
  )
}
