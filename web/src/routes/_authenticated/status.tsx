import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Bot, Database, Gamepad2, HardDrive, Image, ListChecks, Megaphone, Music, Radio, RefreshCw, Server, ShoppingCart, Swords, Zap, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Notice, Page, Pill } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { bytes, fmt, rel } from '@/features/telemetry/format'
import { QueryError } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/status')({
  component: StatusPage,
})

type State = 'ok' | 'warn' | 'down' | 'off'
type Item = { label: string; state: State; value?: string | null; at?: number | null }
type Service = { key: string; label: string; state: State; detail: string; metrics: Record<string, number | string | boolean | null | undefined>; items?: Item[] }
type Status = { at: number; state: State; services: Service[] }

const STATES: Record<State, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; dot: string; border: string }> = {
  ok: { label: 'En service', tone: 'success', dot: 'bg-success', border: 'border-success/30' },
  warn: { label: 'À surveiller', tone: 'warning', dot: 'bg-warning', border: 'border-warning/50' },
  down: { label: 'En panne', tone: 'danger', dot: 'bg-destructive', border: 'border-destructive/60' },
  off: { label: 'Non configuré', tone: 'neutral', dot: 'bg-muted-foreground/50', border: 'border-border' },
}
const ICONS: Record<string, LucideIcon> = { api: Server, bot: Bot, database: Database, cache: Zap, telemetry: Gamepad2, mirror: HardDrive, tebex: ShoppingCart, media: Image, game: Swords, bridge: Megaphone, music: Music, streams: Radio, tasks: ListChecks }

// "3 j 4 h", "2 h 10 min", "45 s"
function span(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d) return `${d} j ${h} h`
  if (h) return `${h} h ${m % 60} min`
  return m ? `${m} min` : `${s} s`
}

// The figures of a card, in plain words; unknown or empty ones are left out
function facts(s: Service, now: number): [string, string][] {
  const m = s.metrics
  const n = (key: string) => (typeof m[key] === 'number' ? (m[key] as number) : null)
  const out: [string, string | null][] = [
    ['Version', typeof m.version === 'string' && m.version ? m.version : null],
    ['Commit en ligne', typeof m.commit === 'string' && m.commit ? m.commit : null],
    ['Serveurs suivis', n('servers') ? fmt(n('servers')) : null],
    ['Chaînes et flux suivis', n('followed') ? fmt(n('followed')) : null],
    ['Tâches', n('tasks') ? fmt(n('tasks')) : null],
    ['Échecs depuis 24 h', n('failed') ? fmt(n('failed')) : null],
    ['Adresse', typeof m.target === 'string' && m.target ? m.target : null],
    ['Démarré depuis', n('startedAt') ? span(now - n('startedAt')!) : null],
    ['Temps de réponse', n('latency') !== null ? `${fmt(n('latency'))} ms` : null],
    ['Latence Discord', n('ping') !== null && n('ping')! >= 0 ? `${fmt(n('ping'))} ms` : null],
    ['Serveurs Discord', n('guilds') ? fmt(n('guilds')) : null],
    ['Mémoire', n('memory') ? bytes(n('memory')) : null],
    ['Taille', n('size') ? bytes(n('size')) : null],
    ['Connexions ouvertes', n('connections') ? fmt(n('connections')) : null],
    ['Joueurs en jeu', n('players') !== null ? `${fmt(n('players'))}${n('maxPlayers') ? ` / ${fmt(n('maxPlayers'))}` : ''}` : null],
    ['Serveur de jeu démarré depuis', n('serverUptime') ? span(n('serverUptime')! * 1000) : null],
    ['Tables copiées', n('tables') ? `${fmt(n('tables'))}${n('counted') ? ` (+ ${fmt(n('counted'))} comptées)` : ''}` : null],
    ['Dernier relevé', n('lastReading') ? rel(n('lastReading')) : null],
    ['Dernier signe de vie', n('last') ? rel(n('last')) : null],
  ]
  return out.filter((f): f is [string, string] => f[1] !== null)
}

function Card({ s, now }: { s: Service; now: number }) {
  const state = STATES[s.state]
  const Icon = ICONS[s.key] ?? Server
  const list = facts(s, now)
  return (
    <section className={cn('grid content-start gap-3 rounded-lg border bg-card p-4', state.border)}>
      <header className='flex items-start gap-3'>
        <span className='grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground' aria-hidden><Icon className='size-5' /></span>
        <div className='min-w-0 flex-1'>
          <h2 className='truncate font-medium'>{s.label}</h2>
          <Pill tone={state.tone} className='mt-1'>
            <span className={cn('size-1.5 rounded-full', state.dot, s.state === 'ok' && 'animate-pulse')} aria-hidden />
            {state.label}
          </Pill>
        </div>
      </header>
      <p className='text-sm text-muted-foreground'>{s.detail}</p>
      {s.items && s.items.length > 0 && (
        <ul className='grid gap-1.5 border-t pt-3 text-sm'>
          {s.items.map((item) => (
            <li key={item.label} className='flex items-center gap-2'>
              <span className={cn('size-1.5 shrink-0 rounded-full', STATES[item.state].dot)} aria-label={STATES[item.state].label} />
              <span className='min-w-0 flex-1 truncate' title={item.label}>{item.label}</span>
              <span className={cn('max-w-[55%] truncate text-end text-muted-foreground', item.state === 'down' && 'text-destructive')} title={item.value ?? undefined}>
                {item.value ?? (item.at ? rel(item.at) : '')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-t pt-3 text-sm'>
          {list.map(([label, value]) => (
            <div key={label} className='contents'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd className='truncate text-end tabular-nums' title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function StatusPage() {
  const q = useQuery({ queryKey: ['status'], queryFn: () => api<Status>('/status'), refetchInterval: 15_000 })
  const d = q.data
  const broken = d?.services.filter((s) => s.state === 'down') ?? []
  const watched = d?.services.filter((s) => s.state === 'warn') ?? []

  return (
    <Page
      title='État des services'
      description='Ce qui fait tourner le réseau, vérifié toutes les 15 secondes : le panel, le bot et ses tâches, la base, le cache, les serveurs de jeu, la musique, les streams et le service d’images.'
      actions={
        <Button variant='outline' size='sm' onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} aria-hidden /> Vérifier maintenant
        </Button>
      }
    >
      {q.isError && <QueryError error={q.error} />}
      {q.isPending && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className='h-44' />)}
        </div>
      )}
      {d && (
        <>
          {broken.length > 0 && (
            <Notice tone='danger' title={broken.length === 1 ? `${broken[0].label} est en panne` : `${broken.length} services sont en panne`}>
              {broken.map((s) => s.label).join(', ')}. Le détail est dans chaque carte.
            </Notice>
          )}
          {broken.length === 0 && watched.length > 0 && (
            <Notice tone='warning' title='À surveiller'>{watched.map((s) => s.label).join(', ')}.</Notice>
          )}
          {broken.length === 0 && watched.length === 0 && <Notice tone='success' title='Tout fonctionne'>Aucun service en panne.</Notice>}
          <div className='grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {d.services.map((s) => <Card key={s.key} s={s} now={d.at} />)}
          </div>
          <p className='text-xs text-muted-foreground'>
            Vérifié {rel(d.at)}. « Non configuré » n’est pas une panne : le service n’est simplement pas utilisé.
          </p>
        </>
      )}
    </Page>
  )
}
