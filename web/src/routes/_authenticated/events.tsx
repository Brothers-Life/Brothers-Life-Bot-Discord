import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChevronRight, Search } from 'lucide-react'
import { api } from '@/lib/api'
import type { Guild, NetworkEvent } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { UserPicker } from '@/components/app/user-picker'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { SeeAlso } from '@/components/app/confirm'
import { HISTORY_SEE_ALSO, others } from '@/features/navigation/see-also'
import { RetentionSetting } from '@/features/events/retention-setting'
import { useMe } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const Route = createFileRoute('/_authenticated/events')({
  component: EventsPage,
})

const PAGE = 50
const CATEGORY_LABELS: Record<string, string> = {
  messages: 'Messages',
  members: 'Membres',
  member_roles: 'Rôles des membres',
  roles: 'Rôles',
  channels: 'Salons',
  voice: 'Vocal',
  invites: 'Invitations',
  server: 'Serveur',
}
const DANGER_TYPES = new Set(['message_delete', 'message_bulk_delete', 'role_delete', 'channel_delete', 'emoji_delete'])

function useDebounced<T>(value: T, ms = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

function Details({ event }: { event: NetworkEvent }) {
  const d = event.details ?? {}
  if (event.type === 'message_edit') {
    return (
      <div className='grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2'>
        <div><div className='mb-1 text-muted-foreground'>Avant</div><p className='whitespace-pre-wrap'>{(d.before as string) ?? 'contenu inconnu'}</p></div>
        <div><div className='mb-1 text-muted-foreground'>Après</div><p className='whitespace-pre-wrap'>{d.after as string}</p></div>
      </div>
    )
  }
  if (event.type === 'message_delete') {
    return <p className='whitespace-pre-wrap'>{(d.content as string) ?? 'Contenu inconnu : le message était trop ancien pour être en mémoire.'}</p>
  }
  return <pre className='font-mono text-[11px] whitespace-pre-wrap'>{JSON.stringify(d, null, 2)}</pre>
}

function EventsPage() {
  const [guildId, setGuildId] = useState('all')
  const [category, setCategory] = useState('all')
  const [userId, setUserId] = useState('')
  const [text, setText] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const { can } = useMe()
  const q = useDebounced(text.trim())
  const userFilter = /^\d{17,20}$/.test(userId.trim()) ? userId.trim() : ''

  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const settings = useQuery({ queryKey: ['events-settings'], queryFn: () => api<{ retentionDays: number }>('/events/settings') })

  const query = useInfiniteQuery({
    queryKey: ['events', guildId, category, userFilter, q],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (guildId !== 'all') params.set('guildId', guildId)
      if (category !== 'all') params.set('category', category)
      if (userFilter) params.set('userId', userFilter)
      if (q) params.set('q', q)
      if (pageParam) params.set('before', String(pageParam))
      return api<NetworkEvent[]>(`/events?${params}`)
    },
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)?.id : undefined),
    refetchInterval: 20_000,
  })
  const events = query.data?.pages.flat() ?? []

  return (
    <Page
      title='Historique Discord'
      description={`Tout ce qui se passe sur les serveurs du réseau : messages modifiés ou supprimés, arrivées, rôles, salons, vocal, invitations. Conservé ${settings.data?.retentionDays ?? 30} jours.`}
    >
      <SeeAlso links={others(HISTORY_SEE_ALSO, '/events')}>Ici : ce que font les membres sur Discord, enregistré par le bot.</SeeAlso>
      {can('logs.manage') && <RetentionSetting />}
      <div className='flex flex-wrap gap-2'>
        <div className='relative min-w-56 flex-1'>
          <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Rechercher un mot, un pseudo, un salon…' aria-label='Rechercher' className='ps-8' />
        </div>
        <Select value={guildId} onValueChange={setGuildId}>
          <SelectTrigger className='w-48' aria-label='Serveur'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Tous les serveurs</SelectItem>
            {guilds.data?.filter((g) => g.status === 'active').map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className='w-48' aria-label='Catégorie'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Toutes les catégories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <UserPicker value={userFilter} onChange={setUserId} placeholder='Filtrer par membre' className='w-64' />
      </div>

      <Section title={`${events.length}${query.hasNextPage ? '+' : ''} événement${events.length > 1 ? 's' : ''}`}>
        {!events.length && !query.isLoading ? (
          <EmptyState title='Aucun événement'>Change les filtres, ou attends que les serveurs du réseau soient actifs.</EmptyState>
        ) : (
          <ul className='divide-y'>
            {events.map((event) => {
              const expanded = open === event.id
              return (
                <li key={event.id}>
                  <button
                    type='button'
                    onClick={() => setOpen(expanded ? null : event.id)}
                    aria-expanded={expanded}
                    className='flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none'
                  >
                    <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Pill tone={DANGER_TYPES.has(event.type) ? 'danger' : 'neutral'}>{CATEGORY_LABELS[event.category] ?? event.category}</Pill>
                        <span className='text-sm'>{event.summary}</span>
                      </div>
                      <div className='truncate text-xs text-muted-foreground'>
                        {event.guildName}
                        {event.actor?.name && <> · par {event.actor.name}</>}
                      </div>
                    </div>
                    <time className='shrink-0 text-xs text-muted-foreground' title={dateTime(event.at)}>{ago(event.at)}</time>
                  </button>
                  {expanded && (
                    <div className='bg-muted/40 px-11 py-3 text-sm'>
                      <Details event={event} />
                      <div className='mt-2 text-xs text-muted-foreground'>
                        {dateTime(event.at)}
                        {event.userId && <> · membre {event.user?.name ?? ''} ({event.userId})</>}
                        {event.channelId && <> · salon {event.channelId}</>}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {query.hasNextPage && (
          <div className='border-t p-3 text-center'>
            <Button variant='outline' size='sm' onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>Voir plus ancien</Button>
          </div>
        )}
      </Section>
    </Page>
  )
}
