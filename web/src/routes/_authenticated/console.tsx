import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Pause, Play, Power, RotateCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ConsoleLine } from '@/lib/types'
import { time } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Dot } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/_authenticated/console')({
  component: ConsolePage,
})

const MAX_LINES = 5000
const LEVELS = [
  { key: 'info', label: 'Info', className: 'text-sky-300' },
  { key: 'success', label: 'Succès', className: 'text-emerald-300' },
  { key: 'warn', label: 'Alertes', className: 'text-amber-300' },
  { key: 'error', label: 'Erreurs', className: 'text-rose-400' },
  { key: 'debug', label: 'Debug', className: 'text-violet-300' },
  { key: 'raw', label: 'Autres', className: 'text-console-foreground/70' },
] as const
const LEVEL_CLASS: Record<string, string> = Object.fromEntries(LEVELS.map((l) => [l.key, l.className]))

type Status = 'connecting' | 'live' | 'closed'

function useConsoleStream() {
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const connect = () => {
      setStatus('connecting')
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/api/console`)
      socket.onopen = () => setStatus('live')
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'history') setLines(message.lines.slice(-MAX_LINES))
        if (message.type === 'line') setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), message.line])
      }
      socket.onclose = (event) => {
        setStatus('closed')
        // 4003: permission removed or session expired, don't insist
        if (!stopped && event.code !== 4003) retry = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      socket?.close()
    }
  }, [])

  return { lines, status }
}

function ConsolePage() {
  const { can } = useMe()
  const control = can('console.control')
  const { lines, status } = useConsoleStream()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<ConsoleLine[] | null>(null)
  const [confirm, setConfirm] = useState<'restart' | 'stop' | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const source = paused && frozen ? frozen : lines
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return source.filter((l) => !hidden.has(l.level) && (!needle || l.text.toLowerCase().includes(needle)))
  }, [source, hidden, search])

  useEffect(() => {
    if (!paused && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [visible, paused])

  const togglePause = () => {
    setFrozen(paused ? null : lines)
    setPaused(!paused)
  }

  const action = useMutation({
    mutationFn: (kind: 'restart' | 'stop') => api<{ supervised: boolean }>(`/system/${kind}`, { method: 'POST', body: { confirm: true } }),
    onSuccess: (res, kind) => {
      setConfirm(null)
      if (kind === 'restart') toast.success(res.supervised ? 'Redémarrage en cours, la console se reconnecte seule' : 'Le bot s’arrête (lancé sans lanceur : relance-le à la main)')
      else toast.success('Le bot s’arrête. Relance-le depuis Pterodactyl.')
    },
  })

  return (
    <Page title='Console' fixed>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='me-2 flex items-center gap-2 text-sm'>
          <Dot tone={status === 'live' ? 'success' : status === 'connecting' ? 'warning' : 'danger'} />
          {status === 'live' ? 'En direct' : status === 'connecting' ? 'Connexion…' : 'Déconnectée'}
        </span>
        <div className='flex flex-wrap gap-1' role='group' aria-label='Niveaux affichés'>
          {LEVELS.map((level) => {
            const on = !hidden.has(level.key)
            return (
              <Button
                key={level.key}
                size='sm'
                variant={on ? 'secondary' : 'ghost'}
                aria-pressed={on}
                className={cn('h-7 px-2 text-xs', !on && 'text-muted-foreground line-through')}
                onClick={() => setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(level.key)) next.delete(level.key)
                  else next.add(level.key)
                  return next
                })}
              >
                {level.label}
              </Button>
            )
          })}
        </div>
        <div className='relative ms-auto'>
          <Search className='pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Rechercher' aria-label='Rechercher dans la console' className='h-8 w-48 ps-8' />
        </div>
        <Button size='sm' variant='outline' onClick={togglePause}>
          {paused ? <Play /> : <Pause />}
          {paused ? 'Reprendre' : 'Pause'}
        </Button>
        {control && (
          <>
            <Button size='sm' variant='outline' onClick={() => setConfirm('restart')}><RotateCw /> Redémarrer</Button>
            <Button size='sm' variant='danger-outline' onClick={() => setConfirm('stop')}><Power /> Arrêter</Button>
          </>
        )}
      </div>

      <div
        ref={scroller}
        role='log'
        aria-live='off'
        aria-label='Sortie du bot'
        className='min-h-0 flex-1 overflow-auto rounded-lg border border-sidebar-border bg-console p-3 font-mono text-[12.5px] leading-relaxed text-console-foreground'
      >
        {!visible.length && <div className='text-console-foreground/50'>{lines.length ? 'Aucune ligne ne correspond aux filtres.' : 'En attente des premières lignes…'}</div>}
        {visible.map((line) => (
          <div key={line.id} className='row-enter flex gap-3 whitespace-pre-wrap break-all hover:bg-white/5'>
            <span className='shrink-0 text-console-foreground/40 select-none'>{time(line.at)}</span>
            <span className={cn(LEVEL_CLASS[line.level] ?? LEVEL_CLASS.raw, line.stream === 'launcher' && 'italic')}>{line.text}</span>
          </div>
        ))}
      </div>
      <p className='text-xs text-muted-foreground'>
        {visible.length} ligne{visible.length > 1 ? 's' : ''} affichée{visible.length > 1 ? 's' : ''} sur {source.length}. Console en lecture seule : aucune commande ne peut être tapée ici.
      </p>

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'restart' ? 'Redémarrer le bot ?' : 'Arrêter le bot ?'}
        desc={confirm === 'restart'
          ? 'Le bot et le panel seront indisponibles quelques secondes.'
          : 'Le bot et ce panel s’arrêtent complètement. Il faudra le relancer depuis Pterodactyl.'}
        confirmText={confirm === 'restart' ? 'Redémarrer' : 'Arrêter le bot'}
        destructive={confirm === 'stop'}
        isLoading={action.isPending}
        handleConfirm={() => confirm && action.mutate(confirm)}
      />
    </Page>
  )
}
