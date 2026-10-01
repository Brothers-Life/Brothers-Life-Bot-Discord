import { useDeferredValue, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Backpack, Banknote, Car, Clock, Database, Gamepad2, Gavel, HeartPulse, IdCard, Search, Settings, ShieldAlert, Users, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar, Notice } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/_authenticated/fivem-players')({
  validateSearch: (search: Record<string, unknown>) => ({ id: typeof search.id === 'number' || typeof search.id === 'string' ? Number(search.id) || undefined : undefined }),
  component: FivemPlayersPage,
})

type Person = { name: string | null; avatar: string | null } | null
type Group = { name: string; label: string; grade: number; gradeLabel: string | null; type: string; onDuty?: boolean; isBoss?: boolean }
type Summary = { userId: number; username: string; discordId: string | null; discord: Person; characters: { citizenId: string; name: string; job: Group | null; gang: Group | null; lastUpdated: number | null }[]; lastSeen: number | null; online: boolean; playSeconds: number; sessions: number }
type Item = { name: string; count: number; slot?: number }
type Character = {
  citizenId: string; slot: number; name: string; birthdate: string | null; gender: string | null; nationality: string | null; backstory: string | null; phone: string | null
  job: Group | null; gang: Group | null; money?: { cash?: number; bank?: number; crypto?: number }; coins?: number | null; vip: string | null
  status: { dead: boolean; lastStand: boolean; handcuffed: boolean; inJail: number; health: number | null; armor: number | null; hunger: number | null; thirst: number | null; stress: number | null }
  identity: { bloodType: string | null; fingerprint: string | null; callsign: string | null; licences: Record<string, boolean> | null; criminalRecord: { hasRecord?: boolean } | null }
  inventory?: Item[]; outfits: number; groups: (Group & { hiredAt: number | null })[]; duty: { job: string; label: string; seconds: number }[]; jail: number
  properties: { id: number; name: string; price: number }[]; lastUpdated: number | null; lastLoggedOut: number | null
}
type Sheet = {
  account: { userId: number; username: string; discordId: string | null; license: string; license2: string | null; fivemId: string | null }; discord: Person
  playtime: { online: boolean; sessions: number; firstSeen: number | null; totalSeconds: number; weekSeconds: number; lastSessions: { joinedAt: number; leftAt: number | null; dropReason: string | null; characters: string[] }[] }
  characters: Character[]
  vehicles: { owner: string; model: string; plate: string; fakePlate: string | null; garage: string | null; state: string; fuel: number | null; engine: number; body: number; depotPrice: number | null; distance: number | null; nickname: string | null; lastOut: number | null; ownerJob: string | null; ownerGang: string | null; glovebox?: Item[]; trunk?: Item[] }[]
  sanctions: { id: number; type: string; reason: string | null; durationMinutes: string | null; by: string | null; at: number | null }[]
  bans: { id: number; reason: string | null; expire: number | null; by: string | null }[]
  reports: { id: number; message: string; status: string; priority: string | null; category: string | null; claimedBy: string | null; resolvedBy: string | null; at: number | null }[]
  economy: { total: number; flows: { at: number | null; kind: string; from: string | null; to: string | null; amount: number; note: string | null }[]; premium: { points: number; loyalty: number; logs: { action: string; label: string | null; amount: string | null; details: string | null; at: number | null }[] } } | null
  permissions: { economy: boolean; inventory: boolean; logs: boolean }
}
type Overview = { accounts: number; characters: number; online: number; week: { players: number; seconds: number }; staff: { name: string; role: string; seconds: number; active: boolean }[]; jobs: { name: string; label: string; type: string; members: number }[]; topPlaytime: { userId: number; username: string; seconds: number }[] }

