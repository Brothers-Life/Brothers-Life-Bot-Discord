import { useDeferredValue, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { EmptyState, Pill, Section } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { count } from './format'
import type { GameLog, LogSource } from './types'

// Every log of the game in one feed, filterable by source and text
export function GameLogs() {
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const q = useDeferredValue(text.trim())
  const sources = useQuery({ queryKey: ['fivem-log-sources'], queryFn: () => api<LogSource[]>('/fivem-data/log-sources'), staleTime: 60_000 })
  const label = (key: string) => sources.data?.find((s) => s.key === key)?.label ?? key
  const logs = useInfiniteQuery({
    queryKey: ['fivem-game-logs', source, q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<GameLog[]>(`/fivem-data/logs?source=${source}&q=${encodeURIComponent(q)}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === 100 ? last.at(-1)?.at ?? undefined : undefined),
  })
  const rows = logs.data?.pages.flat() ?? []
  const used = (sources.data ?? []).filter((s) => s.total > 0).sort((a, b) => b.recent - a.recent || b.total - a.total)

  return (
    <Section
      title='Tous les logs du jeu'
      description='Menu admin, garages, métiers, gangs, coffres, MDT, zones, portes, éditeur de carte… réunis dans un seul fil.'
      actions={<Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Qui, quoi, sur quoi…' aria-label='Filtrer les logs' className='w-60' />}
    >
      <div className='flex flex-wrap gap-1.5 border-b px-4 py-3'>
        <SourceChip active={!source} onClick={() => setSource('')}>Tout</SourceChip>
        {used.map((s) => (
          <SourceChip key={s.key} active={source === s.key} onClick={() => setSource(source === s.key ? '' : s.key)}>
            {s.label} <span className='opacity-70'>{count(s.total)}</span>{s.recent > 0 && <span className='ms-1 rounded bg-primary/20 px-1 text-[10px] text-primary' title='sur 30 jours'>+{s.recent}</span>}
          </SourceChip>
        ))}
      </div>
      {!rows.length ? <EmptyState title={logs.isLoading ? 'Chargement…' : 'Aucune entrée'} icon={ScrollText} /> : (
        <ul className={cn('divide-y transition-opacity', logs.isFetching && !logs.isFetchingNextPage && 'opacity-60')}>
          {rows.map((r, i) => (
            <li key={`${r.source}-${r.at}-${i}`} className='flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm'>
              <span className='w-32 shrink-0 text-xs text-muted-foreground tabular-nums'>{dateTime(r.at)}</span>
              {!source && <Pill tone='info'>{label(r.source)}</Pill>}
              {r.actor && <span className='font-medium'>{r.actor}</span>}
              {r.action && <Pill tone='neutral'>{r.action}</Pill>}
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

function SourceChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type='button' onClick={onClick} aria-pressed={active}
      className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}>
      {children}
    </button>
  )
}
