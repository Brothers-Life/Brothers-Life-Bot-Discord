import { useDeferredValue, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, ArrowLeft, Backpack, Banknote, Briefcase, ChartNoAxesCombined, Link2, Car, Clock, Database, Gamepad2, Gavel, HeartPulse, IdCard, Search, Settings, ShieldCheck, Siren, Wallet, Users,
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
import { hours, money } from '@/features/fivem/format'
import type { Character, Item, Overview, Sheet, Summary } from '@/features/fivem/types'
import { ActivityTab, EconomyTab, JobsTab, JusticeTab, ServerTab, StaffTab, VehiclesTab, WorldTab } from '@/features/fivem/server'
import { GameLogs } from '@/features/fivem/logs'
import { RolesTab } from '@/features/fivem/roles'
import { InsightsTab } from '@/features/fivem/insights'
import { PlayerActivityChart, PlayerPhone, PlayerPolice, PlayerShop, PlayerStaff, PlayerWork } from '@/features/fivem/player-extras'
import { hasPoliceTab, hasStaffTab, hasWorkTab } from '@/features/fivem/sheet'

const TABS = ['players', 'stats', 'activity', 'jobs', 'vehicles', 'justice', 'world', 'staff', 'economy', 'roles', 'logs'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/_authenticated/fivem-players')({
  validateSearch: (search: Record<string, unknown>): { id?: number; tab?: Tab } => ({
    id: typeof search.id === 'number' || typeof search.id === 'string' ? Number(search.id) || undefined : undefined,
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: FivemPlayersPage,
})

const SANCTION: Record<string, { label: string; tone: 'danger' | 'warning' | 'info' | 'success' | 'neutral' }> = {
  ban: { label: 'Ban', tone: 'danger' }, kick: { label: 'Kick', tone: 'warning' }, warn: { label: 'Warn', tone: 'warning' }, jail: { label: 'Prison', tone: 'info' }, unban: { label: 'Déban', tone: 'success' }, unjail: { label: 'Sortie', tone: 'success' },
}

function FivemPlayersPage() {
  const { can } = useMe()
  const { id, tab } = Route.useSearch()
  const navigate = useNavigate({ from: '/fivem-players' })
  const [settings, setSettings] = useState(false)
  return (
    <Page
      title='FiveM · Base de données'
      description='Tout ce que contient la base du serveur FiveM : joueurs, activité, métiers, véhicules, justice, carte, staff, économie et logs du jeu. Ce que chacun voit dépend de ses permissions.'
      actions={
        <div className='flex gap-2'>
          {id && <Button variant='outline' onClick={() => navigate({ search: { id: undefined, tab } })}><ArrowLeft /> Retour</Button>}
          {can('fivemdata.manage') && <Button variant='ghost' onClick={() => setSettings(true)}><Settings /> Connexion</Button>}
        </div>
      }
    >
      {id
        ? <PlayerSheet userId={id} />
        : <Directory tab={tab ?? 'players'} onTab={(t) => navigate({ search: { id: undefined, tab: t === 'players' ? undefined : t }, replace: true })} onOpen={(userId) => navigate({ search: { id: userId, tab } })} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </Page>
  )
}

function Directory({ tab, onTab, onOpen }: { tab: Tab; onTab: (tab: Tab) => void; onOpen: (userId: number) => void }) {
  const { can } = useMe()
  const overview = useQuery({ queryKey: ['fivem-overview'], queryFn: () => api<Overview>('/fivem-data/overview'), retry: false, refetchInterval: 60_000 })

  if (overview.error) {
    return (
      <Notice tone='warning' title='Base FiveM indisponible'>
        {errorMessage(overview.error)}{can('fivemdata.manage') ? ' Règle la connexion avec le bouton « Connexion ».' : ' Demande à un responsable de régler la connexion.'}
      </Notice>
    )
  }
  const o = overview.data
  const economy = can('fivemdata.economy')
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {o ? (
        <StatCards items={[
          { label: 'Comptes', value: o.accounts, icon: Users, tone: 'accent' },
          { label: 'Personnages', value: o.characters, icon: IdCard, tone: 'info' },
          { label: 'En jeu maintenant', value: o.online, icon: Gamepad2, tone: 'success' },
          { label: 'Heures jouées (7 j)', value: Math.round(o.week.seconds / 3600), icon: Clock, tone: 'warning', hint: `${o.week.players} joueurs` },
        ]} />
      ) : <Skeleton className='h-24 w-full' />}

      <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)}>
        <TabsList className='h-auto max-w-full flex-wrap justify-start [&>button]:h-8 [&>button]:flex-none'>
          <TabsTrigger value='players'><Users /> Joueurs</TabsTrigger>
          <TabsTrigger value='stats'><ChartNoAxesCombined /> Statistiques</TabsTrigger>
          <TabsTrigger value='activity'><Activity /> Activité</TabsTrigger>
          <TabsTrigger value='jobs'><Briefcase /> Métiers et gangs</TabsTrigger>
          <TabsTrigger value='vehicles'><Car /> Véhicules</TabsTrigger>
          <TabsTrigger value='justice'><Gavel /> Justice</TabsTrigger>
          <TabsTrigger value='world'><Siren /> Carte</TabsTrigger>
          <TabsTrigger value='staff'><ShieldCheck /> Staff</TabsTrigger>
          {economy && <TabsTrigger value='economy'><Banknote /> Économie</TabsTrigger>}
          {can('fivemdata.roles') && <TabsTrigger value='roles'><Link2 /> Rôles Discord</TabsTrigger>}
          {can('fivemdata.logs') && <TabsTrigger value='logs'><Database /> Logs du jeu</TabsTrigger>}
        </TabsList>
        <TabsContent value='players' className='mt-4'><Players onOpen={onOpen} top={o?.topPlaytime ?? []} /></TabsContent>
        <TabsContent value='stats' className='mt-4'><InsightsTab onOpen={onOpen} /></TabsContent>
        <TabsContent value='activity' className='mt-4'><ServerTab>{(r) => <ActivityTab r={r} />}</ServerTab></TabsContent>
        <TabsContent value='jobs' className='mt-4'><ServerTab>{(r) => <JobsTab r={r} economy={economy} />}</ServerTab></TabsContent>
        <TabsContent value='vehicles' className='mt-4'><ServerTab>{(r) => <VehiclesTab r={r} />}</ServerTab></TabsContent>
        <TabsContent value='justice' className='mt-4'><ServerTab>{(r) => <JusticeTab r={r} onOpen={onOpen} />}</ServerTab></TabsContent>
        <TabsContent value='world' className='mt-4'><ServerTab>{(r) => <WorldTab r={r} />}</ServerTab></TabsContent>
        <TabsContent value='staff' className='mt-4'><ServerTab>{(r) => <StaffTab r={r} />}</ServerTab></TabsContent>
        {economy && <TabsContent value='economy' className='mt-4'><ServerTab>{(r) => <EconomyTab r={r} />}</ServerTab></TabsContent>}
        {can('fivemdata.roles') && <TabsContent value='roles' className='mt-4'><RolesTab onOpen={onOpen} /></TabsContent>}
        {can('fivemdata.logs') && <TabsContent value='logs' className='mt-4'><GameLogs /></TabsContent>}
      </Tabs>
    </div>
  )
}

