import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import { Banknote, Car, ChevronDown, Clock, Coins, Gavel, Landmark, MapPin, ShieldCheck, Siren, TrendingUp, Users, Warehouse, Wrench } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { EmptyState, Notice, Pill, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { count, hours, money, plural } from './format'
import type { Job, ServerReport } from './types'
import { Bars, Chart } from './charts'
import { WEEK, axis, shortDay, tooltip } from './chart-style'

export function useServerReport() {
  return useQuery({ queryKey: ['fivem-server'], queryFn: () => api<ServerReport>('/fivem-data/server'), retry: false, staleTime: 60_000, refetchInterval: 120_000 })
}

// Loads the report once for every server tab
export function ServerTab({ children }: { children: (report: ServerReport) => React.ReactNode }) {
  const { data, error } = useServerReport()
  if (error) return <Notice tone='warning' title='Données indisponibles'>{errorMessage(error)}</Notice>
  if (!data) return <Skeleton className='h-96 w-full' />
  return <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>{children(data)}</div>
}

export function ActivityTab({ r }: { r: ServerReport }) {
  const a = r.activity
  const max = Math.max(1, ...a.heatmap.flat())
  return (
    <>
      <StatCards items={[
        { label: 'Joueurs sur 30 jours', value: a.totals.players, icon: Users, tone: 'accent' },
        { label: 'Record simultané (30 j)', value: a.totals.peak, icon: TrendingUp, tone: 'success' },
        { label: 'Heures jouées (30 j)', value: count(a.totals.hours), icon: Clock, tone: 'warning' },
        { label: 'Session moyenne', value: `${a.totals.avgMinutes} min`, icon: Clock, tone: 'info', hint: plural(a.totals.sessions, 'session') },
      ]} />
      <div className='grid gap-4 lg:grid-cols-2'>
        <Chart title='Joueurs par jour et record simultané' className='lg:col-span-2'>
          <AreaChart data={a.days} margin={{ left: -16, right: 8, top: 4 }}>
            <defs>
              <linearGradient id='g-players' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stopColor='var(--primary)' stopOpacity={0.45} />
                <stop offset='100%' stopColor='var(--primary)' stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
            <YAxis {...axis} allowDecimals={false} />
            <Tooltip {...tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type='monotone' dataKey='players' name='Joueurs' stroke='var(--primary)' fill='url(#g-players)' strokeWidth={2} />
            <Area type='monotone' dataKey='peak' name='Record simultané' stroke='var(--success)' fill='transparent' strokeWidth={2} />
          </AreaChart>
        </Chart>
        <Chart title='Heures jouées par jour'>
          <BarChart data={a.days} margin={{ left: -16, right: 8, top: 4 }}>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
            <YAxis {...axis} />
            <Tooltip {...tooltip} cursor={{ fill: 'var(--accent)' }} />
            <Bar dataKey='hours' name='Heures' fill='var(--warning)' radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
        <Chart title='Nouveaux joueurs'>
          <BarChart data={a.days} margin={{ left: -16, right: 8, top: 4 }}>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
            <YAxis {...axis} allowDecimals={false} />
            <Tooltip {...tooltip} cursor={{ fill: 'var(--accent)' }} />
            <Bar dataKey='newPlayers' name='Nouveaux' fill='var(--success)' radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </div>
      <Section title='Quand les joueurs se connectent' description='Joueurs différents connectés par jour de la semaine et par heure, sur 60 jours.'>
        <div className='overflow-x-auto p-3'>
          <table className='w-full min-w-[640px] table-fixed border-separate border-spacing-0.5 text-xs'>
            <thead>
              <tr><th className='w-10' />{Array.from({ length: 24 }, (_, h) => <th key={h} className='font-normal text-muted-foreground'>{h % 3 === 0 ? `${h}h` : ''}</th>)}</tr>
            </thead>
            <tbody>
              {a.heatmap.map((row, d) => (
                <tr key={d}>
                  <th className='pe-2 text-end font-normal text-muted-foreground'>{WEEK[d]}</th>
                  {row.map((v, h) => (
                    <td key={h} title={`${WEEK[d]} ${h}h : ${plural(v, 'joueur')}`} className='h-7 rounded-[3px]'
                      style={{ background: v ? `color-mix(in oklab, var(--primary) ${Math.round(15 + (v / max) * 85)}%, transparent)` : 'var(--muted)' }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <div className='grid gap-6 lg:grid-cols-2'>
        <Section title={`En jeu maintenant (${a.online.length})`}>
          {!a.online.length ? <EmptyState title='Personne en jeu' icon={Users} /> : (
            <ul className='divide-y'>{a.online.map((o) => <li key={o.userId} className='flex items-center gap-2 px-4 py-2 text-sm'><span className='live-dot size-2 rounded-full bg-success' aria-hidden /><span className='flex-1'>{o.username}</span><span className='text-xs text-muted-foreground'>depuis {o.since ? hours((r.at - o.since) / 1000) : '?'}</span></li>)}</ul>
          )}
        </Section>
        <Section title='Raisons de déconnexion (30 j)' description='Crashs, timeouts, kicks : utile pour repérer un souci serveur.'>
          <Bars rows={a.drops.map((d) => ({ key: d.reason, label: <span title={d.reason}>{d.reason}</span>, value: d.count }))} tone='bg-destructive/15' />
        </Section>
      </div>
    </>
  )
}

export function JobsTab({ r, economy }: { r: ServerReport; economy: boolean }) {
  const [type, setType] = useState<'job' | 'gang'>('job')
  const [open, setOpen] = useState<string | null>(null)
  const list = r.jobs.filter((j) => j.type === type)
  const staffed = r.jobs.filter((j) => j.type === 'job' && j.members)
  return (
    <>
      <StatCards items={[
        { label: 'Métiers', value: r.jobs.filter((j) => j.type === 'job').length, icon: Wrench, tone: 'info', hint: `${staffed.length} avec des employés` },
        { label: 'Gangs', value: r.jobs.filter((j) => j.type === 'gang').length, icon: ShieldCheck, tone: 'danger' },
        { label: 'En service (déclaré)', value: r.jobs.reduce((n, j) => n + j.onDuty, 0), icon: Users, tone: 'success' },
        { label: 'Heures de service cumulées', value: count(Math.round(r.jobs.reduce((n, j) => n + j.dutySeconds, 0) / 3600)), icon: Clock, tone: 'warning' },
      ]} />
      <Section
        title={type === 'job' ? 'Métiers' : 'Gangs'}
        description='Clique sur une ligne pour voir les grades.'
        actions={
          <div className='flex rounded-md border p-0.5 text-sm'>
            {(['job', 'gang'] as const).map((t) => (
              <button key={t} type='button' onClick={() => setType(t)} className={cn('rounded px-3 py-1', type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} aria-pressed={type === t}>
                {t === 'job' ? 'Métiers' : 'Gangs'}
              </button>
            ))}
          </div>
        }
      >
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[46rem] text-sm'>
            <thead>
              <tr className='border-b text-xs text-muted-foreground'>
                <th className='px-4 py-2 text-start font-medium'>Nom</th>
                <th className='px-2 text-end font-medium'>Membres</th>
                <th className='px-2 text-end font-medium'>En service</th>
                <th className='px-2 text-end font-medium'>Service total</th>
                <th className='px-2 text-end font-medium'>Cette semaine</th>
                <th className='px-2 text-start font-medium'>Niveau</th>
                {economy && <th className='px-4 text-end font-medium'>Factures</th>}
              </tr>
            </thead>
            <tbody className='divide-y'>
              {list.map((j) => <JobRow key={j.name} j={j} economy={economy} open={open === j.name} onToggle={() => setOpen(open === j.name ? null : j.name)} />)}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}

function JobRow({ j, economy, open, onToggle }: { j: Job; economy: boolean; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className='cursor-pointer hover:bg-accent/40' onClick={onToggle} aria-expanded={open}>
        <td className='px-4 py-2'>
          <div className='flex items-center gap-2'>
            <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden />
            <span className='font-medium'>{j.label}</span>
            <span className='text-xs text-muted-foreground'>{j.name}</span>
            {j.open && <Pill tone={j.open.isOpen ? 'success' : 'neutral'}>{j.open.isOpen ? 'ouvert' : 'fermé'}</Pill>}
            {j.gang?.category && <Pill tone='danger'>{j.gang.category}</Pill>}
          </div>
        </td>
        <td className='px-2 text-end tabular-nums'>{j.members || '—'}</td>
        <td className='px-2 text-end tabular-nums'>{j.onDuty || '—'}</td>
        <td className='px-2 text-end tabular-nums'>{j.dutySeconds ? hours(j.dutySeconds) : '—'}</td>
        <td className='px-2 text-end tabular-nums'>{j.weekDutySeconds ? `${hours(j.weekDutySeconds)} · ${j.weekPeople} pers.` : '—'}</td>
        <td className='px-2'>{j.level ? `niv. ${j.level.level}${j.level.title ? ` · ${j.level.title}` : ''}` : j.gang?.xp ? `${count(j.gang.xp)} XP` : '—'}</td>
        {economy && <td className='px-4 text-end tabular-nums'>{j.invoices ? <span title={`${j.invoices.count} factures`}>{money(j.invoices.total)}{j.invoices.unpaid ? <span className='text-destructive'> ({money(j.invoices.unpaid)} impayé)</span> : null}</span> : '—'}</td>}
      </tr>
      {open && (
        <tr className='bg-muted/30'>
          <td colSpan={economy ? 7 : 6} className='px-4 py-3'>
            <div className='flex flex-wrap gap-1.5'>
              {j.grades.length ? j.grades.map((g) => <Pill key={g.grade} tone={g.isBoss ? 'accent' : 'neutral'}>{g.grade} · {g.name}{g.payment !== null && economy ? ` · ${money(g.payment)}` : ''}{g.isBoss ? ' 👑' : ''}</Pill>) : <span className='text-sm text-muted-foreground'>Aucun grade défini.</span>}
            </div>
            <div className='mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground'>
              {j.safeMoves > 0 && <span>{plural(j.safeMoves, 'mouvement')} de coffre (30 j)</span>}
              {economy && j.payroll && <span>Dernière paie : {money(j.payroll.total)} pour {plural(j.payroll.employees, 'employé')} · {dateTime(j.payroll.at)}{j.payroll.by ? ` par ${j.payroll.by}` : ''}</span>}
              {j.level && <span>{count(j.level.xp)} XP</span>}
              {j.gang?.maxMembers ? <span>max {j.gang.maxMembers} membres</span> : null}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function VehiclesTab({ r }: { r: ServerReport }) {
  const v = r.vehicles
  return (
    <>
      <StatCards items={[
        { label: 'Véhicules possédés', value: v.total, icon: Car, tone: 'accent' },
        { label: 'Au garage', value: v.garage, icon: Warehouse, tone: 'info' },
        { label: 'Dehors', value: v.out, icon: MapPin, tone: 'warning' },
        { label: 'En fourrière', value: v.impound, icon: Siren, tone: 'danger', hint: `${v.damaged} abîmés · ${v.fakePlates} fausses plaques` },
      ]} />
      <div className='grid gap-6 lg:grid-cols-2'>
        <Section title='Modèles les plus possédés'><Bars rows={v.models.map((m) => ({ key: m.model, label: m.model, value: m.count }))} /></Section>
        <Section title='Garages les plus remplis' description={`${v.customGarages} garages configurés sur le serveur.`}><Bars rows={v.garages.map((g) => ({ key: g.garage, label: g.garage, value: g.count }))} tone='bg-info/20' /></Section>
      </div>
    </>
  )
}

const SANCTION_TONE: Record<string, 'danger' | 'warning' | 'info' | 'success' | 'neutral'> = { ban: 'danger', kick: 'warning', warn: 'warning', jail: 'info', unban: 'success', unjail: 'success' }

export function JusticeTab({ r, onOpen }: { r: ServerReport; onOpen: (userId: number) => void }) {
  const j = r.justice
  const openReports = j.reports.filter((x) => x.status !== 'resolved' && x.status !== 'closed')
  return (
    <>
      <StatCards items={[
        { label: 'En prison', value: j.jailed.length, icon: Gavel, tone: 'warning' },
        { label: 'Bans actifs', value: j.bans.length, icon: ShieldCheck, tone: 'danger' },
        { label: 'Signalements ouverts', value: openReports.length, icon: Siren, tone: 'info' },
        { label: 'Sanctions (30 j)', value: Object.values(j.sanctions30).reduce((a, b) => a + b, 0), icon: Gavel, tone: 'accent', hint: Object.entries(j.sanctions30).map(([k, n]) => `${n} ${k}`).join(' · ') || undefined },
      ]} />
      <div className='grid gap-6 lg:grid-cols-2'>
        <Section title='Dernières sanctions en jeu'>
          {!j.sanctions.length ? <EmptyState title='Aucune sanction' icon={Gavel} /> : (
            <ul className='divide-y'>
              {j.sanctions.map((s) => (
                <li key={s.id}>
                  <button type='button' disabled={!s.userId} onClick={() => s.userId && onOpen(s.userId)} className='flex w-full flex-wrap items-center gap-2 px-4 py-2 text-start text-sm enabled:hover:bg-accent/40'>
                    <Pill tone={SANCTION_TONE[s.type] ?? 'neutral'}>{s.type}</Pill>
                    <span className='font-medium'>{s.target ?? '?'}</span>
                    <span className='min-w-0 flex-1 truncate text-muted-foreground'>{s.reason || 'sans raison'}{s.durationMinutes ? ` · ${s.durationMinutes} min` : ''}</span>
                    <span className='text-xs text-muted-foreground'>{s.by} · {dateTime(s.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className='grid content-start gap-6'>
          <Section title='Signalements'>
            {!j.reports.length ? <EmptyState title='Aucun signalement' /> : (
              <ul className='divide-y'>{j.reports.map((x) => (
                <li key={x.id} className='grid gap-1 px-4 py-2 text-sm'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Pill tone={x.status === 'resolved' ? 'success' : 'warning'}>{x.status}</Pill>
                    {x.priority && <Pill tone={x.priority === 'high' ? 'danger' : 'neutral'}>{x.priority}</Pill>}
                    {x.category && <Pill tone='neutral'>{x.category}</Pill>}
                    <span className='font-medium'>{x.sender}</span>
                    <span className='text-xs text-muted-foreground'>{dateTime(x.at)}{x.resolvedBy ? ` · réglé par ${x.resolvedBy}` : x.claimedBy ? ` · pris par ${x.claimedBy}` : ''}</span>
                  </div>
                  <p className='[overflow-wrap:anywhere]'>{x.message}</p>
                </li>
              ))}</ul>
            )}
          </Section>
          <Section title='Bans en jeu'>
            {!j.bans.length ? <EmptyState title='Aucun ban' /> : (
              <ul className='divide-y'>{j.bans.map((b) => <li key={b.id} className='px-4 py-2 text-sm'><span className='font-medium'>{b.name ?? '?'}</span> · {b.reason ?? 'sans raison'} <span className='text-xs text-muted-foreground'>· par {b.by ?? '?'} · fin {b.expire && b.expire < 9e12 ? dateTime(b.expire) : 'jamais'}</span></li>)}</ul>
            )}
          </Section>
          <Section title='En prison'>
            {!j.jailed.length ? <EmptyState title='Personne en prison' /> : (
              <ul className='divide-y'>{j.jailed.map((p) => <li key={p.citizenId} className='flex justify-between px-4 py-2 text-sm'><span>{p.name}</span><span className='tabular-nums'>{p.months} mois</span></li>)}</ul>
            )}
          </Section>
        </div>
      </div>
      <Section title='Appels au central (MDT)'>
        {!j.calls.length ? <EmptyState title='Aucun appel' icon={Siren} /> : (
          <ul className='divide-y'>{j.calls.map((c) => (
            <li key={c.id} className='flex flex-wrap items-center gap-2 px-4 py-2 text-sm'>
              <Pill tone={c.state === 'open' ? 'warning' : 'neutral'}>{c.state}</Pill>
              <span className='font-medium'>{c.code}</span>
              <span className='min-w-0 flex-1 truncate'>{c.title}{c.place ? ` · ${c.place}` : ''}</span>
              <span className='text-xs text-muted-foreground'>{c.caller ?? 'anonyme'} · {dateTime(c.at)}{c.closedBy ? ` · clos par ${c.closedBy}` : ''}</span>
            </li>
          ))}</ul>
        )}
      </Section>
    </>
  )
}

const WORLD: Record<string, string> = {
  blips: 'Blips sur la carte', doors: 'Portes verrouillables', shops: 'Magasins', markets: 'Marchés', mapObjects: 'Objets posés (éditeur)', craftingTables: 'Établis',
  recipes: 'Recettes d’artisanat', tvScreens: 'Écrans TV', billboards: 'Panneaux publicitaires', djVenues: 'Salles DJ', teleports: 'Téléporteurs', hotels: 'Hôtels',
  companies: 'Entreprises (téléphone)', stashes: 'Coffres', outfits: 'Tenues enregistrées',
}

export function WorldTab({ r }: { r: ServerReport }) {
  const w = r.world
  return (
    <>
      <Section title='Ce qui est installé sur la carte'>
        <dl className='grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-3 lg:grid-cols-5'>
          {Object.entries(WORLD).map(([key, label]) => (
            <div key={key} className='bg-card px-4 py-3'>
              <dt className='text-xs text-muted-foreground'>{label}</dt>
              <dd className='font-display text-xl font-semibold tabular-nums'>{count(w.counts[key] ?? 0)}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <div className='grid gap-6 lg:grid-cols-2'>
        <Section title='Zones safe' description='Temps passé dedans par les joueurs.'>
          {!w.safezones.length ? <EmptyState title='Aucune zone' /> : (
            <ul className='divide-y'>{w.safezones.map((z) => <li key={z.name} className='flex items-center gap-2 px-4 py-2 text-sm'><Pill tone={z.active ? 'success' : 'neutral'}>{z.active ? 'active' : 'off'}</Pill><span className='flex-1 truncate'>{z.name}</span><span className='text-xs text-muted-foreground'>{plural(z.visits, 'visite')}</span><span className='w-20 text-end tabular-nums'>{hours(z.seconds)}</span></li>)}</ul>
          )}
        </Section>
        <Section title='Meilleurs récolteurs'><Bars rows={w.harvesters.map((h) => ({ key: h.name, label: h.name, value: h.total }))} tone='bg-success/20' /></Section>
      </div>
      <Section title={`Zones de récolte (${w.harvest.length})`}>
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[40rem] text-sm'>
            <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Zone</th><th className='px-2 text-start font-medium'>Objet</th><th className='px-2 text-start font-medium'>Accès</th><th className='px-4 text-end font-medium'>Stock</th></tr></thead>
            <tbody className='divide-y'>
              {w.harvest.map((z) => (
                <tr key={z.id} className={cn(!z.enabled && 'opacity-50')}>
                  <td className='px-4 py-2'>{z.label}{!z.enabled && <span className='ms-1 text-xs'>(désactivée)</span>}</td>
                  <td className='px-2'>{z.item} ×{z.amount}</td>
                  <td className='px-2 text-muted-foreground'>{z.access ?? 'tout le monde'}</td>
                  <td className='px-4 text-end tabular-nums'>{z.stock ? `${z.stock.current} / ${z.stock.max}` : '∞'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}

export function StaffTab({ r }: { r: ServerReport }) {
  const s = r.staff
  return (
    <>
      <Section title='Le staff en jeu (30 jours)' description='Temps en service dans le menu admin, actions faites, sanctions données et signalements traités.'>
        {!s.members.length ? <EmptyState title='Aucun staff en service' /> : (
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[44rem] text-sm'>
              <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Staff</th><th className='px-2 text-end font-medium'>En service</th><th className='px-2 text-end font-medium'>Sessions</th><th className='px-2 text-end font-medium'>Actions</th><th className='px-2 text-end font-medium'>Sanctions</th><th className='px-2 text-end font-medium'>Signalements</th><th className='px-4 text-end font-medium'>Vu</th></tr></thead>
              <tbody className='divide-y'>
                {s.members.map((m) => (
                  <tr key={m.name}>
                    <td className='px-4 py-2'><div className='flex items-center gap-2'><span className={cn('size-2 rounded-full', m.active ? 'live-dot bg-success' : 'bg-muted-foreground/40')} aria-label={m.active ? 'en service' : undefined} /><span className='font-medium'>{m.name}</span>{m.roles.map((role) => <Pill key={role} tone='neutral'>{role}</Pill>)}</div></td>
                    <td className='px-2 text-end tabular-nums'>{hours(m.seconds)}</td>
                    <td className='px-2 text-end tabular-nums'>{m.sessions}</td>
                    <td className='px-2 text-end tabular-nums'>{m.actions}</td>
                    <td className='px-2 text-end tabular-nums'>{m.sanctions}</td>
                    <td className='px-2 text-end tabular-nums'>{m.reports}</td>
                    <td className='px-4 text-end text-xs text-muted-foreground'>{m.active ? 'en service' : dateTime(m.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <div className='grid gap-6 lg:grid-cols-2'>
        <Section title='Rôles du menu admin' description='Nombre de permissions de chaque rôle.'>
          <Bars rows={s.roles.map((role) => ({ key: String(role.id), label: <>{role.label}{role.protected ? ' 🔒' : ''}</>, value: role.actions }))} tone='bg-accent' />
        </Section>
        <Section title='Annonces du staff en jeu'>
          {!s.messages.length ? <EmptyState title='Aucune annonce' /> : (
            <ul className='divide-y'>{s.messages.map((m, i) => <li key={i} className='grid gap-0.5 px-4 py-2 text-sm'><span className='text-xs text-muted-foreground'>{m.by}{m.target ? ` → ${m.target}` : ''} · {dateTime(m.at)}</span><span className='[overflow-wrap:anywhere]'>{m.line}</span></li>)}</ul>
          )}
        </Section>
      </div>
    </>
  )
}

export function EconomyTab({ r }: { r: ServerReport }) {
  const e = r.economy
  if (!e) return <Notice tone='info'>Il faut la permission fivemdata.economy.</Notice>
  return (
    <>
      <StatCards items={[
        { label: 'Argent liquide en circulation', value: money(e.cash), icon: Banknote, tone: 'success' },
        { label: 'Total sur les comptes perso', value: money(e.bank), icon: Landmark, tone: 'info' },
        { label: 'Comptes partagés (entreprises…)', value: money(e.accounts.total), icon: Landmark, tone: 'accent' },
        { label: 'Points premium', value: count(e.premium.points), icon: Coins, tone: 'warning', hint: `${e.premium.purchases30} achats (30 j)` },
      ]} />
      <div className='grid gap-6 lg:grid-cols-2'>
        <Section title='Plus grosses fortunes' description='Liquide + banque par personnage.'>
          <Bars rows={e.fortunes.map((f) => ({ key: f.citizenId, label: <span title={`${money(f.cash)} liquide · ${money(f.bank)} banque`}>{f.name}</span>, value: f.cash + f.bank }))} format={money} tone='bg-success/20' />
        </Section>
        <Section title='Comptes partagés'>
          <ul className='divide-y'>{e.accounts.list.map((a) => <li key={a.id} className='flex items-center gap-2 px-4 py-2 text-sm'><span className='min-w-0 flex-1 truncate font-mono text-xs'>{a.id}</span>{a.frozen && <Pill tone='danger'>gelé</Pill>}{a.savings && <Pill tone='info'>épargne</Pill>}<span className='tabular-nums'>{money(a.amount)}</span></li>)}</ul>
        </Section>
        <Section title='Boutique premium' description={`${e.premium.gifts.sent} cadeaux envoyés (${e.premium.gifts.opened} ouverts) · ${e.premium.promos} codes promo utilisés.`}>
          <Bars rows={e.premium.topItems.map((i) => ({ key: i.label, label: <>{i.label} <span className='text-xs text-muted-foreground'>· {count(i.price)} pts</span></>, value: i.count }))} />
          {e.premium.crates.length > 0 && <div className='flex flex-wrap gap-1.5 border-t px-4 py-3'>{e.premium.crates.map((c) => <Pill key={c.rarity ?? '?'} tone='accent'>{c.rarity ?? '?'} ×{c.count}</Pill>)}</div>}
        </Section>
        <Section title='Mouvements d’argent (30 j)'>
          <Bars rows={[...e.flows.map((f) => ({ key: `f-${f.kind}`, label: `${f.kind} (${f.count})`, value: f.total })), ...e.phone.map((f) => ({ key: `p-${f.kind}`, label: `téléphone · ${f.kind} (${f.count})`, value: f.total }))]} format={money} tone='bg-info/20' />
        </Section>
      </div>
      {e.cryptoMarkets.length > 0 && (
        <Section title='Cours des cryptos (téléphone)'>
          <dl className='grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4 lg:grid-cols-6'>
            {e.cryptoMarkets.map((c) => (
              <div key={c.id} className='bg-card px-3 py-2'>
                <dt className='text-xs text-muted-foreground capitalize'>{c.id}{c.status !== 'active' ? ` (${c.status})` : ''}</dt>
                <dd className='font-medium tabular-nums'>{c.price.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </>
  )
}

