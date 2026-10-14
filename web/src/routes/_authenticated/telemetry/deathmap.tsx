import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Camera } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Page, Section } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DeathMapCanvas, type DeathMapHandle, type MapPoint } from '@/features/telemetry/death-map'
import { dt, fmt, num, rel } from '@/features/telemetry/format'
import type { DeathMap } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, Screenshot, Segmented } from '@/features/telemetry/ui'
import { ZONES, zoneIndex } from '@/features/telemetry/zones'

export const Route = createFileRoute('/_authenticated/telemetry/deathmap')({
  // at=x,y: opens the map on a spot (a death of a player sheet, a heavy area of the performance page)
  validateSearch: (search: Record<string, unknown>): { at?: string } => ({
    at: typeof search.at === 'string' && /^-?\d+,-?\d+$/.test(search.at) ? search.at : undefined,
  }),
  component: TelemetryDeathMap,
})

const RANGES = [{ value: 24, label: '24 h' }, { value: 168, label: '7 j' }, { value: 720, label: '30 j' }]
const MODES = [{ value: 'heat' as const, label: 'Chaleur' }, { value: 'points' as const, label: 'Points' }]

function Detail({ p, onBack }: { p: MapPoint; onBack: () => void }) {
  const row = (k: string, v: React.ReactNode) => <div className='flex items-center justify-between gap-3 py-1.5 text-sm'><span className='text-muted-foreground'>{k}</span><span className='min-w-0 text-end'>{v}</span></div>
  return (
    <div className='grid gap-3 p-4'>
      <Button variant='ghost' size='sm' className='w-fit' onClick={onBack}><ArrowLeft /> Toutes les zones</Button>
      {p.screenshot_url && (
        <Screenshot className='w-full' url={p.screenshot_url} caption={`${p.player_name ?? ''} · ${p.cause ?? ''} · ${dt(p.ts)}`}>
          <img src={p.screenshot_url} alt={`Capture de la mort de ${p.player_name ?? ''}`} loading='lazy' referrerPolicy='no-referrer' className='w-full rounded-md border object-cover' />
        </Screenshot>
      )}
      <div className='divide-y'>
        {row('Victime', <PlayerLink cid={p.citizenid} name={p.player_name} />)}
        {row('Cause', p.cause || '?')}
        {row('Tueur', p.killer_name ? <PlayerLink cid={p.killer_cid ?? null} name={p.killer_name} /> : '–')}
        {row('Arme', p.weapon ? <Mono>{p.weapon}</Mono> : '–')}
        {row('Quand', `${dt(p.ts)} · ${rel(p.ts)}`)}
        {row('Zone', ZONES[zoneIndex(p.x, p.y)][0])}
        {row('Position', <Mono>{Math.round(p.x)}, {Math.round(p.y)}{p.z != null ? `, ${Math.round(p.z)}` : ''}</Mono>)}
      </div>
    </div>
  )
}

function TelemetryDeathMap() {
  const { at } = Route.useSearch()
  const [hours, setHours] = useState(168)
  const [mode, setMode] = useState<'heat' | 'points'>('heat')
  const [selected, setSelected] = useState<MapPoint | null>(null)
  const map = useRef<DeathMapHandle>(null)
  const q = useQuery({ queryKey: ['telemetry', 'deathmap', hours], queryFn: () => api<DeathMap>(`/telemetry/deathmap?h=${hours}`) })
  const points = useMemo<MapPoint[]>(() => (q.data?.points ?? [])
    .map((p) => ({ ...p, x: num(p.x) ?? NaN, y: num(p.y) ?? NaN, z: num(p.z ?? null) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), [q.data])

  // Deaths per zone, most deadly first
  const zones = useMemo(() => {
    const counts = new Map<number, number>()
    for (const p of points) counts.set(zoneIndex(p.x, p.y), (counts.get(zoneIndex(p.x, p.y)) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [points])

  // Focus asked by the URL: once the points are there, with the nearest death selected
  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (!at || !q.data || focused.current === at) return
    focused.current = at
    const [x, y] = at.split(',').map(Number)
    map.current?.focus(x, y, 0.8)
    let best: MapPoint | null = null
    let bd = 50 ** 2
    for (const p of points) {
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2
      if (dd < bd) {
        bd = dd
        best = p
      }
    }
    if (best) setSelected(best)
  }, [at, q.data, points])

  const shots = q.data?.screenshots ?? []
  const maxZone = zones[0]?.[1] ?? 1
  return (
    <Page
      title='Télémétrie · Carte des morts'
      description='Où meurent les joueurs : carte de chaleur ou points, zones les plus mortelles et captures envoyées par le script de mort. Molette ou boutons pour zoomer, glisser pour se déplacer.'
      actions={<><Segmented label='Affichage' value={mode} options={MODES} onChange={setMode} /><Segmented label='Période' value={hours} options={RANGES} onChange={(h) => { setHours(h); setSelected(null) }} /></>}
    >
      {q.error ? <QueryError error={q.error} /> : !q.data ? <Skeleton className='h-[34rem] w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]'>
            <div className='grid gap-2'>
              <DeathMapCanvas ref={map} points={points} mode={mode} selected={selected} onSelect={setSelected} />
              <p className='text-xs text-muted-foreground'>{fmt(points.length)} morts géolocalisées · positions approximatives des zones</p>
            </div>
            <Section title={selected ? 'Détail de la mort' : 'Zones les plus mortelles'}>
              {selected ? <Detail p={selected} onBack={() => setSelected(null)} /> : !zones.length ? <EmptyState title='Aucune mort géolocalisée sur la période.' /> : (
                <ul className='grid gap-1 p-3'>
                  {zones.map(([z, n]) => (
                    <li key={z}>
                      <button type='button' onClick={() => map.current?.focus(ZONES[z][1], ZONES[z][2], 0.35)} className='relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent/40'>
                        <span className='absolute inset-y-0 start-0 rounded-md bg-destructive/15' style={{ width: `${(n / maxZone) * 100}%` }} aria-hidden />
                        <span className='relative flex-1 truncate font-medium'>{ZONES[z][0]}</span>
                        <span className='relative tabular-nums'>{fmt(n)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <Section title='Captures' description={shots.length ? `${shots.length} dernières` : undefined}>
            {!shots.length ? <EmptyState title='Aucune capture pour le moment' icon={Camera}>Elles apparaissent quand le script de mort envoie une <Mono>screenshot_url</Mono>.</EmptyState> : (
              <ul className='grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5'>
                {shots.map((s, i) => (
                  <li key={`${s.ts}-${i}`} className='min-w-0'>
                    <Screenshot className='w-full hover:no-underline' url={s.screenshot_url!} caption={`${s.player_name ?? s.citizenid ?? ''} · ${s.cause ?? ''} · ${dt(s.ts)}`}>
                      <span className='grid w-full gap-1 text-start'>
                        <img src={s.screenshot_url!} alt='' loading='lazy' referrerPolicy='no-referrer' className='aspect-video w-full rounded-md border bg-muted object-cover' />
                        <span className='truncate text-xs font-medium text-foreground'>{s.player_name || s.citizenid || 'Inconnu'}</span>
                        <span className='truncate text-xs text-muted-foreground'>{s.cause || '?'} · {rel(s.ts)}</span>
                      </span>
                    </Screenshot>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Page>
  )
}