function Players({ onOpen, top }: { onOpen: (userId: number) => void; top: Overview['topPlaytime'] }) {
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const players = useQuery({ queryKey: ['fivem-players', q], queryFn: () => api<Summary[]>(`/fivem-data/players?q=${encodeURIComponent(q)}`), retry: false, placeholderData: (prev) => prev })
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]'>
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
                      {p.characters.map((c) => <Pill key={c.citizenId} tone='neutral'>{c.name}{c.job ? ` · ${c.job.label}` : ''}{c.gang ? ` · ${c.gang.label}` : ''}</Pill>)}
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
      <Section title='Les plus actifs (30 j)'>
        <ol className='divide-y'>
          {top.map((t, i) => (
            <li key={t.userId}><button type='button' onClick={() => onOpen(t.userId)} className='flex w-full items-center gap-3 px-4 py-2 text-start text-sm hover:bg-accent/40'><span className='w-5 text-xs text-muted-foreground tabular-nums'>{i + 1}</span><span className='flex-1 truncate'>{t.username}</span><span className='tabular-nums'>{hours(t.seconds)}</span></button></li>
          ))}
        </ol>
      </Section>
    </div>
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
          {hasWorkTab(p) && <TabsTrigger value='work'><Briefcase /> Travail</TabsTrigger>}
          <TabsTrigger value='sessions'><Clock /> Activité</TabsTrigger>
          <TabsTrigger value='sanctions'><Gavel /> Sanctions ({p.sanctions.length + p.bans.length})</TabsTrigger>
          {hasPoliceTab(p) && <TabsTrigger value='police'><Siren /> Police</TabsTrigger>}
          {hasStaffTab(p) && <TabsTrigger value='staff'><ShieldCheck /> Staff</TabsTrigger>}
        </TabsList>

        {hasWorkTab(p) && <TabsContent value='work' className='mt-4'><PlayerWork p={p} /></TabsContent>}
        {hasPoliceTab(p) && <TabsContent value='police' className='mt-4'><PlayerPolice p={p} /></TabsContent>}
        {hasStaffTab(p) && <TabsContent value='staff' className='mt-4'><PlayerStaff p={p} /></TabsContent>}

        <TabsContent value='characters' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
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
          <TabsContent value='inventory' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
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
            {p.stashes.map((s) => (
              <Section key={`s-${s.name}`} title={`Coffre ${s.name}`} description={`${s.owner} · ${dateTime(s.at)}`}>
                <Items items={s.items} />
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
            <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
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
            <PlayerShop p={p} />
            <PlayerPhone p={p} />
          </TabsContent>
        )}

        <TabsContent value='sessions' className='mt-4 grid gap-6'>
          <PlayerActivityChart p={p} />
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

        <TabsContent value='sanctions' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
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
      <div className='grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2'>
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
    // Tests what is typed (not yet saved); an empty password reuses the saved one for the same host and user
    mutationFn: () => api<{ version: string; tables: number; features: Record<string, boolean> }>('/fivem-data/test', { method: 'POST', body: f ? { host: f.host, port: f.port, database: f.database, user: f.user, password: f.password } : {} }),
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
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]'>
              <div className='grid gap-1.5'><Label htmlFor='db-host'>Hôte</Label><Input id='db-host' value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder='127.0.0.1' /></div>
              <div className='grid gap-1.5'><Label htmlFor='db-port'>Port</Label><Input id='db-port' type='number' value={f.port} onChange={(e) => set({ port: Number(e.target.value) })} /></div>
            </div>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'><Label htmlFor='db-name'>Base</Label><Input id='db-name' value={f.database} onChange={(e) => set({ database: e.target.value })} placeholder='s10_qbox' /></div>
              <div className='grid gap-1.5'><Label htmlFor='db-user'>Utilisateur</Label><Input id='db-user' value={f.user} onChange={(e) => set({ user: e.target.value })} autoComplete='off' /></div>
            </div>
            <div className='grid gap-1.5'><Label htmlFor='db-pass'>Mot de passe</Label><Input id='db-pass' type='password' value={f.password} onChange={(e) => set({ password: e.target.value })} placeholder={data?.hasPassword ? 'inchangé' : ''} autoComplete='new-password' /></div>
            {test.data && (
              <div className='grid gap-1 text-sm'>
                <p className='text-success'>Connexion réussie : {test.data.tables} tables trouvées.</p>
                <details className='text-xs text-muted-foreground'>
                  <summary className='cursor-pointer'>Détails techniques (tables utilisées par le panel)</summary>
                  <div className='mt-2 flex flex-wrap gap-1'>{Object.entries(test.data.features).map(([t, ok]) => <Pill key={t} tone={ok ? 'success' : 'neutral'}>{t}</Pill>)}</div>
                </details>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' loading={test.isPending} onClick={() => test.mutate()}>Tester ces réglages</Button>
          <Button loading={save.isPending} disabled={!f} onClick={() => save.mutate()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
