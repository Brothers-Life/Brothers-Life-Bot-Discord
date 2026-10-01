import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, Clock, Coins, Gavel, HeadphonesIcon, Link2, Phone, Scale, ShieldCheck, Timer, TrendingUp, Users } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EmptyState, Notice, Pill, Section, StatCards, UserAvatar } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { count, money } from './format'
import { Bars, Chart } from './charts'
import { WEEK, axis, shortDay, tooltip } from './chart-style'

type Insights = {
  at: number
  attendance: {
    dau: number; wau: number; mau: number; stickiness: number; medianSession: number; hoursPerPlayer: number
    byHour: { hour: number; avg: number; max: number }[]
    sessionLengths: { label: string; count: number }[]
    cohorts: { week: string; players: number; back: (number | null)[] }[]
    churn: { active7: number; away7: number; away14: number; away30: number }
  }
  staff: {
    coverage: number | null; uncoveredHours: number; ratio: number | null
    byHour: { hour: number; coverage: number | null; staff: number }[]
    reports: { count: number; claimMedian: number | null; resolveMedian: number | null; unclaimed: number }
  }
  justice: { per100h: number; repeat: { userId: number | null; name: string; count: number; types: Record<string, number> }[]; grid: number[][] }
  jobs: { checkinGrid: number[][]; weekly: { job: string; week: string; stats: Record<string, number | boolean>; xp: number; level: number }[]; jobless: number; multi: number }
  vehicles: { perPlayer: number; distribution: { label: string; count: number }[]; avgFuel: number; avgEngine: number; jobFleet: { job: string; count: number }[] }
  phone: { calls: number; answered: number | null; avgSeconds: number; health: { day: string; steps: number; km: number; people: number }[] }
  discord: {
    linked: number; accounts: number; members: number | null; membersLinked: number | null
    crossed: { userId: number; username: string; discordId: string; gameHours: number; messages: number; voiceHours: number; kind: 'both' | 'game' | 'discord' | 'inactive'; discord: { name: string | null; avatar: string | null } | null }[]
    profiles: { kind: string; count: number }[]
    correlation: { voice: number | null; messages: number | null }
    days: { day: string; game: number; discord: number; both: number }[]
  }
  economy: {
    gini: number; percentiles: { p10: number; p50: number; p90: number; p99: number }; top10Share: number
    distribution: { label: string; count: number }[]
    byJob: { job: string; count: number; total: number; avg: number }[]
    perHour: { userId: number; username: string; wealth: number; hours: number; perHour: number }[]
    crypto: { assets: string[]; points: Record<string, string | number | null>[]; holders: { asset: string; holders: number }[] }
  } | null
}

const PROFILE: Record<string, { label: string; tone: 'success' | 'info' | 'accent' | 'neutral' }> = {
  both: { label: 'Jeu et Discord', tone: 'success' },
  game: { label: 'Surtout en jeu', tone: 'info' },
  discord: { label: 'Surtout sur Discord', tone: 'accent' },
  inactive: { label: 'Peu actif (30 j)', tone: 'neutral' },
}
const CRYPTO_COLORS = ['var(--primary)', 'var(--success)', 'var(--info, #5b9cf6)', 'var(--warning)', 'var(--destructive)']
const STAT_LABEL: Record<string, string> = {
  revenue: 'CA', revenue_sales: 'Ventes', revenue_invoices: 'Factures', revenue_actions: 'Actions', invoices_paid: 'Factures payées',
  duty_seconds: 'Service', workers: 'Employés', hires: 'Embauches', open_days: 'Jours ouverts', goal_reached: 'Objectif', payroll_done: 'Paie faite',
}

const corr = (r: number | null) => (r === null ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(2)}`)
const strength = (r: number | null) => (r === null ? 'pas assez de données' : Math.abs(r) >= 0.6 ? 'lien fort' : Math.abs(r) >= 0.3 ? 'lien moyen' : 'lien faible')
const minutes = (m: number | null) => (m === null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`)

