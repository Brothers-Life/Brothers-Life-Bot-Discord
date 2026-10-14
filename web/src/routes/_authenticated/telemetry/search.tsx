import { useDeferredValue, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { EmptyState, Page, Pill, Section, UserAvatar } from '@/components/app/ui'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { clean, dt } from '@/features/telemetry/format'
import { sourceLabel, summarize } from '@/features/telemetry/labels'
import type { SearchView } from '@/features/telemetry/types'
import { Highlight, LevelPill, PlayerLink, QueryError, Segmented, TableSection } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({ q: typeof search.q === 'string' ? search.q.slice(0, 100) : undefined }),
  component: TelemetrySearch,
})

const RANGES = [{ value: 1, label: '24 h' }, { value: 7, label: '7 j' }, { value: 30, label: '30 j' }]

function TelemetrySearch() {
  const { can } = useMe()
  const initial = Route.useSearch().q ?? ''
  const [text, setText] = useState(initial)
  const [days, setDays] = useState(7)
  const term = useDeferredValue(text.trim())
  const ready = term.length >= 2
  const q = useQuery({
    queryKey: ['telemetry', 'search', term, days],
    queryFn: () => api<SearchView>(`/telemetry/search?q=${encodeURIComponent(term)}&days=${days}`),
    enabled: ready,
    placeholderData: (prev) => prev,
  })
  const d = ready ? q.data : undefined
  const withLogs = can('telemetry.logs')
  return (
    <Page title='Télémétrie · Recherche' description='Cherche un nom, un citizenid, une plaque, un mot : dans les joueurs, les journaux du jeu, le chat et la console.'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative w-full sm:w-96'>
          <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Au moins 2 caractères…' aria-label='Chercher' className='ps-8' autoFocus maxLength={100} />
        </div>
        <Segmented label='Période' value={days} options={RANGES} onChange={setDays} />
      </div>
      {!ready ? <EmptyState title='Que cherches-tu ?' icon={Search}>Tape au moins 2 caractères.</EmptyState>
        : q.error ? <QueryError error={q.error} />
          : !d ? <Skeleton className='h-80 w-full' /> : (
            <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6 transition-opacity', q.isPlaceholderData && 'opacity-70')}>
              <Section title={`Joueurs (${d.players.length})`}>
                {!d.players.length ? <EmptyState title='Aucun joueur.' /> : (
                  <ul className='grid grid-cols-[minmax(0,1fr)] gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3'>
                    {d.players.map((p) => (
                      <li key={p.citizenid}>
                        <Link to='/telemetry/players/$cid' params={{ cid: p.citizenid }} className='flex items-center gap-3 rounded-md border p-3 hover:border-primary/50 hover:bg-accent/30'>
                          <UserAvatar name={p.name || p.citizenid} />
                          <div className='min-w-0'>
                            <div className='truncate font-medium'><Highlight text={p.name || p.citizenid} term={term} /></div>
                            <div className='truncate text-xs text-muted-foreground'><Highlight text={p.citizenid} term={term} /> · {p.job || 'sans métier'}{p.online ? ' · en ligne' : ''}</div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <TableSection
                title={`Journaux du jeu (${d.events.length})`} exportName='recherche-journaux' rows={d.events} minWidth='44rem' maxHeight='32rem' empty='Rien dans les journaux.'
                columns={[
                  { key: 'ts', label: 'Heure', render: (e) => <span className='whitespace-nowrap text-muted-foreground'>{dt(e.ts)}</span>, csv: (e) => dt(e.ts) },
                  { key: 'src', label: 'Source', render: (e) => <Pill>{sourceLabel(e.type, e.subtype)}</Pill>, csv: (e) => sourceLabel(e.type, e.subtype) },
                  { key: 'who', label: 'Joueur', render: (e) => (e.citizenid || e.player_name ? <PlayerLink cid={e.citizenid} name={e.player_name} /> : '–'), csv: (e) => e.player_name ?? e.citizenid },
                  { key: 'data', label: 'Détails', render: (e) => <span className='text-xs break-words'><Highlight text={summarize(e.data, 6)} term={term} /></span>, csv: (e) => summarize(e.data, 20) },
                ]}
              />
              {withLogs && (
                <>
                  <TableSection
                    title={`Chat (${d.chat.length})`} exportName='recherche-chat' rows={d.chat} minWidth='36rem' maxHeight='28rem' empty='Rien dans le chat.'
                    columns={[
                      { key: 'ts', label: 'Heure', render: (c) => <span className='whitespace-nowrap text-muted-foreground'>{dt(c.ts)}</span>, csv: (c) => dt(c.ts) },
                      { key: 'who', label: 'Joueur', render: (c) => <PlayerLink cid={c.citizenid} name={c.player_name} />, csv: (c) => c.player_name ?? c.citizenid },
                      { key: 'type', label: 'Type', render: (c) => <Pill tone={c.subtype === 'command' ? 'accent' : 'neutral'}>{c.subtype === 'command' ? 'commande' : 'chat'}</Pill>, csv: (c) => c.subtype },
                      { key: 'msg', label: 'Message', render: (c) => <span className='break-words'><Highlight text={clean(c.message)} term={term} /></span>, csv: (c) => clean(c.message) },
                    ]}
                  />
                  <TableSection
                    title={`Console (${d.logs.length})`} exportName='recherche-console' rows={d.logs} minWidth='40rem' maxHeight='28rem' empty='Rien dans la console.'
                    columns={[
                      { key: 'ts', label: 'Heure', render: (l) => <span className='whitespace-nowrap text-muted-foreground'>{dt(l.ts)}</span>, csv: (l) => dt(l.ts) },
                      { key: 'channel', label: 'Canal', render: (l) => l.channel ?? '?', csv: (l) => l.channel },
                      { key: 'level', label: 'Niveau', render: (l) => <LevelPill level={l.level} />, csv: (l) => l.level },
                      { key: 'line', label: 'Message', render: (l) => <span className='font-mono text-xs break-all'><Highlight text={clean(l.line)} term={term} /></span>, csv: (l) => clean(l.line) },
                    ]}
                  />
                </>
              )}
            </div>
          )}
    </Page>
  )
}
