import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Backpack, Car, Clock, Link2, MapPin, ScrollText, ShoppingCart, Wallet, Activity } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Page, Pill, Section, UserAvatar } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChartCard, TimeChart } from '@/features/telemetry/charts'
import { isEmpty, type Serie } from '@/features/telemetry/chart-utils'
import { decimal, dt, fmt, money, msOf, n0, num, rel } from '@/features/telemetry/format'
import { JournalList, MapLink, type JournalEntry } from '@/features/telemetry/journal'
import { summarize } from '@/features/telemetry/labels'
import type { Player } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, Screenshot, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/players/$cid')({
  component: TelemetryPlayer,
})

const PAGE = 150

function Journal({ cid }: { cid: string }) {
  const q = useInfiniteQuery({
    queryKey: ['telemetry', 'timeline', cid],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: JournalEntry[] }>(`/telemetry/timeline?cid=${encodeURIComponent(cid)}&limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.items.length >= PAGE ? last.items[last.items.length - 1].ts : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Section title='Tout ce qui s’est passé' description={q.data ? `${fmt(items.length)} éléments` : undefined}>
      {q.error ? <div className='p-4'><QueryError error={q.error} /></div> : !q.data ? <Skeleton className='m-4 h-40' /> : !items.length ? <EmptyState title='Rien d’enregistré pour ce joueur.' /> : (
        <>
          <JournalList items={items} cid={cid} />
          {q.hasNextPage && <div className='border-t p-3 text-center'><Button variant='outline' size='sm' onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Plus ancien</Button></div>}
        </>
      )}
    </Section>
  )
}

function Linked({ cid }: { cid: string }) {
  const q = useQuery({ queryKey: ['telemetry', 'linked', cid], queryFn: () => api<{ players: { citizenid: string; name: string | null; via: string }[] }>(`/telemetry/linked?cid=${encodeURIComponent(cid)}`) })
  const list = q.data?.players ?? []
  if (!list.length) return null
  return (
    <div className='flex flex-wrap items-center gap-1.5 text-sm'>
      <Pill tone='warning'><Link2 className='size-3' /> {list.length} compte{list.length > 1 ? 's' : ''} lié{list.length > 1 ? 's' : ''}</Pill>
      {list.map((p) => (
        <Link key={p.citizenid} to='/telemetry/players/$cid' params={{ cid: p.citizenid }} title={`Lien : ${p.via}`} className='rounded-md bg-muted px-2 py-0.5 text-xs font-medium hover:text-primary'>{p.name || p.citizenid}</Link>
      ))}
    </div>
  )
}

function TelemetryPlayer() {
  const { cid } = Route.useParams()
  const q = useQuery({ queryKey: ['telemetry', 'player', cid], queryFn: () => api<Player>(`/telemetry/player?cid=${encodeURIComponent(cid)}`), refetchInterval: 60_000 })
  const d = q.data
  const id = d?.ident
  const name = id?.name || cid
  const moneySeries: Serie[] = [
    { key: 'cash', label: 'Cash', data: (d?.money ?? []).map((r) => ({ x: msOf(r.t), y: num(r.cash) })) },
    { key: 'bank', label: 'Banque', color: 'var(--info)', data: (d?.money ?? []).map((r) => ({ x: msOf(r.t), y: num(r.bank) })) },
  ]
  return (
    <Page
      title={`Télémétrie · ${name}`}
      actions={<Button asChild variant='outline'><Link to='/telemetry/players'><ArrowLeft /> Tous les joueurs</Link></Button>}
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <section className='brackets flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5'>
            <div className='relative'>
              <UserAvatar name={name} className='size-16 text-lg' />
              {id?.online && <span className='live-dot absolute -end-0.5 -bottom-0.5 size-4 rounded-full border-2 border-card bg-success' aria-label='en ligne' />}
            </div>
            <div className='grid min-w-0 flex-1 basis-60 gap-1.5'>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='font-display text-2xl font-semibold'>{name}</h2>
                {id?.online ? <Pill tone='success'>En ligne</Pill> : <Pill>Hors ligne</Pill>}
              </div>
              <div className='flex flex-wrap items-center gap-1.5 text-sm'>
                <Mono>{cid}</Mono>
                <Pill>{id?.job || 'sans métier'}{id?.job_grade != null ? ` · grade ${id.job_grade}` : ''}</Pill>
                {id?.gang && id.gang !== 'none' && <Pill tone='accent'>gang {id.gang}</Pill>}
                {!id?.online && id?.ts && <Pill><Clock className='size-3' /> vu {rel(id.ts)}</Pill>}
                {!id && <span className='text-muted-foreground'>Aucun relevé de ce personnage pour l’instant.</span>}
              </div>
              <Linked cid={cid} />
            </div>
            <div className='grid w-full grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 xl:w-auto'>
              <div><div className='text-xs text-muted-foreground'>Heures de jeu</div><div className='font-display text-lg font-semibold'>{decimal(d.stats.hours, 1)}</div></div>
              <div><div className='text-xs text-muted-foreground'>Morts</div><div className='font-display text-lg font-semibold'>{fmt(d.stats.deaths ?? 0)}</div></div>
              <div><div className='text-xs text-muted-foreground'>Achats</div><div className='font-display text-lg font-semibold'>{fmt(d.stats.purchases ?? 0)}</div></div>
              <div><div className='text-xs text-muted-foreground'>Cash + banque</div><div className='font-display text-lg font-semibold'>{money(n0(id?.cash) + n0(id?.bank))}</div></div>
            </div>
          </section>

          <ChartCard title='Argent (30 j)' empty={isEmpty(moneySeries) && 'Pas encore de relevé'}><TimeChart series={moneySeries} unit='money' /></ChartCard>

          <Tabs defaultValue='assets'>
            <TabsList className='h-auto max-w-full flex-wrap justify-start [&>button]:h-8 [&>button]:flex-none'>
              <TabsTrigger value='journal'><ScrollText /> Journal</TabsTrigger>
              <TabsTrigger value='assets'><Backpack /> Inventaire et véhicules</TabsTrigger>
              <TabsTrigger value='money'><Wallet /> Argent</TabsTrigger>
              <TabsTrigger value='activity'><Activity /> Activité</TabsTrigger>
            </TabsList>

            <TabsContent value='journal' className='mt-4'><Journal cid={cid} /></TabsContent>

            <TabsContent value='assets' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-4'>
              <Section title='Inventaire' description={`${d.inventory.length} objet${d.inventory.length > 1 ? 's' : ''}`}>
                {!d.inventory.length ? <EmptyState title='Inventaire vide.' icon={Backpack} /> : (
                  <ul className='grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-5'>
                    {d.inventory.map((it, i) => (
                      <li key={`${it.name}-${i}`} className='flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm' title={it.name}>
                        <span className='truncate'>{it.name.replace(/_/g, ' ')}</span>
                        <span className='shrink-0 font-medium tabular-nums'>×{fmt(it.count)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title='Véhicules' description={`${d.vehicles.length} véhicule${d.vehicles.length > 1 ? 's' : ''}`}>
                {!d.vehicles.length ? <EmptyState title='Aucun véhicule.' icon={Car} /> : (
                  <ul className='grid grid-cols-[minmax(0,1fr)] gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3'>
                    {d.vehicles.map((v) => (
                      <li key={v.plate} className='grid gap-1 rounded-md border p-3 text-sm'>
                        <div className='flex items-center justify-between gap-2'>
                          <span className='rounded border-2 border-foreground/70 px-1.5 font-mono text-xs font-bold tracking-wider'>{v.plate}</span>
                          {n0(v.state) === 1 ? <Pill tone='success'>au garage</Pill> : num(v.state) === 0 ? <Pill tone='warning'>sorti</Pill> : <Pill>{String(v.state ?? '?')}</Pill>}
                        </div>
                        <span className='font-medium'>{v.model}</span>
                        <span className='flex items-center gap-1 text-xs text-muted-foreground'><Car className='size-3' /> {v.garage || 'garage inconnu'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </TabsContent>

            <TabsContent value='money' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2'>
              <TableSection
                title='Flux bancaires' exportName={`flux-${cid}`} rows={d.flows} minWidth='28rem' empty='Aucun flux bancaire.'
                columns={[
                  { key: 'ts', label: 'Heure', render: (f) => <span className='whitespace-nowrap text-muted-foreground'>{dt(f.ts)}</span>, csv: (f) => dt(f.ts) },
                  { key: 'kind', label: 'Type', render: (f) => <Pill>{f.kind ?? '?'}</Pill>, csv: (f) => f.kind },
                  { key: 'with', label: 'Avec', render: (f) => <PlayerLink cid={f.from_cid === cid ? f.to_cid : f.from_cid} />, csv: (f) => (f.from_cid === cid ? f.to_cid : f.from_cid) },
                  { key: 'amount', label: 'Montant', align: 'end', render: (f) => (f.from_cid === cid ? <span className='text-destructive'>−{money(f.amount)}</span> : <span className='text-success'>+{money(f.amount)}</span>), csv: (f) => (f.from_cid === cid ? -n0(f.amount) : n0(f.amount)) },
                ]}
              />
              <TableSection
                title='Achats' exportName={`achats-${cid}`} rows={d.purchases} minWidth='28rem' empty='Aucun achat.'
                columns={[
                  { key: 'ts', label: 'Heure', render: (p) => <span className='whitespace-nowrap text-muted-foreground'>{dt(p.ts)}</span>, csv: (p) => dt(p.ts) },
                  { key: 'shop', label: 'Boutique', render: (p) => p.shop ?? '?', csv: (p) => p.shop },
                  { key: 'article', label: 'Article', render: (p) => <b>{p.article}</b>, csv: (p) => p.article },
                  { key: 'total', label: 'Total', align: 'end', render: (p) => money(p.total), csv: (p) => p.total },
                ]}
              />
            </TabsContent>

            <TabsContent value='activity' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-4'>
              <div className='grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2'>
                <TableSection
                  title='Morts' exportName={`morts-${cid}`} rows={d.deaths} minWidth='34rem' empty='Aucune mort.'
                  columns={[
                    { key: 'ts', label: 'Heure', render: (m) => <span className='whitespace-nowrap text-muted-foreground'>{dt(m.ts)}</span>, csv: (m) => dt(m.ts) },
                    { key: 'cause', label: 'Cause', render: (m) => m.cause ?? '?', csv: (m) => m.cause },
                    { key: 'killer', label: 'Tueur', render: (m) => (m.killer_name ? <PlayerLink cid={m.killer_cid} name={m.killer_name} /> : '–'), csv: (m) => m.killer_name },
                    { key: 'weapon', label: 'Arme', render: (m) => (m.weapon ? <Mono>{m.weapon}</Mono> : '–'), csv: (m) => m.weapon },
                    {
                      key: 'links', label: '', align: 'end', render: (m) => (
                        <span className='inline-flex items-center gap-2'>
                          {m.screenshot_url && <Screenshot url={m.screenshot_url} caption={`${name} · ${m.cause ?? ''} · ${dt(m.ts)}`} />}
                          <MapLink x={m.x} y={m.y}><span className='sr-only'>Voir sur la carte</span><MapPin className='size-4' aria-hidden /></MapLink>
                        </span>
                      ),
                    },
                  ]}
                />
                <TableSection
                  title='Sessions' exportName={`sessions-${cid}`} rows={d.sessions} minWidth='26rem' empty='Aucune session.'
                  columns={[
                    { key: 'start', label: 'Début', render: (s) => <span className='whitespace-nowrap'>{dt(s.start_ts)}</span>, csv: (s) => dt(s.start_ts) },
                    { key: 'end', label: 'Fin', render: (s) => (s.end_ts ? <span className='whitespace-nowrap'>{dt(s.end_ts)}</span> : <Pill tone='success'>en cours</Pill>), csv: (s) => (s.end_ts ? dt(s.end_ts) : 'en cours') },
                    { key: 'min', label: 'Durée', align: 'end', render: (s) => (s.minutes != null ? `${fmt(s.minutes)} min` : '–'), csv: (s) => s.minutes },
                    { key: 'reason', label: 'Raison', render: (s) => <span className='text-muted-foreground'>{s.drop_reason ?? '–'}</span>, csv: (s) => s.drop_reason },
                  ]}
                />
              </div>
              <TableSection
                title='Derniers événements' exportName={`evenements-${cid}`} rows={d.events} minWidth='36rem' empty='Aucun événement.' maxHeight='32rem'
                columns={[
                  { key: 'ts', label: 'Heure', render: (e) => <span className='whitespace-nowrap text-muted-foreground'>{dt(e.ts)}</span>, csv: (e) => dt(e.ts) },
                  { key: 'type', label: 'Type', render: (e) => <Pill>{e.type}{e.subtype ? ` · ${e.subtype}` : ''}</Pill>, csv: (e) => `${e.type}${e.subtype ? ` · ${e.subtype}` : ''}` },
                  { key: 'data', label: 'Détails', render: (e) => <span className='text-xs break-words text-muted-foreground'>{summarize(e.data, 8) || '–'}</span>, csv: (e) => summarize(e.data, 20) },
                ]}
              />
              {!d.events.length && !d.deaths.length && !d.sessions.length && <p className='flex items-center gap-2 text-sm text-muted-foreground'><ShoppingCart className='size-4' /> Rien d’enregistré pour ce personnage.</p>}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Page>
  )
}