function Grid({ grid, unit }: { grid: number[][]; unit: string }) {
  const max = Math.max(1, ...grid.flat())
  return (
    <div className='overflow-x-auto p-3'>
      <table className='w-full min-w-[640px] table-fixed border-separate border-spacing-0.5 text-xs'>
        <thead><tr><th className='w-10' />{Array.from({ length: 24 }, (_, h) => <th key={h} className='font-normal text-muted-foreground'>{h % 3 === 0 ? `${h}h` : ''}</th>)}</tr></thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <th className='pe-2 text-end font-normal text-muted-foreground'>{WEEK[d]}</th>
              {row.map((v, h) => <td key={h} title={`${WEEK[d]} ${h}h : ${v} ${unit}`} className='h-6 rounded-[3px]' style={{ background: v ? `color-mix(in oklab, var(--primary) ${Math.round(15 + (v / max) * 85)}%, transparent)` : 'var(--muted)' }} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function InsightsTab({ onOpen }: { onOpen: (userId: number) => void }) {
  const { data: r, error } = useQuery({ queryKey: ['fivem-insights'], queryFn: () => api<Insights>('/fivem-data/insights'), retry: false, staleTime: 120_000 })
  if (error) return <Notice tone='warning' title='Statistiques indisponibles'>{errorMessage(error)}</Notice>
  if (!r) return <Skeleton className='h-96 w-full' />
  const a = r.attendance
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-8'>
      <Attendance a={a} />
      <DiscordCross d={r.discord} onOpen={onOpen} />
      <StaffAndJustice r={r} onOpen={onOpen} />
      <Jobs r={r} />
      {r.economy && <Economy e={r.economy} onOpen={onOpen} />}
      <PhoneStats r={r} />
    </div>
  )
}

function Heading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className='-mb-4'>
      <h2 className='font-display text-xl font-semibold'>{children}</h2>
      {hint && <p className='text-sm text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function Attendance({ a }: { a: Insights['attendance'] }) {
  const maxBack = 4
  return (
    <>
      <Heading hint='Qui vient, quand, combien de temps, et qui revient.'>Fréquentation</Heading>
      <StatCards items={[
        { label: 'Joueurs aujourd’hui · 7 j · 30 j', value: `${a.dau} · ${a.wau} · ${a.mau}`, icon: Users, tone: 'accent' },
        { label: 'Fidélité (joueurs du jour / du mois)', value: `${a.stickiness} %`, icon: TrendingUp, tone: 'success' },
        { label: 'Session médiane', value: `${a.medianSession} min`, icon: Timer, tone: 'info' },
        { label: 'Heures par joueur (30 j)', value: `${a.hoursPerPlayer} h`, icon: Clock, tone: 'warning' },
      ]} />
      <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3'>
        <Chart title='Joueurs connectés en même temps, par heure (30 j)' className='lg:col-span-2'>
          <ComposedChart data={a.byHour} margin={{ left: -16, right: 8, top: 4 }}>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='hour' tickFormatter={(h: number) => `${h}h`} {...axis} />
            <YAxis {...axis} allowDecimals={false} />
            <Tooltip {...tooltip} labelFormatter={(h: unknown) => `${h}h`} cursor={{ fill: 'var(--accent)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey='avg' name='En moyenne' fill='var(--primary)' radius={[4, 4, 0, 0]} />
            <Line type='monotone' dataKey='max' name='Au plus' stroke='var(--success)' strokeWidth={2} dot={false} />
          </ComposedChart>
        </Chart>
        <Chart title='Durée des sessions (30 j)'>
          <BarChart data={a.sessionLengths} layout='vertical' margin={{ left: 24, right: 8 }}>
            <XAxis type='number' {...axis} allowDecimals={false} />
            <YAxis type='category' dataKey='label' {...axis} width={80} />
            <Tooltip {...tooltip} labelFormatter={(l: unknown) => String(l)} cursor={{ fill: 'var(--accent)' }} />
            <Bar dataKey='count' name='Sessions' fill='var(--info, #5b9cf6)' radius={[0, 4, 4, 0]} />
          </BarChart>
        </Chart>
      </div>
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'>
        <Section title='Rétention par semaine d’arrivée' description='Part des nouveaux joueurs d’une semaine revenus 1, 2, 3 et 4 semaines plus tard.'>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[30rem] text-sm'>
              <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Arrivés la semaine du</th><th className='px-2 text-end font-medium'>Nouveaux</th>{Array.from({ length: maxBack }, (_, i) => <th key={i} className='px-2 text-center font-medium'>S+{i + 1}</th>)}</tr></thead>
              <tbody className='divide-y'>
                {a.cohorts.map((c) => (
                  <tr key={c.week}>
                    <td className='px-4 py-1.5'>{new Date(c.week).toLocaleDateString('fr-FR')}</td>
                    <td className='px-2 text-end tabular-nums'>{c.players}</td>
                    {Array.from({ length: maxBack }, (_, i) => {
                      const v = c.back[i]
                      return <td key={i} className='px-1 py-1'><div className='rounded px-1 py-0.5 text-center text-xs tabular-nums' style={{ background: v ? `color-mix(in oklab, var(--success) ${Math.round(10 + v * 0.7)}%, transparent)` : undefined }}>{v === undefined ? '' : v === null ? '—' : `${v} %`}</div></td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title='Dernière venue' description='Les joueurs vus ces 120 derniers jours.'>
          <Bars rows={[
            { key: 'a', label: 'Venus cette semaine', value: a.churn.active7 },
            { key: 'b', label: 'Absents depuis 1 à 2 semaines', value: a.churn.away7 },
            { key: 'c', label: 'Absents depuis 2 à 4 semaines', value: a.churn.away14 },
            { key: 'd', label: 'Absents depuis plus d’un mois', value: a.churn.away30 },
          ]} tone='bg-warning/20' />
        </Section>
      </div>
    </>
  )
}

function DiscordCross({ d, onOpen }: { d: Insights['discord']; onOpen: (userId: number) => void }) {
  return (
    <>
      <Heading hint='Le temps de jeu de chaque compte lié, face à son activité Discord enregistrée par le bot (30 jours).'>Jeu et Discord croisés</Heading>
      <StatCards items={[
        { label: 'Comptes FiveM liés à Discord', value: `${d.linked} / ${d.accounts}`, icon: Link2, tone: 'info' },
        { label: 'Membres du serveur principal ayant un compte FiveM', value: d.members === null ? '—' : `${d.membersLinked} / ${count(d.members)}`, icon: Users, tone: 'accent' },
        { label: 'Temps de jeu ↔ vocal Discord', value: corr(d.correlation.voice), icon: HeadphonesIcon, tone: 'success', hint: strength(d.correlation.voice) },
        { label: 'Temps de jeu ↔ messages Discord', value: corr(d.correlation.messages), icon: Activity, tone: 'warning', hint: strength(d.correlation.messages) },
      ]} />
      <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3'>
        <Chart title='Chaque jour : en jeu, actifs sur Discord, et les deux' className='lg:col-span-2'>
          <AreaChart data={d.days} margin={{ left: -16, right: 8, top: 4 }}>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
            <YAxis {...axis} allowDecimals={false} />
            <Tooltip {...tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type='monotone' dataKey='discord' name='Actifs Discord' stroke='var(--info, #5b9cf6)' fill='var(--info, #5b9cf6)' fillOpacity={0.15} strokeWidth={2} />
            <Area type='monotone' dataKey='game' name='En jeu' stroke='var(--primary)' fill='var(--primary)' fillOpacity={0.2} strokeWidth={2} />
            <Line type='monotone' dataKey='both' name='Les deux' stroke='var(--success)' strokeWidth={2} dot={false} />
          </AreaChart>
        </Chart>
        <Section title='Profils des joueurs liés'>
          <Bars rows={d.profiles.map((p) => ({ key: p.kind, label: PROFILE[p.kind].label, value: p.count }))} tone='bg-accent' />
        </Section>
      </div>
      <Section title='Joueur par joueur' description='Heures de jeu, messages et heures de vocal Discord sur 30 jours.'>
        {!d.crossed.length ? <EmptyState title='Aucun compte lié' icon={Link2} /> : (
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[40rem] text-sm'>
              <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Joueur</th><th className='px-2 text-end font-medium'>En jeu</th><th className='px-2 text-end font-medium'>Messages</th><th className='px-2 text-end font-medium'>Vocal</th><th className='px-4 text-start font-medium'>Profil</th></tr></thead>
              <tbody className='divide-y'>
                {d.crossed.map((c) => (
                  <tr key={c.userId} className='cursor-pointer hover:bg-accent/40' onClick={() => onOpen(c.userId)}>
                    <td className='px-4 py-1.5'><div className='flex items-center gap-2'><UserAvatar src={c.discord?.avatar} name={c.discord?.name ?? c.username} className='size-6' /><span className='font-medium'>{c.username}</span>{c.discord?.name && <span className='text-xs text-muted-foreground'>@{c.discord.name}</span>}</div></td>
                    <td className='px-2 text-end tabular-nums'>{c.gameHours} h</td>
                    <td className='px-2 text-end tabular-nums'>{count(c.messages)}</td>
                    <td className='px-2 text-end tabular-nums'>{c.voiceHours} h</td>
                    <td className='px-4'><Pill tone={PROFILE[c.kind].tone}>{PROFILE[c.kind].label}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  )
}

function StaffAndJustice({ r, onOpen }: { r: Insights; onOpen: (userId: number) => void }) {
  const s = r.staff
  return (
    <>
      <Heading hint='La présence du staff en service quand des joueurs sont en ligne, et la délinquance rapportée au temps de jeu.'>Staff et justice</Heading>
      <StatCards items={[
        { label: 'Temps couvert par au moins un staff', value: s.coverage === null ? '—' : `${s.coverage} %`, icon: ShieldCheck, tone: s.coverage !== null && s.coverage < 70 ? 'danger' : 'success', hint: `${s.uncoveredHours} h de jeu sans staff (30 j)` },
        { label: 'Signalement pris en charge en', value: minutes(s.reports.claimMedian), icon: Timer, tone: 'info', hint: `médiane · ${s.reports.unclaimed} jamais pris` },
        { label: 'Signalement réglé en', value: minutes(s.reports.resolveMedian), icon: Clock, tone: 'accent', hint: 'médiane' },
        { label: 'Sanctions pour 100 h de jeu', value: r.justice.per100h, icon: Scale, tone: 'warning' },
      ]} />
      <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
        <Chart title='Couverture staff par heure (quand des joueurs sont en ligne)'>
          <BarChart data={s.byHour} margin={{ left: -16, right: 8, top: 4 }}>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='hour' tickFormatter={(h: number) => `${h}h`} {...axis} />
            <YAxis {...axis} domain={[0, 100]} unit=' %' />
            <Tooltip {...tooltip} labelFormatter={(h: unknown) => `${h}h`} formatter={(v: unknown) => `${v} %`} cursor={{ fill: 'var(--accent)' }} />
            <Bar dataKey='coverage' name='Couvert' fill='var(--success)' radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
        <Section title='Récidivistes' description='Joueurs avec au moins deux sanctions en jeu (warn, kick, prison, ban).'>
          {!r.justice.repeat.length ? <EmptyState title='Aucun récidiviste' icon={Gavel} /> : (
            <ul className='divide-y'>
              {r.justice.repeat.map((o) => (
                <li key={`${o.userId}-${o.name}`}>
                  <button type='button' disabled={!o.userId} onClick={() => o.userId && onOpen(o.userId)} className='flex w-full flex-wrap items-center gap-2 px-4 py-2 text-start text-sm enabled:hover:bg-accent/40'>
                    <span className='flex-1 font-medium'>{o.name}</span>
                    {Object.entries(o.types).map(([t, n]) => <Pill key={t} tone={t === 'ban' ? 'danger' : t === 'jail' ? 'info' : 'warning'}>{n} {t}</Pill>)}
                    <span className='w-8 text-end font-display text-lg font-semibold tabular-nums'>{o.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title='Quand tombent les sanctions' description='Toutes les sanctions en jeu, par jour et heure.'>
        <Grid grid={r.justice.grid} unit='sanctions' />
      </Section>
    </>
  )
}

function Jobs({ r }: { r: Insights }) {
  const keys = [...new Set(r.jobs.weekly.flatMap((w) => Object.keys(w.stats)))].filter((k) => STAT_LABEL[k])
  const cell = (k: string, v: number | boolean | undefined) => {
    if (v === undefined) return '—'
    if (typeof v === 'boolean') return v ? '✓' : '✗'
    if (k === 'duty_seconds') return `${Math.round(v / 3600)} h`
    if (k.startsWith('revenue')) return money(v)
    return count(v)
  }
  return (
    <>
      <Heading hint='Les bilans hebdomadaires des métiers, les prises de service et le parc de véhicules.'>Métiers et véhicules</Heading>
      <StatCards items={[
        { label: 'Personnages sans emploi', value: r.jobs.jobless, icon: Users, tone: 'neutral' },
        { label: 'Métier et gang à la fois', value: r.jobs.multi, icon: Gavel, tone: 'danger' },
        { label: 'Véhicules par joueur', value: r.vehicles.perPlayer, icon: TrendingUp, tone: 'info', hint: `essence moyenne ${r.vehicles.avgFuel} % · moteur ${r.vehicles.avgEngine} %` },
        { label: 'Véhicules de service', value: r.vehicles.jobFleet.reduce((n, j) => n + j.count, 0), icon: ShieldCheck, tone: 'accent' },
      ]} />
      {r.jobs.weekly.length > 0 && (
        <Section title='Bilans hebdomadaires des métiers'>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[48rem] text-sm'>
              <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Métier</th><th className='px-2 text-start font-medium'>Semaine</th>{keys.map((k) => <th key={k} className='px-2 text-end font-medium'>{STAT_LABEL[k]}</th>)}<th className='px-4 text-end font-medium'>XP · niveau</th></tr></thead>
              <tbody className='divide-y'>
                {r.jobs.weekly.map((w, i) => (
                  <tr key={i}>
                    <td className='px-4 py-1.5 font-medium'>{w.job}</td>
                    <td className='px-2 text-muted-foreground'>{w.week}</td>
                    {keys.map((k) => <td key={k} className={cn('px-2 text-end tabular-nums', w.stats[k] === false && 'text-muted-foreground')}>{cell(k, w.stats[k])}</td>)}
                    <td className='px-4 text-end tabular-nums'>+{count(w.xp)} · niv. {w.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
        <Section title='Prises de service par jour et heure'><Grid grid={r.jobs.checkinGrid} unit='prises de service' /></Section>
        <div className='grid content-start gap-6'>
          <Section title='Véhicules possédés par joueur'><Bars rows={r.vehicles.distribution.map((v) => ({ key: v.label, label: v.label, value: v.count }))} tone='bg-info/20' /></Section>
          <Section title='Flotte des services'><Bars rows={r.vehicles.jobFleet.map((j) => ({ key: j.job, label: j.job, value: j.count }))} /></Section>
        </div>
      </div>
    </>
  )
}

function Economy({ e, onOpen }: { e: NonNullable<Insights['economy']>; onOpen: (userId: number) => void }) {
  return (
    <>
      <Heading hint='La répartition de l’argent (liquide + banque) entre les personnages, et ce qu’elle dit de l’économie.'>Économie croisée</Heading>
      <StatCards items={[
        { label: 'Inégalité (Gini, 0 = égal, 1 = un seul a tout)', value: e.gini, icon: Scale, tone: e.gini > 0.8 ? 'danger' : 'warning' },
        { label: 'Part des 10 % les plus riches', value: `${e.top10Share} %`, icon: Coins, tone: 'accent' },
        { label: 'Fortune médiane', value: money(e.percentiles.p50), icon: Users, tone: 'info', hint: `10 % ont moins de ${money(e.percentiles.p10)}` },
        { label: '10 % les plus riches au-dessus de', value: money(e.percentiles.p90), icon: TrendingUp, tone: 'success', hint: `1 % au-dessus de ${money(e.percentiles.p99)}` },
      ]} />
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3'>
        <Section title='Répartition des fortunes'><Bars rows={e.distribution.map((d) => ({ key: d.label, label: d.label, value: d.count }))} tone='bg-success/20' /></Section>
        <Section title='Fortune moyenne par métier'><Bars rows={e.byJob.map((j) => ({ key: j.job, label: <>{j.job} <span className='text-xs text-muted-foreground'>({j.count})</span></>, value: j.avg }))} format={money} tone='bg-warning/20' /></Section>
        <Section title='Argent par heure de jeu' description='Fortune du compte divisée par son temps de jeu total : utile pour repérer une fortune trop rapide.'>
          <ul className='divide-y'>
            {e.perHour.map((p) => (
              <li key={p.userId}><button type='button' onClick={() => onOpen(p.userId)} className='flex w-full items-center gap-2 px-4 py-2 text-start text-sm hover:bg-accent/40'><span className='flex-1 truncate'>{p.username}</span><span className='text-xs text-muted-foreground'>{p.hours} h</span><span className='w-28 text-end font-medium tabular-nums'>{money(p.perHour)}/h</span></button></li>
            ))}
          </ul>
        </Section>
      </div>
      {e.crypto.points.length > 1 && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3'>
          <Chart title='Cours des cryptos les plus chères (moyenne par heure)' className='lg:col-span-2'>
            <LineChart data={e.crypto.points} margin={{ left: 8, right: 8, top: 4 }}>
              <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
              <XAxis dataKey='at' tickFormatter={(v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)} ${v.slice(11, 13)}h`} {...axis} minTickGap={40} />
              <YAxis {...axis} scale='log' domain={['auto', 'auto']} tickFormatter={(v: number) => (v >= 1e6 ? `${Math.round(v / 1e6)} M` : v >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v))} />
              <Tooltip {...tooltip} labelFormatter={(v: unknown) => String(v)} formatter={(v: unknown) => `${Number(v).toLocaleString('fr-FR')} $`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {e.crypto.assets.map((id, i) => <Line key={id} type='monotone' dataKey={id} name={id} stroke={CRYPTO_COLORS[i]} strokeWidth={2} dot={false} connectNulls />)}
            </LineChart>
          </Chart>
          <Section title='Détenteurs par crypto'><Bars rows={e.crypto.holders.map((h) => ({ key: h.asset, label: <span className='capitalize'>{h.asset}</span>, value: h.holders }))} tone='bg-accent' /></Section>
        </div>
      )}
    </>
  )
}

function PhoneStats({ r }: { r: Insights }) {
  const p = r.phone
  if (!p.calls && !p.health.length) return null
  return (
    <>
      <Heading hint='Les téléphones en jeu : appels et application santé (podomètre).'>Téléphone</Heading>
      <StatCards items={[
        { label: 'Appels (60 j)', value: p.calls, icon: Phone, tone: 'info' },
        { label: 'Appels décrochés', value: p.answered === null ? '—' : `${p.answered} %`, icon: Phone, tone: 'success' },
        { label: 'Durée médiane d’un appel', value: `${p.avgSeconds} s`, icon: Timer, tone: 'accent' },
        { label: 'Pas comptés (30 j)', value: count(p.health.reduce((n, h) => n + h.steps, 0)), icon: Activity, tone: 'warning', hint: `${Math.round(p.health.reduce((n, h) => n + h.km, 0))} km parcourus à pied` },
      ]} />
      {p.health.length > 1 && (
        <Chart title='Pas par jour (application santé)'>
          <BarChart data={p.health} margin={{ left: -4, right: 8, top: 4 }}>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
            <YAxis {...axis} />
            <Tooltip {...tooltip} formatter={(v: unknown) => count(Number(v))} cursor={{ fill: 'var(--accent)' }} />
            <Bar dataKey='steps' name='Pas' fill='var(--warning)' radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      )}
    </>
  )
}