const hours = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)} min`)
const money = (n?: number | null) => `${Number(n ?? 0).toLocaleString('fr-FR')} $`
const SANCTION: Record<string, { label: string; tone: 'danger' | 'warning' | 'info' | 'success' | 'neutral' }> = {
  ban: { label: 'Ban', tone: 'danger' }, kick: { label: 'Kick', tone: 'warning' }, warn: { label: 'Warn', tone: 'warning' }, jail: { label: 'Prison', tone: 'info' }, unban: { label: 'Déban', tone: 'success' }, unjail: { label: 'Sortie', tone: 'success' },
}

function FivemPlayersPage() {
  const { can } = useMe()
  const { id } = Route.useSearch()
  const navigate = useNavigate({ from: '/fivem-players' })
  const [settings, setSettings] = useState(false)
  return (
    <Page
      title='Joueurs FiveM'
      description='Les joueurs du serveur FiveM, lus directement dans sa base de données : personnages, métiers, temps de jeu, véhicules, sanctions en jeu. Ce que chacun voit dépend de ses permissions.'
      actions={
        <div className='flex gap-2'>
          {id && <Button variant='outline' onClick={() => navigate({ search: { id: undefined } })}><ArrowLeft /> Tous les joueurs</Button>}
          {can('fivemdata.manage') && <Button variant='ghost' onClick={() => setSettings(true)}><Settings /> Connexion</Button>}
        </div>
      }
    >
      {id ? <PlayerSheet userId={id} /> : <Directory onOpen={(userId) => navigate({ search: { id: userId } })} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </Page>
  )
}

function Directory({ onOpen }: { onOpen: (userId: number) => void }) {
  const { can } = useMe()
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const overview = useQuery({ queryKey: ['fivem-overview'], queryFn: () => api<Overview>('/fivem-data/overview'), retry: false, refetchInterval: 60_000 })
  const players = useQuery({ queryKey: ['fivem-players', q], queryFn: () => api<Summary[]>(`/fivem-data/players?q=${encodeURIComponent(q)}`), retry: false, placeholderData: (prev) => prev })

  if (overview.error) {
    return (
      <Notice tone='warning' title='Base FiveM indisponible'>
        {errorMessage(overview.error)}{can('fivemdata.manage') ? ' Règle la connexion avec le bouton « Connexion ».' : ' Demande à un responsable de régler la connexion.'}
      </Notice>
    )
  }
  const o = overview.data
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {o ? (
        <StatCards items={[
          { label: 'Comptes', value: o.accounts, icon: Users, tone: 'accent' },
          { label: 'Personnages', value: o.characters, icon: IdCard, tone: 'info' },
          { label: 'En jeu maintenant', value: o.online, icon: Gamepad2, tone: 'success' },
          { label: 'Heures jouées (7 j)', value: Math.round(o.week.seconds / 3600), icon: Clock, tone: 'warning' },
        ]} />
      ) : <Skeleton className='h-24 w-full' />}

      <Tabs defaultValue='players'>
        <TabsList className='h-auto max-w-full flex-wrap justify-start [&>button]:h-8 [&>button]:flex-none'>
          <TabsTrigger value='players'>Joueurs</TabsTrigger>
          <TabsTrigger value='server'>Serveur</TabsTrigger>
          {can('fivemdata.logs') && <TabsTrigger value='logs'>Logs admin du jeu</TabsTrigger>}
        </TabsList>
        <TabsContent value='players' className='mt-4'>
          <Section
            title={players.data ? `${players.data.length} joueur${players.data.length > 1 ? 's' : ''}` : 'Joueurs'}
            actions={
              <div className='relative'>
                <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Nom RP, pseudo, citizen ID, plaque…' aria-label='Chercher un joueur' className='w-72 ps-8' autoFocus />
              </div>
            }
          >
            {!players.data ? <Skeleton className='m-4 h-40' /> : !players.data.length ? <EmptyState title='Aucun joueur trouvé' icon={Search} /> : (
              <ul className={cn('divide-y transition-opacity', players.isPlaceholderData && 'opacity-60')}>
                {players.data.map((p) => (
                  <li key={p.userId}>
                    <button type='button' onClick={() => onOpen(p.userId)} className='flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start hover:bg-accent/40'>
                      <div className='relative'>
                        <UserAvatar src={p.discord?.avatar} name={p.discord?.name ?? p.username} className='size-9' />
                        {p.online && <span className='live-dot absolute -end-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card bg-success' aria-label='en jeu' />}
                      </div>
                      <div className='min-w-0 flex-1 basis-56'>
                        <div className='flex flex-wrap items-center gap-2 font-medium'>{p.username}{p.discord?.name && <span className='text-xs font-normal text-muted-foreground'>@{p.discord.name}</span>}</div>
                        <div className='flex flex-wrap gap-1'>
                          {p.characters.map((c) => <Pill key={c.citizenId} tone='neutral'>{c.name}{c.job ? ` · ${c.job.label}` : ''}</Pill>)}
                        </div>
                      </div>
                      <div className='text-end text-xs text-muted-foreground'>
                        <div className='font-medium text-foreground tabular-nums'>{hours(p.playSeconds)}</div>
                        <div>{p.online ? 'en jeu' : p.lastSeen ? `vu ${dateTime(p.lastSeen)}` : 'jamais vu'}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>
        <TabsContent value='server' className='mt-4'>{o && <ServerTab o={o} onOpen={onOpen} />}</TabsContent>
        {can('fivemdata.logs') && <TabsContent value='logs' className='mt-4'><AdminLogs /></TabsContent>}
      </Tabs>
    </div>
  )
}

function ServerTab({ o, onOpen }: { o: Overview; onOpen: (userId: number) => void }) {
  return (
    <div className='grid gap-6 lg:grid-cols-3'>
      <Section title='Les plus actifs (30 j)'>
        <ol className='divide-y'>
          {o.topPlaytime.map((t, i) => (
            <li key={t.userId}><button type='button' onClick={() => onOpen(t.userId)} className='flex w-full items-center gap-3 px-4 py-2 text-start text-sm hover:bg-accent/40'><span className='w-5 text-xs text-muted-foreground tabular-nums'>{i + 1}</span><span className='flex-1 truncate'>{t.username}</span><span className='tabular-nums'>{hours(t.seconds)}</span></button></li>
          ))}
        </ol>
      </Section>
      <Section title='Staff en jeu (30 j)' description='Temps de service dans le menu admin du jeu.'>
        <ul className='divide-y'>
          {o.staff.map((s) => (
            <li key={`${s.name}-${s.role}`} className='flex items-center gap-2 px-4 py-2 text-sm'>
              <span className={cn('size-2 rounded-full', s.active ? 'live-dot bg-success' : 'bg-muted-foreground/40')} aria-label={s.active ? 'en service' : undefined} />
              <span className='min-w-0 flex-1 truncate'>{s.name} <span className='text-xs text-muted-foreground'>· {s.role}</span></span>
              <span className='tabular-nums'>{hours(s.seconds)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title='Effectifs des métiers et gangs'>
        <ul className='divide-y'>
          {o.jobs.map((j) => (
            <li key={`${j.type}-${j.name}`} className='flex items-center gap-2 px-4 py-2 text-sm'>
              <span className='flex-1 truncate'>{j.label}</span><Pill tone={j.type === 'gang' ? 'danger' : 'info'}>{j.type === 'gang' ? 'gang' : 'métier'}</Pill><span className='w-8 text-end tabular-nums'>{j.members}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function AdminLogs() {
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const logs = useInfiniteQuery({
    queryKey: ['fivem-admin-logs', q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ id: number; by: string; action: string; target: string | null; details: string | null; at: number }[]>(`/fivem-data/logs?q=${encodeURIComponent(q)}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === 100 ? last.at(-1)?.id : undefined),
  })
  const rows = logs.data?.pages.flat() ?? []
  return (
    <Section
      title='Actions du staff en jeu'
      description='Le journal du menu admin du serveur FiveM : téléportations, véhicules, inventaires, permissions…'
      actions={<Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Staff, joueur, action…' aria-label='Filtrer les logs' className='w-60' />}
    >
      {!rows.length ? <EmptyState title={logs.isLoading ? 'Chargement…' : 'Aucune action'} icon={ShieldAlert} /> : (
        <ul className='divide-y'>
          {rows.map((r) => (
            <li key={r.id} className='flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm'>
              <span className='w-32 shrink-0 text-xs text-muted-foreground tabular-nums'>{dateTime(r.at)}</span>
              <span className='font-medium'>{r.by}</span>
              <Pill tone='neutral'>{r.action}</Pill>
              {r.target && <span>→ {r.target}</span>}
              {r.details && <span className='min-w-0 flex-1 basis-full text-xs text-muted-foreground [overflow-wrap:anywhere] sm:basis-auto'>{r.details}</span>}
            </li>
          ))}
          {logs.hasNextPage && <li className='p-3 text-center'><Button size='sm' variant='outline' loading={logs.isFetchingNextPage} onClick={() => logs.fetchNextPage()}>Plus ancien</Button></li>}
        </ul>
      )}
    </Section>
  )
}

