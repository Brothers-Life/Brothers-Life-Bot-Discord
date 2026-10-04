import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { api } from '@/lib/api'
import type { Guild, Ticket, TicketConfig, TicketPriority } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { Page, Section, EmptyState, Pill, UserAvatar, GuildIcon } from '@/components/app/ui'
import { TicketConfigPanel } from '@/features/tickets/ticket-config'
import { TicketStatsPanel } from '@/features/tickets/ticket-stats'
import { PRIORITY_LABELS, PRIORITY_TONES } from '@/features/tickets/defaults'
import { useTicketLive } from '@/features/tickets/use-ticket-live'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/_authenticated/tickets')({
  component: TicketsPage,
})

const PAGE = 50
const ALL = '__all__'

function TicketsPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id
  const currentGuild = active.find((g) => g.id === current)

  return (
    <Page
      title='Tickets'
      description='Les membres ouvrent un ticket depuis un panneau Discord. Tu suis les conversations en direct ici et tu peux y répondre.'
      actions={current && (
        <div className='flex items-center gap-2'>
          <Label htmlFor='ticket-guild' className='text-muted-foreground'>Serveur</Label>
          <Select value={current} onValueChange={setGuildId}>
            <SelectTrigger id='ticket-guild' className='w-60'>
              <span className='flex items-center gap-2 truncate'>
                {currentGuild && <GuildIcon src={currentGuild.icon} name={currentGuild.name} className='size-5' />}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      <Tabs defaultValue='list'>
        <TabsList>
          <TabsTrigger value='list'>Tickets</TabsTrigger>
          <TabsTrigger value='stats'>Statistiques</TabsTrigger>
          <TabsTrigger value='config'>Configuration</TabsTrigger>
        </TabsList>
        <TabsContent value='list' className='mt-4'>{current && <TicketList key={current} guildId={current} />}</TabsContent>
        <TabsContent value='stats' className='mt-4'>{current && <TicketStats key={current} guildId={current} />}</TabsContent>
        <TabsContent value='config' className='mt-4'>{current && <TicketConfigPanel key={current} guildId={current} />}</TabsContent>
      </Tabs>
    </Page>
  )
}

function TicketStats({ guildId }: { guildId: string }) {
  const config = useQuery({ queryKey: ['ticket-config', guildId], queryFn: () => api<TicketConfig>(`/tickets/config/${guildId}`) })
  return <TicketStatsPanel guildId={guildId} config={config.data} />
}

function TicketList({ guildId }: { guildId: string }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open')
  const [statusKey, setStatusKey] = useState(ALL)
  const [categoryId, setCategoryId] = useState(ALL)
  const [priority, setPriority] = useState(ALL)
  // Tickets with new messages since the page was opened
  const [unread, setUnread] = useState<Record<number, number>>({})
  const config = useQuery({ queryKey: ['ticket-config', guildId], queryFn: () => api<TicketConfig>(`/tickets/config/${guildId}`) })

  const live = useTicketLive((event) => {
    if (event.type === 'ticket' && event.ticket.guildId === guildId) qc.invalidateQueries({ queryKey: ['tickets', guildId] })
    if (event.type === 'message' && event.guildId === guildId && !event.message.panelUser) {
      setUnread((u) => ({ ...u, [event.message.ticketId]: (u[event.message.ticketId] ?? 0) + 1 }))
    }
  })

  const query = useInfiniteQuery({
    queryKey: ['tickets', guildId, status, statusKey, categoryId, priority],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ guildId, limit: String(PAGE) })
      if (status !== 'all') params.set('status', status)
      if (statusKey !== ALL) params.set('statusKey', statusKey)
      if (categoryId !== ALL) params.set('categoryId', categoryId)
      if (priority !== ALL) params.set('priority', priority)
      if (pageParam) params.set('before', String(pageParam))
      return api<Ticket[]>(`/tickets?${params}`)
    },
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)?.id : undefined),
    refetchInterval: live ? false : 20_000,
  })
  const tickets = query.data?.pages.flat() ?? []
  const statuses = config.data?.statuses ?? []

  return (
    <Section
      title={`${tickets.length}${query.hasNextPage ? '+' : ''} ticket${tickets.length > 1 ? 's' : ''}`}
      description={live ? undefined : 'Connexion au direct…'}
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          {live && <Pill tone='accent'><span className='live-dot !size-1.5' aria-hidden /> En direct</Pill>}
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className='w-32' aria-label='Ouverts ou fermés'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='open'>Ouverts</SelectItem>
              <SelectItem value='closed'>Fermés</SelectItem>
              <SelectItem value='all'>Tous</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusKey} onValueChange={setStatusKey}>
            <SelectTrigger className='w-44' aria-label='Statut'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous les statuts</SelectItem>
              {statuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.emoji} {s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className='w-40' aria-label='Type'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous les types</SelectItem>
              {config.data?.categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.emoji} {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className='w-40' aria-label='Priorité'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toutes priorités</SelectItem>
              {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {!tickets.length ? <EmptyState title={status === 'open' ? 'Aucun ticket ouvert' : 'Aucun ticket'}>Publie un panneau depuis l’onglet Configuration.</EmptyState> : (
        <ul className='divide-y'>
          {tickets.map((t) => {
            const s = statuses.find((x) => x.key === t.statusKey)
            const count = unread[t.id] ?? 0
            return (
              <li key={t.id} className='animate-in fade-in-0'>
                <Link
                  to='/ticket/$id'
                  params={{ id: String(t.id) }}
                  onClick={() => setUnread((u) => ({ ...u, [t.id]: 0 }))}
                  className='flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40'
                >
                  <span aria-hidden className='h-10 w-1 shrink-0 rounded-full' style={{ background: s?.color ?? 'var(--border)' }} />
                  <UserAvatar src={t.opener?.avatar} name={t.opener?.name ?? t.openerName ?? '?'} />
                  <div className='min-w-56 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>#{t.number} · {t.subject ?? 'Sans sujet'}</span>
                      <Pill style={{ color: s?.color }}>{s?.emoji} {s?.label ?? t.statusKey}</Pill>
                      {t.priority !== 'normal' && <Pill tone={PRIORITY_TONES[t.priority]}>{PRIORITY_LABELS[t.priority]}</Pill>}
                      {t.archived && <Pill>Archivé</Pill>}
                      {count > 0 && <Pill tone='accent'><MessageSquare className='size-3' /> {count} nouveau{count > 1 ? 'x' : ''}</Pill>}
                    </div>
                    <div className='text-xs text-muted-foreground'>
                      {t.categoryEmoji} {t.categoryName ?? 'Type supprimé'} · {t.opener?.name ?? t.openerName} · ouvert {ago(t.createdAt)}
                      {t.claimer && <> · pris par {t.claimer.name}</>}
                      {t.closedAt && <> · fermé le {dateTime(t.closedAt)}{t.closeReason ? ` (${t.closeReason})` : ''}</>}
                      {t.rating && <> · {'★'.repeat(t.rating)}</>}
                    </div>
                  </div>
                </Link>
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
  )
}
