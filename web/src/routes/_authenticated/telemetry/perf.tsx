import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, Cpu, Gauge, Info, MapPin, MonitorPlay, Zap, type LucideIcon } from 'lucide-react'
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, BarChart, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EmptyState, Page, Pill, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, HBarChart, TimeChart } from '@/features/telemetry/charts'
import { axis, tooltipStyle, type Serie } from '@/features/telemetry/chart-utils'
import { decimal, dt, fmt, msOf, n0, num, timeLabel } from '@/features/telemetry/format'
import type { PerfView } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'
import { zoneName } from '@/features/telemetry/zones'

export const Route = createFileRoute('/_authenticated/telemetry/perf')({
  component: TelemetryPerf,
})

const RANGES = [{ value: 6, label: '6 h' }, { value: 24, label: '24 h' }, { value: 168, label: '7 j' }]
const SEV: Record<string, { icon: LucideIcon; tone: string }> = {
  critical: { icon: AlertTriangle, tone: 'bg-destructive/15 text-destructive' },
  warn: { icon: Zap, tone: 'bg-warning/15 text-warning' },
  info: { icon: Info, tone: 'bg-info/15 text-info' },
}
const fpsClass = (fps: number | null) => (fps === null ? '' : fps < 30 ? 'text-destructive' : fps < 45 ? 'text-warning' : 'text-success')
const INSTALLED_FILTERS = [{ value: 'maps', label: 'Cartes et MLO' }, { value: 'files', label: 'Plus de fichiers' }, { value: 'stopped', label: 'Arrêtées' }, { value: 'all', label: 'Toutes' }]

function Delta({ fps, base }: { fps: number | null; base: number | null }) {
  if (!base || fps === null) return <span className='text-muted-foreground'>–</span>
  const d = (fps / base - 1) * 100
  return <span className={d <= -40 ? 'font-medium text-destructive' : d <= -20 ? 'text-warning' : 'text-muted-foreground'}>{d > 0 ? '+' : ''}{d.toFixed(0)} %</span>
}

// "#map=x,y" and "#scripts" of the recommendations, as links of this panel
function RecLink({ link }: { link: string }) {
  const map = /^#map=(-?\d+),(-?\d+)$/.exec(link)
  if (map) return <Link to='/telemetry/deathmap' search={{ at: `${map[1]},${map[2]}` }} className='text-primary hover:underline'>voir sur la carte</Link>
  if (link === '#scripts') return <Link to='/telemetry/scripts' className='text-primary hover:underline'>voir le détail</Link>
  return null
}

function MapButton({ x, y }: { x: unknown; y: unknown }) {
  const nx = num(x as number)
  const ny = num(y as number)
  if (nx === null || ny === null) return null
  return <Link to='/telemetry/deathmap' search={{ at: `${Math.round(nx)},${Math.round(ny)}` }} className='inline-flex text-primary' title='Voir sur la carte'><MapPin className='size-4' /><span className='sr-only'>Voir sur la carte</span></Link>
}