function PlayerSheet({ userId }: { userId: number }) {
  const { data: p, isLoading, error } = useQuery({ queryKey: ['fivem-player', userId], queryFn: () => api<Sheet>(`/fivem-data/players/${userId}`), retry: false, refetchInterval: 30_000 })
  if (isLoading) return <Skeleton className='h-96 w-full' />
  if (error) return <Notice tone='warning' title='Fiche indisponible'>{errorMessage(error)}</Notice>
  if (!p) return null
  const a = p.account
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <section className='brackets flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5'>
        <div className='relative'>
          <UserAvatar src={p.discord?.avatar} name={p.discord?.name ?? a.username} className='size-16' />
          {p.playtime.online && <span className='live-dot absolute -end-0.5 -bottom-0.5 size-4 rounded-full border-2 border-card bg-success' aria-label='en jeu' />}
        </div>
        <div className='min-w-0 flex-1 basis-52'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='font-display text-2xl font-semibold'>{a.username}</h2>
            {p.playtime.online ? <Pill tone='success'>En jeu</Pill> : <Pill tone='neutral'>Hors ligne</Pill>}
            {p.bans.length > 0 && <Pill tone='danger'>Banni du jeu</Pill>}
            {p.characters.some((c) => c.jail) && <Pill tone='warning'>En prison</Pill>}
          </div>
          <p className='text-sm text-muted-foreground'>
            {a.discordId ? <Link to='/people' search={{ id: a.discordId }} className='text-primary hover:underline'>@{p.discord?.name ?? a.discordId}</Link> : 'Pas de Discord lié'}
            {' · '}compte #{a.userId}{a.fivemId ? ` · FiveM ${a.fivemId}` : ''}
          </p>
          <p className='truncate font-mono text-[11px] text-muted-foreground'>{a.license}</p>
        </div>
        <div className='grid w-full grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 xl:w-auto'>
          <div><div className='text-xs text-muted-foreground'>Temps de jeu</div><div className='font-display text-lg font-semibold'>{hours(p.playtime.totalSeconds)}</div></div>
          <div><div className='text-xs text-muted-foreground'>Cette semaine</div><div className='font-display text-lg font-semibold'>{hours(p.playtime.weekSeconds)}</div></div>
          <div><div className='text-xs text-muted-foreground'>Sessions</div><div className='font-display text-lg font-semibold'>{p.playtime.sessions}</div></div>
          <div><div className='text-xs text-muted-foreground'>Depuis le</div><div className='font-display text-lg font-semibold'>{p.playtime.firstSeen ? new Date(p.playtime.firstSeen).toLocaleDateString('fr-FR') : '—'}</div></div>
        </div>
      </section>

      <Tabs defaultValue='characters'>
        <TabsList className='h-auto max-w-full flex-wrap justify-start [&>button]:h-8 [&>button]:flex-none'>
          <TabsTrigger value='characters'><IdCard /> Personnages ({p.characters.length})</TabsTrigger>
          <TabsTrigger value='vehicles'><Car /> Véhicules ({p.vehicles.length})</TabsTrigger>
          {p.permissions.inventory && <TabsTrigger value='inventory'><Backpack /> Inventaires</TabsTrigger>}
          {p.economy && <TabsTrigger value='economy'><Wallet /> Économie</TabsTrigger>}
          <TabsTrigger value='sessions'><Clock /> Sessions</TabsTrigger>
          <TabsTrigger value='sanctions'><Gavel /> Sanctions ({p.sanctions.length + p.bans.length})</TabsTrigger>
        </TabsList>

        <TabsContent value='characters' className='mt-4 grid gap-4 lg:grid-cols-2'>
          {p.characters.map((c) => <CharacterCard key={c.citizenId} c={c} />)}
        </TabsContent>

        <TabsContent value='vehicles' className='mt-4'>
          <Section title='Véhicules'>
            {!p.vehicles.length ? <EmptyState title='Aucun véhicule' icon={Car} /> : (
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[44rem] text-sm'>
                  <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Plaque</th><th className='px-2 text-start font-medium'>Modèle</th><th className='px-2 text-start font-medium'>À</th><th className='px-2 text-start font-medium'>Où</th><th className='px-2 text-end font-medium'>Essence</th><th className='px-2 text-end font-medium'>Moteur</th><th className='px-2 text-end font-medium'>Carrosserie</th><th className='px-4 text-end font-medium'>Km</th></tr></thead>
                  <tbody className='divide-y'>
                    {p.vehicles.map((v) => (
                      <tr key={v.plate}>
                        <td className='px-4 py-2 font-mono'>{v.plate}{v.fakePlate && <span className='ms-1 text-xs text-warning'>(fausse : {v.fakePlate})</span>}</td>
                        <td className='px-2'>{v.model}{v.nickname && <span className='text-xs text-muted-foreground'> « {v.nickname} »</span>}{(v.ownerJob || v.ownerGang) && <Pill tone='info' className='ms-1'>{v.ownerJob ?? v.ownerGang}</Pill>}</td>
                        <td className='px-2'>{v.owner}</td>
                        <td className='px-2'><Pill tone={v.state === 'fourrière' ? 'danger' : v.state === 'dehors' ? 'warning' : 'neutral'}>{v.state}</Pill>{v.garage && <span className='ms-1 text-xs text-muted-foreground'>{v.garage}</span>}</td>
                        <td className='px-2 text-end tabular-nums'>{v.fuel ?? '—'} %</td>
                        <td className={cn('px-2 text-end tabular-nums', v.engine < 50 && 'text-destructive')}>{v.engine} %</td>
                        <td className={cn('px-2 text-end tabular-nums', v.body < 50 && 'text-destructive')}>{v.body} %</td>
                        <td className='px-4 text-end tabular-nums'>{v.distance ? Math.round(v.distance / 1000) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        {p.permissions.inventory && (
          <TabsContent value='inventory' className='mt-4 grid gap-4 lg:grid-cols-2'>
            {p.characters.map((c) => (
              <Section key={c.citizenId} title={`Inventaire de ${c.name}`} description={`${c.inventory?.length ?? 0} objet${(c.inventory?.length ?? 0) > 1 ? 's' : ''}`}>
                <Items items={c.inventory ?? []} />
              </Section>
            ))}
            {p.vehicles.filter((v) => v.trunk?.length || v.glovebox?.length).map((v) => (
              <Section key={`v-${v.plate}`} title={`Coffre ${v.plate} (${v.model})`}>
                <Items items={[...(v.trunk ?? []), ...(v.glovebox ?? [])]} />
              </Section>
            ))}
          </TabsContent>
        )}

        {p.economy && (
          <TabsContent value='economy' className='mt-4 grid gap-6'>
            <StatCards items={[
              { label: 'Total (cash + banque)', value: p.economy.total, icon: Banknote, tone: 'success' },
              { label: 'Points premium', value: p.economy.premium.points, icon: Wallet, tone: 'accent' },
              { label: 'Fidélité', value: p.economy.premium.loyalty, icon: Wallet, tone: 'info' },
            ]} />
            <div className='grid gap-6 lg:grid-cols-2'>
              <Section title='Derniers virements'>
                {!p.economy.flows.length ? <EmptyState title='Aucun virement suivi' /> : (
                  <ul className='divide-y'>{p.economy.flows.map((f, i) => <li key={i} className='flex flex-wrap items-center gap-2 px-4 py-2 text-sm'><span className='text-xs text-muted-foreground tabular-nums'>{dateTime(f.at)}</span><span className='flex-1 truncate'>{f.from ?? '?'} → {f.to ?? '?'}{f.note ? ` · ${f.note}` : ''}</span><span className='font-medium tabular-nums'>{money(f.amount)}</span></li>)}</ul>
                )}
              </Section>
              <Section title='Boutique premium'>
                {!p.economy.premium.logs.length ? <EmptyState title='Aucun achat' /> : (
                  <ul className='divide-y'>{p.economy.premium.logs.map((l, i) => <li key={i} className='flex flex-wrap items-center gap-2 px-4 py-2 text-sm'><span className='text-xs text-muted-foreground tabular-nums'>{dateTime(l.at)}</span><Pill tone='neutral'>{l.action}</Pill><span className='flex-1 truncate'>{l.label ?? l.details}</span>{l.amount && <span className='tabular-nums'>{l.amount}</span>}</li>)}</ul>
                )}
              </Section>
            </div>
          </TabsContent>
        )}

        <TabsContent value='sessions' className='mt-4'>
          <Section title='Dernières sessions' description='Connexions au serveur, personnage joué et raison de la déconnexion.'>
            <ul className='divide-y'>
              {p.playtime.lastSessions.map((s, i) => (
                <li key={i} className='flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-sm'>
                  <span className='w-32 shrink-0 text-xs text-muted-foreground tabular-nums'>{dateTime(s.joinedAt)}</span>
                  <span className='w-20 tabular-nums'>{s.leftAt ? hours((s.leftAt - s.joinedAt) / 1000) : <Pill tone='success'>en cours</Pill>}</span>
                  <span className='flex-1 truncate'>{s.characters.join(', ') || '—'}</span>
                  {s.dropReason && <span className='max-w-full truncate text-xs text-muted-foreground'>{s.dropReason}</span>}
                </li>
              ))}
            </ul>
          </Section>
        </TabsContent>

        <TabsContent value='sanctions' className='mt-4 grid gap-6 lg:grid-cols-2'>
          <Section title='Sanctions en jeu'>
            {!p.sanctions.length && !p.bans.length ? <EmptyState title='Aucune sanction en jeu' icon={Gavel} /> : (
              <ul className='divide-y'>
                {p.bans.map((b) => <li key={`ban-${b.id}`} className='px-4 py-2 text-sm'><Pill tone='danger'>Ban actif</Pill> {b.reason ?? 'sans raison'} · par {b.by ?? '?'} · fin {b.expire && b.expire < 9e12 ? dateTime(b.expire) : 'jamais'}</li>)}
                {p.sanctions.map((s) => (
                  <li key={s.id} className='flex flex-wrap items-center gap-2 px-4 py-2 text-sm'>
                    <Pill tone={SANCTION[s.type]?.tone ?? 'neutral'}>{SANCTION[s.type]?.label ?? s.type}</Pill>
                    <span className='min-w-0 flex-1 [overflow-wrap:anywhere]'>{s.reason || 'sans raison'}{s.durationMinutes ? ` · ${s.durationMinutes} min` : ''}</span>
                    <span className='text-xs text-muted-foreground'>{s.by} · {dateTime(s.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title='Signalements envoyés en jeu'>
            {!p.reports.length ? <EmptyState title='Aucun signalement' /> : (
              <ul className='divide-y'>{p.reports.map((r) => <li key={r.id} className='grid gap-1 px-4 py-2 text-sm'><div className='flex flex-wrap items-center gap-2'><Pill tone={r.status === 'resolved' ? 'success' : 'warning'}>{r.status}</Pill>{r.category && <Pill tone='neutral'>{r.category}</Pill>}<span className='text-xs text-muted-foreground'>{dateTime(r.at)}{r.claimedBy ? ` · pris par ${r.claimedBy}` : ''}</span></div><p className='[overflow-wrap:anywhere]'>{r.message}</p></li>)}</ul>
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Bar({ label, value, tone = 'bg-primary' }: { label: string; value: number | null; tone?: string }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0)))
  return (
    <div className='grid gap-0.5'>
      <div className='flex justify-between text-[11px] text-muted-foreground'><span>{label}</span><span className='tabular-nums'>{value === null ? '—' : Math.round(v)}</span></div>
      <div className='h-1.5 overflow-hidden rounded-full bg-muted'><div className={cn('h-full rounded-full', tone)} style={{ width: `${v}%` }} /></div>
    </div>
  )
}

function CharacterCard({ c }: { c: Character }) {
  const licences = Object.entries(c.identity.licences ?? {}).filter(([, on]) => on).map(([k]) => k)
  return (
    <section className='grid gap-4 rounded-xl border bg-card p-4'>
      <div className='flex flex-wrap items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <h3 className='font-display text-lg font-semibold'>{c.name}</h3>
          <p className='text-xs text-muted-foreground'>{c.citizenId} · {c.gender ?? '?'}{c.birthdate ? ` · né(e) le ${c.birthdate}` : ''}{c.nationality ? ` · ${c.nationality}` : ''}{c.phone ? ` · 📱 ${c.phone}` : ''}</p>
        </div>
        {c.status.dead && <Pill tone='danger'>Mort</Pill>}
        {c.jail > 0 && <Pill tone='warning'>Prison {c.jail} mois</Pill>}
        {c.status.handcuffed && <Pill tone='warning'>Menotté</Pill>}
        {c.vip && <Pill tone='accent'>VIP {c.vip}</Pill>}
      </div>
      <div className='grid gap-2 sm:grid-cols-2'>
        <div className='rounded-lg border p-2.5 text-sm'>
          <div className='text-xs text-muted-foreground'>Métier</div>
          {c.job ? <div className='font-medium'>{c.job.label}{c.job.gradeLabel ? ` · ${c.job.gradeLabel}` : ''}{c.job.isBoss ? ' 👑' : ''}</div> : <div>—</div>}
          {c.job && <div className='text-xs'>{c.job.onDuty ? '🟢 en service' : 'hors service'}</div>}
        </div>
        <div className='rounded-lg border p-2.5 text-sm'>
          <div className='text-xs text-muted-foreground'>Gang</div>
          <div className='font-medium'>{c.gang ? `${c.gang.label}${c.gang.gradeLabel ? ` · ${c.gang.gradeLabel}` : ''}${c.gang.isBoss ? ' 👑' : ''}` : '—'}</div>
        </div>
      </div>
      {c.money && (
        <div className='flex flex-wrap gap-4 text-sm'><span>💵 {money(c.money.cash)}</span><span>🏦 {money(c.money.bank)}</span>{c.money.crypto ? <span>₿ {c.money.crypto}</span> : null}{c.coins ? <span>🪙 {c.coins}</span> : null}</div>
      )}
      <div className='grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5'>
        <Bar label='Santé' value={c.status.health === null ? null : Math.max(0, (c.status.health - 100))} tone='bg-destructive' />
        <Bar label='Armure' value={c.status.armor} tone='bg-info' />
        <Bar label='Faim' value={c.status.hunger} tone='bg-warning' />
        <Bar label='Soif' value={c.status.thirst} tone='bg-info' />
        <Bar label='Stress' value={c.status.stress} tone='bg-primary' />
      </div>
      {(c.groups.length > 0 || c.duty.length > 0) && (
        <div className='grid gap-1 text-sm'>
          <div className='text-xs font-medium text-muted-foreground'>Métiers et gangs (temps de service)</div>
          {c.groups.map((g) => <div key={g.name} className='flex flex-wrap items-center gap-2'><Pill tone={g.type === 'gang' ? 'danger' : 'info'}>{g.label}</Pill><span>{g.gradeLabel ?? `grade ${g.grade}`}</span>{c.duty.find((d) => d.job === g.name) && <span className='text-xs text-muted-foreground'>· {hours(c.duty.find((d) => d.job === g.name)!.seconds)} de service</span>}</div>)}
        </div>
      )}
      <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        {c.identity.bloodType && <span><HeartPulse className='inline size-3' /> {c.identity.bloodType}</span>}
        {c.identity.callsign && <span>Indicatif {c.identity.callsign}</span>}
        {licences.length > 0 && <span>Permis : {licences.join(', ')}</span>}
        {c.identity.criminalRecord?.hasRecord && <span className='text-warning'>Casier judiciaire</span>}
        <span>{c.outfits} tenue{c.outfits > 1 ? 's' : ''}</span>
        {c.properties.length > 0 && <span>{c.properties.length} propriété{c.properties.length > 1 ? 's' : ''}</span>}
        <span>Vu {dateTime(c.lastUpdated)}</span>
      </div>
      {c.backstory && <p className='rounded-lg bg-muted/40 p-2 text-xs whitespace-pre-line [overflow-wrap:anywhere]'>{c.backstory}</p>}
    </section>
  )
}

function Items({ items }: { items: Item[] }) {
  if (!items.length) return <EmptyState title='Vide' icon={Backpack} />
  return (
    <ul className='grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3'>
      {items.map((i, k) => <li key={`${i.name}-${k}`} className='flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs'><span className='truncate'>{i.name}</span><span className='font-medium tabular-nums'>×{i.count}</span></li>)}
    </ul>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['fivem-db-settings'], queryFn: () => api<{ enabled: boolean; host: string; port: number; database: string; user: string; hasPassword: boolean }>('/fivem-data/settings') })
  const [form, setForm] = useState<{ enabled: boolean; host: string; port: number; database: string; user: string; password: string } | null>(null)
  const f = form ?? (data ? { ...data, password: '' } : null)
  const save = useMutation({
    mutationFn: () => api('/fivem-data/settings', { method: 'PUT', body: f }),
    onSuccess: () => { toast.success('Connexion enregistrée'); qc.invalidateQueries(); setForm(null) },
  })
  const test = useMutation({
    mutationFn: () => api<{ version: string; tables: number; features: Record<string, boolean> }>('/fivem-data/test', { method: 'POST' }),
    onSuccess: (r) => toast.success(`Connecté : ${r.tables} tables (MariaDB ${r.version.split('-')[0]})`),
  })
  const set = (patch: Partial<NonNullable<typeof f>>) => f && setForm({ ...f, ...patch })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'><Database className='size-5' /> Base de données FiveM</DialogTitle>
          <DialogDescription>Le bot ne fait que lire. Conseillé : un utilisateur MariaDB dédié avec seulement le droit SELECT sur la base du serveur.</DialogDescription>
        </DialogHeader>
        {!f ? <Skeleton className='h-48' /> : (
          <div className='grid gap-4'>
            <label className='flex items-center gap-2 text-sm'><Switch checked={f.enabled} onCheckedChange={(enabled) => set({ enabled })} /> Activée</label>
            <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]'>
              <div className='grid gap-1.5'><Label htmlFor='db-host'>Hôte</Label><Input id='db-host' value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder='192.168.1.41' /></div>
              <div className='grid gap-1.5'><Label htmlFor='db-port'>Port</Label><Input id='db-port' type='number' value={f.port} onChange={(e) => set({ port: Number(e.target.value) })} /></div>
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'><Label htmlFor='db-name'>Base</Label><Input id='db-name' value={f.database} onChange={(e) => set({ database: e.target.value })} placeholder='s10_qbox' /></div>
              <div className='grid gap-1.5'><Label htmlFor='db-user'>Utilisateur</Label><Input id='db-user' value={f.user} onChange={(e) => set({ user: e.target.value })} autoComplete='off' /></div>
            </div>
            <div className='grid gap-1.5'><Label htmlFor='db-pass'>Mot de passe</Label><Input id='db-pass' type='password' value={f.password} onChange={(e) => set({ password: e.target.value })} placeholder={data?.hasPassword ? 'inchangé' : ''} autoComplete='new-password' /></div>
            {test.data && <div className='flex flex-wrap gap-1'>{Object.entries(test.data.features).map(([t, ok]) => <Pill key={t} tone={ok ? 'success' : 'neutral'}>{t}</Pill>)}</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' loading={test.isPending} onClick={() => test.mutate()}>Tester</Button>
          <Button loading={save.isPending} disabled={!f} onClick={() => save.mutate()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
