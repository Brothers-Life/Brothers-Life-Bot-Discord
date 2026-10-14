import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, Bell, LogIn, MessageSquare, Pause, Play, Skull, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { EmptyState, Notice, Page, Section } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { clean, clock, fmt, n0, num, rel } from '@/features/telemetry/format'
import { Mono, PlayerLink, StreamPill } from '@/features/telemetry/ui'
import { useTelemetryStream, type StreamStatus, type Tick } from '@/features/telemetry/use-stream'

export const Route = createFileRoute('/_authenticated/telemetry/live')({
  component: TelemetryLive,
})

type FeedItem = { id: string; ts: string; icon: LucideIcon; tone: string; body: React.ReactNode }
const FEED_MAX = 80

function itemsOf(t: Tick, withLogs: boolean): FeedItem[] {
  const out: FeedItem[] = []
  for (const s of t.sessions) out.push({ id: `s${s.id}`, ts: s.ts, icon: LogIn, tone: 'bg-success/15 text-success', body: <><PlayerLink cid={s.citizenid} name={s.player_name} /> s’est connecté</> })
  for (const m of t.deaths) out.push({ id: `d${m.id}`, ts: m.ts, icon: Skull, tone: 'bg-destructive/15 text-destructive', body: <><PlayerLink cid={m.citizenid} name={m.player_name} /> est mort · {m.cause || '?'}{m.killer_name && <> par <b>{m.killer_name}</b></>}</> })
  if (withLogs) {
    for (const c of t.chat) out.push({ id: `c${c.id}`, ts: c.ts, icon: MessageSquare, tone: 'bg-info/15 text-info', body: <><PlayerLink cid={c.citizenid} name={c.player_name} /> : <span className='break-words'>{clean(c.message).slice(0, 200)}</span></> })
    for (const l of t.logs.filter((x) => x.level === 'error')) out.push({ id: `l${l.id}`, ts: l.ts, icon: AlertTriangle, tone: 'bg-destructive/15 text-destructive', body: <><Mono>{l.channel ?? '?'}</Mono> <span className='font-mono text-xs break-all'>{clean(l.line).slice(0, 200)}</span></> })
  }
  for (const a of t.alerts) out.push({ id: `a${a.id}`, ts: a.ts, icon: Bell, tone: 'bg-primary/15 text-primary', body: <b>{a.title}</b> })
  return out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
}

function TelemetryLive() {
  const { can } = useMe()
  const withLogs = can('telemetry.logs')
  const [paused, setPaused] = useState(false)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [status, setStatus] = useState<StreamStatus>({})
  const [, setNow] = useState(0)
  // Relative times refreshed every 30 s
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const state = useTelemetryStream((tick) => {
    if (tick.status && tick.status.online != null) setStatus(tick.status)
    for (const a of tick.alerts) {
      const notify = a.severity === 'critical' ? toast.error : a.severity === 'ok' ? toast.success : toast.warning
      notify(a.title, { description: clean(a.detail ?? '').slice(0, 200) || undefined })
    }
    if (paused) return
    const fresh = itemsOf(tick, withLogs)
    if (fresh.length) setFeed((prev) => [...fresh.reverse(), ...prev].slice(0, FEED_MAX))
  })

  const online = num(status.online)
  const up = status.up == null ? null : n0(status.up) === 1
  return (
    <Page
      title='Télémétrie · Direct'
      description='Connexions, morts, chat, erreurs de la console et alertes, au moment où le serveur les envoie (toutes les 3 s).'
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          <StreamPill state={state} />
          <Button variant='outline' size='sm' onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? <><Play /> Reprendre</> : <><Pause /> Mettre en pause</>}</Button>
        </div>
      }
    >
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
        <div className='flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3'>
          <span className={cn('size-2.5 rounded-full', up === null ? 'bg-muted-foreground' : up ? 'live-dot bg-success' : 'bg-destructive')} aria-hidden />
          <span className='font-medium'>{up === null ? 'En attente du premier relevé…' : up ? 'Serveur en ligne' : 'Serveur injoignable'}</span>
          <span className='text-sm text-muted-foreground'>{online === null ? '' : `${fmt(online)}${status.max ? ` / ${fmt(status.max)}` : ''} joueurs`}</span>
        </div>
        {!withLogs && <Notice tone='info'>Le chat et la console ne s’affichent pas ici : ton rang n’a pas la permission « Télémétrie FiveM : console, chat, journaux du jeu ».</Notice>}
        {state === 'off' && <Notice tone='warning' title='Flux indisponible'>Le panel n’arrive pas à recevoir le direct. Nouvel essai dans une minute.</Notice>}
        <Section title='Fil en direct' description={paused ? 'En pause : les nouveaux événements ne s’ajoutent plus (les alertes s’affichent toujours).' : `${feed.length} derniers événements`} actions={feed.length > 0 && <Button variant='ghost' size='sm' onClick={() => setFeed([])}>Vider</Button>}>
          {!feed.length ? <EmptyState title='En attente d’activité' icon={LogIn}>Les événements apparaissent ici dès que le serveur en envoie.</EmptyState> : (
            <ul className='divide-y'>
              {feed.map((it) => (
                <li key={it.id} className='flex animate-in items-start gap-3 px-4 py-2.5 text-sm fade-in-0 slide-in-from-top-1'>
                  <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', it.tone)} aria-hidden><it.icon className='size-3.5' /></span>
                  <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5'>{it.body}</div>
                  <time className='shrink-0 text-xs text-muted-foreground tabular-nums' title={clock(it.ts)}>{rel(it.ts)}</time>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Page>
  )
}