function TelemetryPerf() {
  const [hours, setHours] = useState(24)
  const [filter, setFilter] = useState('maps')
  const q = useQuery({ queryKey: ['telemetry', 'perf', hours], queryFn: () => api<PerfView>(`/telemetry/perf?h=${hours}`), refetchInterval: 120_000 })
  const d = q.data
  const main = d?.server.threads.find((t) => t.thread === 'svMain')
  const c = d?.clients
  const e = d?.entities ?? null
  const totalEnt = e ? (['vehicles', 'peds', 'objects'] as const).reduce((s, k) => s + (e[k]?.total ?? 0), 0) : 0
  const ref = c?.fps ?? null
  const corr = (d?.server.correlation ?? []).map((r) => ({ x: msOf(r.t), ms: num(r.ms), players: n0(r.players) }))
  const corrSpan = corr.length ? corr[corr.length - 1].x - corr[0].x : 0
  const resources = (d?.profiler.resources ?? []).filter((r) => r.name !== '(non attribué)')
  const hist = c?.hist ?? [0, 0, 0, 0, 0]
  const histTotal = hist.reduce((a, b) => a + b, 0)
  const histRows = ['< 20', '20–30', '30–45', '45–60', '60 +'].map((label, i) => ({ label, n: hist[i] ?? 0 }))
  const fpsSerie: Serie[] = [{ key: 'fps', label: 'FPS moyen', color: 'var(--success)', data: (c?.timeline ?? []).filter((w) => n0(w.n)).map((w) => ({ x: msOf(w.t), y: num(w.fps) })) }]
  const installed = (d?.installed.list ?? [])
    .filter((r) => (filter === 'maps' ? r.map || r.dataFiles > 0 : filter === 'stopped' ? r.state !== 'started' : true))
    .sort((a, b) => (filter === 'files' ? b.files - a.files : b.dataFiles - a.dataFiles || b.files - a.files))
    .slice(0, 200)

  return (
    <Page
      title='Télémétrie · Performances'
      description='Quoi optimiser : temps serveur par ressource, FPS des joueurs par zone et par intérieur (MLO), entités, ralentissements. Demande bl_telemetry 1.4.'
      actions={<Segmented label='Période' value={hours} options={RANGES} onChange={setHours} />}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <Section title='Recommandations' description={d.recommendations.length ? `${d.recommendations.length} point(s)` : 'rien à signaler'}>
            {!d.recommendations.length ? <EmptyState title='Rien d’anormal sur la période.' /> : (
              <ul className='divide-y'>
                {d.recommendations.map((r, i) => {
                  const s = SEV[r.severity] ?? SEV.info
                  return (
                    <li key={i} className='flex items-start gap-3 px-4 py-3'>
                      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', s.tone)} aria-hidden><s.icon className='size-4' /></span>
                      <div className='grid min-w-0 gap-0.5'>
                        <p className='font-medium break-words'>{r.title}</p>
                        {r.detail && <p className='text-sm break-words text-muted-foreground'>{r.detail}</p>}
                        {r.link && <p className='text-sm'><RecLink link={r.link} /></p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          <StatCards items={[
            { label: 'Thread principal (ms / tick)', value: main ? decimal(main.avg, 1) : '–', icon: Cpu, tone: main && n0(main.p95) > 25 ? 'danger' : 'accent', hint: main ? `95e centile ${decimal(main.p95, 1)} · max ${fmt(main.max)}` : 'pas de mesure' },
            { label: 'FPS moyen des joueurs', value: c?.fps != null ? <span className={fpsClass(c.fps)}>{fmt(c.fps)}</span> : '–', icon: MonitorPlay, tone: 'success', hint: c?.samples ? `${fmt(c.samples)} mesures · pire image ${fmt(c.worst)} ms` : 'en attente de bl_telemetry 1.4' },
            { label: 'Ralentissements (hitch)', value: d.server.hitches.count, icon: Gauge, tone: 'warning', hint: d.server.hitches.worst ? `le pire : ${fmt(d.server.hitches.worst)} ms` : 'aucun' },
            { label: 'Entités', value: e ? totalEnt : '–', icon: Boxes, tone: 'info', hint: e ? `${fmt(e.vehicles?.total ?? 0)} véh. · ${fmt(e.peds?.total ?? 0)} peds · ${fmt(e.objects?.total ?? 0)} obj.` : 'en attente' },
          ]} />

          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <TableSection
              title='Threads du serveur' rows={d.server.threads} minWidth='24rem' empty='Pas de mesure de tick (adresse du serveur à régler).'
              columns={[
                { key: 't', label: 'Thread', render: (t) => <Mono>{t.thread}</Mono> },
                { key: 'avg', label: 'Moyenne', align: 'end', render: (t) => `${decimal(t.avg, 1)} ms` },
                { key: 'p95', label: '95e centile', align: 'end', render: (t) => <span className={n0(t.p95) > 25 ? 'text-destructive' : ''}>{decimal(t.p95, 1)} ms</span> },
                { key: 'max', label: 'Max', align: 'end', render: (t) => `${fmt(t.max)} ms` },
              ]}
            />
            <ChartCard title='Charge du serveur et joueurs' empty={!corr.length && 'Pas encore de mesure'}>
              <ComposedChart data={corr} margin={{ left: 0, right: 0, top: 4 }}>
                <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
                <XAxis dataKey='x' type='number' scale='time' domain={['dataMin', 'dataMax']} tickFormatter={(v) => timeLabel(Number(v), corrSpan)} {...axis} minTickGap={32} />
                <YAxis yAxisId='ms' {...axis} width={48} tickFormatter={(v) => `${v} ms`} />
                <YAxis yAxisId='p' orientation='right' {...axis} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => dt(Number(v))} formatter={(v, name) => [name === 'ms par tick' ? `${decimal(Number(v), 1)} ms` : fmt(Number(v)), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId='p' dataKey='players' name='joueurs' fill='color-mix(in oklab, var(--info) 35%, transparent)' maxBarSize={18} />
                <Line yAxisId='ms' dataKey='ms' name='ms par tick' stroke='var(--primary)' strokeWidth={2} dot={false} connectNulls />
              </ComposedChart>
            </ChartCard>
          </div>

          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title={`Coût des ressources serveur${d.profiler.runs ? ` · ${d.profiler.runs} échantillon(s)` : ''}`} height='h-72' empty={!resources.length && 'Pas encore mesuré'}>
              <HBarChart rows={resources.slice(0, 12).map((r) => ({ name: r.name, pct: Number(r.pct.toFixed(2)) }))} suffix='%' series={[{ key: 'pct', label: '% du temps serveur' }]} />
            </ChartCard>
            <TableSection
              title='Ressources serveur' exportName='cout-ressources' rows={d.profiler.resources} minWidth='28rem' maxHeight='20rem'
              empty='Pas encore mesuré : ajoute « add_ace resource.bl_telemetry command.profiler allow » dans server.cfg.'
              columns={[
                { key: 'name', label: 'Ressource', render: (r) => <Mono>{r.name}</Mono>, csv: (r) => r.name },
                { key: 'pct', label: '% serveur', align: 'end', render: (r) => <b className={r.pct >= 15 ? 'text-destructive' : r.pct >= 5 ? 'text-warning' : ''}>{decimal(r.pct, 1)} %</b>, csv: (r) => r.pct.toFixed(2) },
                { key: 'ms', label: 'ms / s', align: 'end', render: (r) => decimal(r.msPerSec, 1), csv: (r) => r.msPerSec.toFixed(2) },
                { key: 'calls', label: 'Appels', align: 'end', render: (r) => fmt(r.calls), csv: (r) => r.calls },
                { key: 'runs', label: 'Échantillons', align: 'end', render: (r) => fmt(r.runs), csv: (r) => r.runs },
              ]}
            />
          </div>
          {(d.profiler.last?.top?.length ?? 0) > 0 && (
            <TableSection
              title='Fonctions les plus lentes (dernier échantillon)' rows={d.profiler.last!.top!} minWidth='32rem' maxHeight='20rem'
              columns={[
                { key: 'name', label: 'Fonction', render: (t) => <span className='font-mono text-xs break-all'>{t.name}</span> },
                { key: 'res', label: 'Ressource', render: (t) => <Mono>{t.res}</Mono> },
                { key: 'ms', label: 'Temps', align: 'end', render: (t) => `${decimal(t.ms, 1)} ms` },
                { key: 'n', label: 'Appels', align: 'end', render: (t) => fmt(t.n) },
              ]}
            />
          )}

          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
            <ChartCard title='Répartition des FPS des joueurs' empty={!histTotal && 'En attente de bl_telemetry 1.4'}>
              <BarChart data={histRows} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
                <XAxis dataKey='label' {...axis} />
                <YAxis {...axis} width={40} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--accent)' }} formatter={(v) => [`${fmt(Number(v))} mesures (${histTotal ? Math.round((Number(v) / histTotal) * 100) : 0} %)`, 'FPS']} />
                <Bar dataKey='n' radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {histRows.map((r, i) => <Cell key={r.label} fill={['var(--destructive)', 'color-mix(in oklab, var(--destructive) 65%, transparent)', 'var(--warning)', 'color-mix(in oklab, var(--success) 65%, transparent)', 'var(--success)'][i]} />)}
                </Bar>
              </BarChart>
            </ChartCard>
            <ChartCard title='FPS moyen dans le temps' empty={!fpsSerie[0].data.length && 'En attente de bl_telemetry 1.4'}><TimeChart series={fpsSerie} kind='line' /></ChartCard>
          </div>

          <TableSection
            title='Intérieurs (MLO) les plus lourds' exportName='interieurs' rows={d.interiors} minWidth='52rem' maxHeight='28rem' empty='Pas encore de mesures dans des intérieurs.'
            columns={[
              { key: 'key', label: 'Intérieur', render: (i) => <Mono>{i.key}</Mono>, csv: (i) => i.key },
              { key: 'zone', label: 'Zone', render: (i) => <span className='whitespace-nowrap'>{zoneName(i.x, i.y)} <span className='text-xs text-muted-foreground'>{fmt(i.x)}, {fmt(i.y)}</span></span>, csv: (i) => `${zoneName(i.x, i.y)} (${fmt(i.x)}, ${fmt(i.y)})` },
              { key: 'fps', label: 'FPS', align: 'end', render: (i) => <b className={fpsClass(num(i.fps))}>{fmt(i.fps)}</b>, csv: (i) => fmt(i.fps) },
              { key: 'delta', label: 'Écart', align: 'end', render: (i) => <Delta fps={num(i.fps)} base={ref} /> },
              { key: 'worst', label: 'Pire image', align: 'end', render: (i) => `${fmt(i.worst)} ms`, csv: (i) => fmt(i.worst) },
              { key: 'obj', label: 'Objets', align: 'end', render: (i) => fmt(i.obj), csv: (i) => fmt(i.obj) },
              { key: 'players', label: 'Joueurs', align: 'end', render: (i) => fmt(i.players ?? null), csv: (i) => i.players },
              { key: 'n', label: 'Mesures', align: 'end', render: (i) => fmt(i.n), csv: (i) => i.n },
              { key: 'map', label: '', align: 'end', render: (i) => <MapButton x={i.x} y={i.y} /> },
            ]}
          />
          <TableSection
            title='Zones les plus lourdes' exportName='zones' rows={d.zones} minWidth='48rem' maxHeight='28rem' empty='Pas encore de mesures.'
            columns={[
              { key: 'zone', label: 'Zone', render: (z) => <span className='whitespace-nowrap'>{zoneName(z.x, z.y)} <span className='text-xs text-muted-foreground'>{fmt(z.x)}, {fmt(z.y)}</span></span>, csv: (z) => `${zoneName(z.x, z.y)} (${fmt(z.x)}, ${fmt(z.y)})` },
              { key: 'fps', label: 'FPS', align: 'end', render: (z) => <b className={fpsClass(num(z.fps))}>{fmt(z.fps)}</b>, csv: (z) => fmt(z.fps) },
              { key: 'delta', label: 'Écart', align: 'end', render: (z) => <Delta fps={num(z.fps)} base={ref} /> },
              { key: 'worst', label: 'Pire image', align: 'end', render: (z) => `${fmt(z.worst)} ms`, csv: (z) => fmt(z.worst) },
              { key: 'obj', label: 'Objets', align: 'end', render: (z) => fmt(z.obj), csv: (z) => fmt(z.obj) },
              { key: 'peds', label: 'Peds', align: 'end', render: (z) => fmt(z.peds ?? null), csv: (z) => fmt(z.peds ?? null) },
              { key: 'veh', label: 'Véhicules', align: 'end', render: (z) => fmt(z.veh ?? null), csv: (z) => fmt(z.veh ?? null) },
              { key: 'n', label: 'Mesures', align: 'end', render: (z) => fmt(z.n), csv: (z) => z.n },
              { key: 'map', label: '', align: 'end', render: (z) => <MapButton x={z.x} y={z.y} /> },
            ]}
          />
          <TableSection
            title='Joueurs (FPS et ping)' exportName='fps-joueurs' rows={d.players} minWidth='34rem' maxHeight='28rem' empty='Pas encore de mesures.'
            columns={[
              { key: 'who', label: 'Joueur', render: (p) => <PlayerLink cid={p.key && !p.key.startsWith('src') ? p.key : null} name={p.name || p.key} />, csv: (p) => p.name || p.key },
              { key: 'fps', label: 'FPS', align: 'end', render: (p) => <b className={fpsClass(num(p.fps))}>{fmt(p.fps)}</b>, csv: (p) => fmt(p.fps) },
              { key: 'min', label: 'Min', align: 'end', render: (p) => fmt(p.fps_min), csv: (p) => fmt(p.fps_min) },
              { key: 'worst', label: 'Pire image', align: 'end', render: (p) => `${fmt(p.worst)} ms`, csv: (p) => fmt(p.worst) },
              { key: 'ping', label: 'Ping', align: 'end', render: (p) => (p.ping != null ? <span className={n0(p.ping) > 150 ? 'text-destructive' : ''}>{fmt(p.ping)} ms</span> : '–'), csv: (p) => fmt(p.ping) },
            ]}
          />

          <Section title='Entités sur le serveur' description='Modèles les plus nombreux (hash du modèle).'>
            {!e ? <EmptyState title='En attente de bl_telemetry 1.4.' /> : (
              <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:grid-cols-3'>
                {([['vehicles', 'Véhicules'], ['peds', 'Peds'], ['objects', 'Objets']] as const).map(([k, label]) => (
                  <div key={k} className='grid content-start gap-2 rounded-md border p-3'>
                    <div className='flex items-baseline justify-between'><span className='text-sm text-muted-foreground'>{label}</span><b className='font-display text-xl'>{fmt(e[k]?.total ?? 0)}</b></div>
                    <ol className='grid gap-1 text-sm'>
                      {(e[k]?.top ?? []).slice(0, 6).map((m) => <li key={String(m.model)} className='flex justify-between gap-2'><Mono className='truncate'>{String(m.model)}</Mono><span className='tabular-nums'>{fmt(m.n)}</span></li>)}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <TableSection
            title='Ressources installées'
            description={d.installed.total ? `${d.installed.started} démarrées / ${d.installed.total} · ${d.installed.maps.length} cartes ou MLO` : undefined}
            actions={<Segmented label='Filtre des ressources' value={filter} options={INSTALLED_FILTERS} onChange={setFilter} />}
            exportName='ressources-installees' rows={installed} minWidth='44rem' maxHeight='32rem'
            empty={d.installed.list.length ? 'Rien dans cette catégorie.' : 'En attente de bl_telemetry 1.4.'}
            columns={[
              { key: 'name', label: 'Ressource', render: (r) => <Mono>{r.name}</Mono>, csv: (r) => r.name },
              { key: 'state', label: 'État', render: (r) => <Pill tone={r.state === 'started' ? 'success' : 'danger'}>{r.state}</Pill>, csv: (r) => r.state },
              { key: 'files', label: 'Fichiers', align: 'end', render: (r) => fmt(r.files), csv: (r) => r.files },
              { key: 'data', label: 'Data', align: 'end', render: (r) => fmt(r.dataFiles), csv: (r) => r.dataFiles },
              { key: 'client', label: 'Scripts client', align: 'end', render: (r) => fmt(r.clientScripts), csv: (r) => r.clientScripts },
              { key: 'server', label: 'Scripts serveur', align: 'end', render: (r) => fmt(r.serverScripts), csv: (r) => r.serverScripts },
              { key: 'kind', label: 'Type', render: (r) => (r.map ? <Pill tone='accent'>carte</Pill> : r.dataFiles ? <Pill>data</Pill> : '–'), csv: (r) => (r.map ? 'carte' : r.dataFiles ? 'data' : '') },
            ]}
          />
        </div>
      )}
    </Page>
  )
}
