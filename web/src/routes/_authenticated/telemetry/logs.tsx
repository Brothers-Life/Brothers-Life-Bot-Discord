import { useDeferredValue, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { Page, Pill } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartCard, TimeChart, type Serie } from '@/features/telemetry/charts'
import { clean, dt, msOf, num } from '@/features/telemetry/format'
import type { LogsView } from '@/features/telemetry/types'
import { ConsoleLine, LevelPill, PlayerLink, QueryError, Segmented, StreamPill, TableSection, type Column } from '@/features/telemetry/ui'
import { useTelemetryStream } from '@/features/telemetry/use-stream'

export const Route = createFileRoute('/_authenticated/telemetry/logs')({
  component: TelemetryLogs,
})

const LEVELS = [{ value: '', label: 'Tout' }, { value: 'info', label: 'Info' }, { value: 'warn', label: 'Avertissements' }, { value: 'error', label: 'Erreurs' }]
const LEVEL_COLOR: Record<string, string> = { info: 'var(--info)', warn: 'var(--warning)', error: 'var(--destructive)' }

// live: when the line came through the live feed (dropped once a full load is newer)
type LogRow = LogsView['logs'][number] & { live?: number }
type ChatRow = LogsView['chat'][number] & { live?: number }

const logColumns: Column<LogRow>[] = [
  { key: 'ts', label: 'Heure', render: (l) => <span className='whitespace-nowrap text-muted-foreground'>{dt(l.ts)}</span>, csv: (l) => dt(l.ts) },
  { key: 'channel', label: 'Canal', render: (l) => <span className='whitespace-nowrap'>{l.channel ?? '?'}</span>, csv: (l) => l.channel },
  { key: 'level', label: 'Niveau', render: (l) => <LevelPill level={l.level} />, csv: (l) => l.level },
  { key: 'line', label: 'Message', render: (l) => <ConsoleLine line={l.line} />, csv: (l) => clean(l.line) },
]
const chatColumns: Column<ChatRow>[] = [
  { key: 'ts', label: 'Heure', render: (c) => <span className='whitespace-nowrap text-muted-foreground'>{dt(c.ts)}</span>, csv: (c) => dt(c.ts) },
  { key: 'who', label: 'Joueur', render: (c) => <PlayerLink cid={c.citizenid} name={c.player_name} />, csv: (c) => c.player_name ?? c.citizenid },
  { key: 'type', label: 'Type', render: (c) => <Pill tone={c.subtype === 'command' ? 'accent' : 'neutral'}>{c.subtype === 'command' ? 'commande' : 'chat'}</Pill>, csv: (c) => c.subtype },
  { key: 'message', label: 'Message', render: (c) => <span className='break-words'>{clean(c.message)}</span>, csv: (c) => clean(c.message) },
]

function TelemetryLogs() {
  const [text, setText] = useState('')
  const term = useDeferredValue(text.trim())
  const [level, setLevel] = useState('')
  const [live, setLive] = useState(true)
  const params = new URLSearchParams()
  if (term) params.set('q', term)
  if (level) params.set('level', level)
  const q = useQuery({ queryKey: ['telemetry', 'logs', params.toString()], queryFn: () => api<LogsView>(`/telemetry/logs?${params}`), refetchInterval: 60_000, placeholderData: (prev) => prev })

  // Lines received live, shown above the last full load (which the next refresh replaces)
  const [extraLogs, setExtraLogs] = useState<LogRow[]>([])
  const [extraChat, setExtraChat] = useState<ChatRow[]>([])
  const state = useTelemetryStream((tick) => {
    const lower = term.toLowerCase()
    const logs = tick.logs.filter((l) => (!level || l.level === level) && (!lower || String(l.line ?? '').toLowerCase().includes(lower))).reverse()
    if (logs.length) setExtraLogs((prev) => [...logs.map((l) => ({ ...l, live: Date.now() })), ...prev].slice(0, 400))
    const chat = [...tick.chat].reverse()
    if (chat.length) setExtraChat((prev) => [...chat.map((c) => ({ ...c, live: Date.now() })), ...prev].slice(0, 150))
  }, live)

  const d = q.data
  const volume = new Map<string, Serie>()
  for (const r of d?.volume ?? []) {
    const s = volume.get(r.level) ?? { key: r.level, label: r.level, color: LEVEL_COLOR[r.level], data: [] }
    s.data.push({ x: msOf(r.t), y: num(r.n) })
    volume.set(r.level, s)
  }
  const order = ['info', 'warn', 'error']
  const series = [...volume.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  const newer = (r: { live?: number }) => (r.live ?? 0) > q.dataUpdatedAt
  const logs: LogRow[] | undefined = d ? [...extraLogs.filter(newer), ...d.logs].slice(0, 400) : undefined
  const chat: ChatRow[] | undefined = d ? [...extraChat.filter(newer), ...d.chat].slice(0, 150) : undefined
  const fresh = (r: { live?: number }) => (r.live ? 'animate-in fade-in-0 bg-primary/5' : undefined)

  return (
    <Page
      title='Télémétrie · Logs'
      description='Console du serveur FiveM, chat et commandes des joueurs. Les nouvelles lignes arrivent en direct.'
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          {live && <StreamPill state={state} />}
          <Button variant='outline' size='sm' onClick={() => setLive(!live)} aria-pressed={live}>{live ? <><Pause /> Mettre en pause</> : <><Play /> Reprendre le direct</>}</Button>
        </div>
      }
    >
      {q.error ? <QueryError error={q.error} /> : !d ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <ChartCard title='Volume de logs (6 h)' height='h-40' empty={!series.length && 'Aucune ligne sur les 6 dernières heures'}><TimeChart series={series} kind='bar' stacked /></ChartCard>
          <div className='flex flex-wrap items-center gap-3'>
            <div className='relative w-full sm:w-80'>
              <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Chercher dans la console…' aria-label='Chercher dans la console' className='ps-8' />
            </div>
            <Segmented label='Niveau' value={level} options={LEVELS} onChange={setLevel} />
          </div>
          <TableSection title='Console du serveur' description={`${logs!.length} dernières lignes`} exportName='console' rows={logs} columns={logColumns} minWidth='44rem' maxHeight='40rem' empty='Aucune ligne ne correspond.' rowClassName={fresh} />
          <TableSection title='Chat et commandes' exportName='chat' rows={chat} columns={chatColumns} minWidth='36rem' maxHeight='32rem' empty='Rien pour le moment.' rowClassName={fresh} />
        </div>
      )}
    </Page>
  )
}
