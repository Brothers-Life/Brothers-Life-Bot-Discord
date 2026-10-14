import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, Bell, Crosshair, Database, Flame, LogIn, LogOut, MessageSquare, ShieldAlert, ShoppingCart, Skull, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clean, clock, fmt, money, num } from './format'
import { dayLabel, explosionLabel, sourceLabel, summarize } from './labels'
import { Mono, PlayerLink, Screenshot } from './ui'

export type JournalEntry = { ts: string; kind: string; data: Record<string, unknown> | null }

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

function Row({ icon: Icon, tone, time, children, sub }: { icon: LucideIcon; tone: string; time: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <li className='flex items-start gap-3 px-4 py-2.5'>
      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', tone)} aria-hidden><Icon className='size-3.5' /></span>
      <div className='min-w-0 flex-1 text-sm'>
        <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5'>{children}</div>
        {sub && <div className='mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs break-words text-muted-foreground'>{sub}</div>}
      </div>
      <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>{time}</span>
    </li>
  )
}

export function MapLink({ x, y, children = 'voir sur la carte' }: { x: unknown; y: unknown; children?: React.ReactNode }) {
  const nx = num(x as number)
  const ny = num(y as number)
  if (nx === null || ny === null) return null
  return <Link to='/telemetry/deathmap' search={{ at: `${Math.round(nx)},${Math.round(ny)}` }} className='text-primary hover:underline'>{children}</Link>
}

// One line of a player's journal (timeline view, money trace)
export function JournalItem({ it, cid }: { it: JournalEntry; cid: string }) {
  const d = it.data ?? {}
  const time = clock(it.ts)
  switch (it.kind) {
    case 'session_start':
      return <Row icon={LogIn} tone='bg-success/15 text-success' time={time}><b>Connexion</b></Row>
    case 'session_end':
      return <Row icon={LogOut} tone='bg-muted text-muted-foreground' time={time} sub={str(d.reason) || undefined}><b>Déconnexion</b>{d.minutes != null && <span>après {fmt(d.minutes as number)} min</span>}</Row>
    case 'death':
      return (
        <Row
          icon={Skull} tone='bg-destructive/15 text-destructive' time={time}
          sub={<>
            {d.weapon ? <Mono>{str(d.weapon)}</Mono> : null}
            <MapLink x={d.x} y={d.y} />
            {d.screenshot_url ? <Screenshot url={str(d.screenshot_url)} caption={`${str(d.cause)} · ${time}`}>capture</Screenshot> : null}
          </>}
        >
          <b>Mort</b> · {str(d.cause) || '?'}{d.killer ? <> par <PlayerLink cid={str(d.killer_cid) || null} name={str(d.killer)} /></> : null}
        </Row>
      )
    case 'kill':
      return <Row icon={Crosshair} tone='bg-destructive/15 text-destructive' time={time} sub={d.weapon ? <Mono>{str(d.weapon)}</Mono> : undefined}><b>A tué</b> <PlayerLink cid={str(d.victim_cid) || null} name={str(d.victim)} /></Row>
    case 'purchase':
      return <Row icon={ShoppingCart} tone='bg-primary/15 text-primary' time={time} sub={`${str(d.shop)} · ${money(d.total as number)}`}><b>Achat</b> · {str(d.article) || '?'} ×{str(d.qty) || 1}</Row>
    case 'bank_flow': {
      const out = d.from_cid === cid
      return (
        <Row
          icon={ArrowLeftRight} tone={out ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'} time={time}
          sub={<>{out ? <>vers <PlayerLink cid={str(d.to_cid) || null} /></> : <>de <PlayerLink cid={str(d.from_cid) || null} /></>}{d.note ? <span>· {str(d.note)}</span> : null}</>}
        >
          <b className={out ? 'text-destructive' : 'text-success'}>{out ? '−' : '+'}{money(d.amount as number)}</b> · {str(d.kind) || 'flux'}
        </Row>
      )
    }
    case 'chat':
    case 'command':
      return <Row icon={MessageSquare} tone='bg-info/15 text-info' time={time}><b>{it.kind === 'command' ? 'Commande' : 'Chat'}</b> · <span className='break-words'>{clean(d.message)}</span></Row>
    case 'alert':
      return <Row icon={Bell} tone='bg-primary/15 text-primary' time={time}><b>Alerte</b> · {str(d.title)}</Row>
    case 'anticheat':
      return <Row icon={ShieldAlert} tone='bg-destructive/15 text-destructive' time={time} sub={summarize(d.details) || undefined}><b>Anticheat</b> · {str(d.reason)}</Row>
    case 'explosion':
      return <Row icon={Flame} tone='bg-warning/15 text-warning' time={time}><b>Explosion</b> · {explosionLabel(d.explosion_type)}</Row>
    default:
      return <Row icon={Database} tone='bg-info/15 text-info' time={time} sub={summarize(d) || undefined}><b>{sourceLabel(null, it.kind)}</b></Row>
  }
}


// Entries grouped under a heading per day
export function JournalList({ items, cid }: { items: JournalEntry[]; cid: string }) {
  let last = ''
  const out: React.ReactNode[] = []
  items.forEach((it, i) => {
    const day = new Date(it.ts).toDateString()
    if (day !== last) {
      out.push(<li key={`d-${i}`} className='bg-muted/40 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase first-letter:uppercase'>{dayLabel(it.ts)}</li>)
      last = day
    }
    out.push(<JournalItem key={i} it={it} cid={cid} />)
  })
  return <ul className='divide-y'>{out}</ul>
}
