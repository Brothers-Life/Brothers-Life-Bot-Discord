import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Guild, Ticket } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, UserAvatar } from '@/components/app/ui'
import { TicketConfigPanel } from '@/features/tickets/ticket-config'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/tickets')({
  component: TicketsPage,
})

const PAGE = 50

function TicketsPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id

  return (
    <Page title='Tickets' description='Les membres ouvrent un ticket avec un bouton dans Discord ; un salon privé est créé avec le staff concerné. À la fermeture, la conversation est enregistrée ici.'>
      <Tabs defaultValue='list'>
        <div className='flex flex-wrap items-center gap-3'>
          <TabsList>
            <TabsTrigger value='list'>Tickets</TabsTrigger>
            <TabsTrigger value='config'>Configuration</TabsTrigger>
          </TabsList>
          {current && (
            <Select value={current} onValueChange={setGuildId}>
              <SelectTrigger className='w-56' aria-label='Serveur'><SelectValue /></SelectTrigger>
              <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <TabsContent value='list' className='mt-4'>{current && <TicketList guildId={current} />}</TabsContent>
        <TabsContent value='config' className='mt-4'>{current && <TicketConfigPanel key={current} guildId={current} />}</TabsContent>
      </Tabs>
    </Page>
  )
}

function TicketList({ guildId }: { guildId: string }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open')
  const [viewing, setViewing] = useState<number | null>(null)
  const [closing, setClosing] = useState<Ticket | null>(null)
  const [reason, setReason] = useState('')

  const query = useInfiniteQuery({
    queryKey: ['tickets', guildId, status],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ guildId, limit: String(PAGE) })
      if (status !== 'all') params.set('status', status)
      if (pageParam) params.set('before', String(pageParam))
      return api<Ticket[]>(`/tickets?${params}`)
    },
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)?.id : undefined),
    refetchInterval: 20_000,
  })
  const tickets = query.data?.pages.flat() ?? []

  const close = useMutation({
    mutationFn: (t: Ticket) => api(`/tickets/${t.id}/close`, { method: 'POST', body: { confirm: true, reason } }),
    onSuccess: () => {
      toast.success('Ticket fermé')
      setClosing(null)
      setReason('')
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })

  return (
    <Section
      title={`${tickets.length}${query.hasNextPage ? '+' : ''} ticket${tickets.length > 1 ? 's' : ''}`}
      actions={
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className='w-36' aria-label='Statut'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='open'>Ouverts</SelectItem>
            <SelectItem value='closed'>Fermés</SelectItem>
            <SelectItem value='all'>Tous</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      {!tickets.length ? <EmptyState title={status === 'open' ? 'Aucun ticket ouvert' : 'Aucun ticket'}>Publie le panneau d’ouverture depuis l’onglet Configuration.</EmptyState> : (
        <ul className='divide-y'>
          {tickets.map((t) => (
            <li key={t.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
              <UserAvatar src={t.opener?.avatar} name={t.opener?.name ?? t.openerName ?? '?'} />
              <div className='min-w-56 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>#{t.number} · {t.subject ?? 'Sans sujet'}</span>
                  <Pill tone={t.status === 'open' ? 'success' : 'neutral'}>{t.status === 'open' ? 'Ouvert' : 'Fermé'}</Pill>
                </div>
                <div className='text-xs text-muted-foreground'>
                  {t.opener?.name ?? t.openerName} · ouvert {ago(t.createdAt)}
                  {t.claimer && <> · pris par {t.claimer.name}</>}
                  {t.closedAt && <> · fermé le {dateTime(t.closedAt)}{t.closeReason ? ` (${t.closeReason})` : ''}</>}
                </div>
              </div>
              <div className='flex gap-2'>
                {t.hasTranscript && <Button size='sm' variant='outline' onClick={() => setViewing(t.id)}>Transcript</Button>}
                {t.status === 'open' && can('tickets.handle') && <Button size='sm' variant='outline' className='text-destructive' onClick={() => setClosing(t)}>Fermer</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <div className='border-t p-3 text-center'>
          <Button variant='outline' size='sm' onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>Voir plus ancien</Button>
        </div>
      )}
      {viewing !== null && <TranscriptDialog id={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={Boolean(closing)}
        onOpenChange={(o) => !o && setClosing(null)}
        title={`Fermer le ticket #${closing?.number} ?`}
        desc='La conversation est enregistrée et envoyée à la personne, puis le salon est supprimé.'
        confirmText='Fermer le ticket'
        destructive
        isLoading={close.isPending}
        handleConfirm={() => closing && close.mutate(closing)}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Raison (facultatif)' maxLength={200} rows={2} />
      </ConfirmDialog>
    </Section>
  )
}

function TranscriptDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['ticket', id], queryFn: () => api<Ticket>(`/tickets/${id}`) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90svh] sm:max-w-3xl'>
        <DialogHeader><DialogTitle>Ticket #{data?.number ?? ''}</DialogTitle></DialogHeader>
        <pre className='max-h-[70svh] overflow-auto rounded-md bg-console p-3 font-mono text-xs whitespace-pre-wrap text-console-foreground'>{data?.transcript ?? 'Chargement…'}</pre>
      </DialogContent>
    </Dialog>
  )
}
