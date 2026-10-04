import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, FileText, HelpCircle, Lock, MessageSquareText, NotebookPen, RotateCcw, Send, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { TicketDetail, TicketMessage, TicketPriority, TicketReply } from '@/lib/types'
import { ago, dateTime, duration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, Pill, UserAvatar } from '@/components/app/ui'
import { UserPicker } from '@/components/app/user-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PRIORITY_LABELS, PRIORITY_TONES } from '@/features/tickets/defaults'
import { useTicketLive } from '@/features/tickets/use-ticket-live'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/ticket/$id')({
  component: TicketPage,
})

function upsert(list: TicketMessage[], message: TicketMessage) {
  const i = list.findIndex((m) => m.id === message.id)
  if (i === -1) return [...list, message]
  const next = [...list]
  next[i] = { ...next[i], ...message }
  return next
}

function TicketPage() {
  const { id } = Route.useParams()
  const { can } = useMe()
  const handle = can('tickets.handle')
  const qc = useQueryClient()
  const key = ['ticket', Number(id)]
  const { data: ticket } = useQuery({ queryKey: key, queryFn: () => api<TicketDetail>(`/tickets/${id}`) })
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [transcript, setTranscript] = useState(false)
  // Saved reply picked for the text: the server fills its variables when sending
  const [replyId, setReplyId] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [askReason, setAskReason] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  const live = useTicketLive((event) => {
    if (event.type === 'ticket' && event.ticket.id === Number(id)) {
      qc.setQueryData<TicketDetail>(key, (old) => (old ? { ...old, ...event.ticket } : old))
    }
    if (event.type !== 'ticket' && event.message.ticketId === Number(id)) {
      qc.setQueryData<TicketDetail>(key, (old) => (old ? { ...old, messages: upsert(old.messages, event.message) } : old))
    }
  })

  const count = ticket?.messages.length ?? 0
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [count])

  const send = useMutation({
    mutationFn: () => api<TicketMessage>(`/tickets/${id}/reply`, { method: 'POST', body: { content: reply, internal, ...(replyId ? { replyId } : {}) } }),
    onSuccess: (message) => {
      setReply('')
      setReplyId(null)
      qc.setQueryData<TicketDetail>(key, (old) => (old ? { ...old, messages: upsert(old.messages, message) } : old))
    },
  })
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/tickets/${id}/${path}`, { method: 'POST', body }),
    onSuccess: (_, { path }) => {
      const labels: Record<string, string> = { claim: 'Ticket pris en charge', status: 'Statut changé', priority: 'Priorité changée', reopen: 'Ticket rouvert', close: 'Ticket fermé', members: 'Membre ajouté', 'close-request': 'Demande envoyée au membre' }
      toast.success(labels[path] ?? 'Fait')
      setClosing(false)
      setAsking(false)
      setAskReason('')
      setAdding(false)
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })

  if (!ticket) return <Page title='Ticket'><Skeleton className='h-[60svh] w-full' /></Page>
  const status = ticket.statuses.find((s) => s.key === ticket.statusKey)
  const open = ticket.status === 'open'
  const canWrite = handle && (open || ticket.archived)

  return (
    <Page
      title={`Ticket #${ticket.number}`}
      description={ticket.subject ?? undefined}
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          <Button asChild variant='ghost'><Link to='/tickets'><ArrowLeft /> Tickets</Link></Button>
          {live ? <Pill tone='accent'><span className='live-dot !size-1.5' aria-hidden /> En direct</Pill> : <Pill tone='warning'>Reconnexion…</Pill>}
          {ticket.htmlTranscript && <Button asChild><a href={`/api/tickets/${ticket.id}/transcript`} target='_blank' rel='noreferrer'><ExternalLink /> Transcript web</a></Button>}
          {ticket.hasTranscript && <Button variant='outline' onClick={() => setTranscript(true)}><FileText /> {ticket.htmlTranscript ? 'Texte' : 'Transcript'}</Button>}
        </div>
      }
    >
      <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]'>
        <Section title='Conversation' className='flex min-h-[60svh] flex-col'>
          <div className='flex max-h-[62svh] flex-1 flex-col gap-1 overflow-y-auto p-4' aria-live='polite'>
            {!ticket.messages.length && <p className='m-auto text-sm text-muted-foreground'>Pas encore de message enregistré.</p>}
            {ticket.messages.map((m) => <MessageRow key={m.id} message={m} />)}
            <div ref={bottom} />
          </div>
          {canWrite && (
            <form
              className={cn('border-t p-3 transition-colors', internal && 'bg-warning/8')}
              onSubmit={(e) => { e.preventDefault(); if (reply.trim()) send.mutate() }}
            >
              <Textarea
                value={reply}
                onChange={(e) => { setReply(e.target.value); if (!e.target.value.trim()) setReplyId(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && reply.trim()) send.mutate()
                }}
                maxLength={2000}
                rows={3}
                placeholder={internal ? 'Note interne : visible seulement dans le panel' : 'Répondre dans le ticket (Ctrl+Entrée pour envoyer)'}
                aria-label='Message'
              />
              <div className='mt-2 flex flex-wrap items-center gap-3'>
                <label className='flex items-center gap-2 text-sm'>
                  <Switch checked={internal} onCheckedChange={setInternal} />
                  <NotebookPen className='size-4' /> Note interne
                </label>
                <ReplyPicker ticketId={ticket.id} onPick={(r) => { setReply(r.content); setReplyId(r.id) }} />
                {replyId && <Pill tone='accent'>Variables remplies à l’envoi</Pill>}
                <span className='text-xs text-muted-foreground'>{reply.length}/2000</span>
                <Button loading={send.isPending} type='submit' className='ms-auto' variant={internal ? 'outline' : 'default'} disabled={!reply.trim() || send.isPending}>
                  <Send /> {internal ? 'Ajouter la note' : 'Envoyer'}
                </Button>
              </div>
            </form>
          )}
        </Section>

        <div className='grid content-start gap-4'>
          <Section title='Ticket'>
            <div className='grid gap-4 p-4 text-sm'>
              <div className='flex items-center gap-3'>
                <UserAvatar src={ticket.opener?.avatar} name={ticket.opener?.name ?? ticket.openerName ?? '?'} />
                <div>
                  <div className='font-medium'>{ticket.opener?.name ?? ticket.openerName}</div>
                  <div className='text-xs text-muted-foreground'>{ticket.categoryEmoji} {ticket.categoryName} · {ticket.guildName}</div>
                </div>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Pill style={{ color: status?.color }}>{status?.emoji} {status?.label ?? ticket.statusKey}</Pill>
                <Pill tone={PRIORITY_TONES[ticket.priority]}>Priorité {PRIORITY_LABELS[ticket.priority].toLowerCase()}</Pill>
                {ticket.archived && <Pill>Archivé</Pill>}
              </div>
              <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
                <dt className='text-muted-foreground'>Ouvert</dt><dd>{dateTime(ticket.createdAt)}</dd>
                <dt className='text-muted-foreground'>Pris par</dt><dd>{ticket.claimer?.name ?? '—'}</dd>
                {ticket.lastActivityAt && open && <><dt className='text-muted-foreground'>Activité</dt><dd>{ago(ticket.lastActivityAt)}</dd></>}
                <dt className='text-muted-foreground'>1re réponse</dt>
                <dd className='flex flex-wrap items-center gap-1.5'>
                  {ticket.firstResponseAt ? `après ${duration(ticket.firstResponseAt - ticket.createdAt)}` : 'pas encore'}
                  {(ticket.slaBreachedAt ?? 0) > 0 && <Pill tone='danger'>Délai dépassé</Pill>}
                  {!ticket.slaBreachedAt && ticket.slaMinutes ? <span className='text-muted-foreground'>(objectif {duration(ticket.slaMinutes * 60_000)})</span> : null}
                </dd>
                {ticket.closeRequest && open && (
                  <>
                    <dt className='text-muted-foreground'>Fermeture</dt>
                    <dd>
                      demandée {ago(ticket.closeRequest.at)}
                      {ticket.closeRequestHours ? ` · fermé seul le ${dateTime(ticket.closeRequest.at + ticket.closeRequestHours * 3_600_000)} sans réponse` : ''}
                    </dd>
                  </>
                )}
                {ticket.closedAt && <><dt className='text-muted-foreground'>Fermé</dt><dd>{dateTime(ticket.closedAt)}{ticket.closeReason ? ` · ${ticket.closeReason}` : ''}</dd></>}
                {ticket.rating && <><dt className='text-muted-foreground'>Note</dt><dd>{'★'.repeat(ticket.rating)}{'☆'.repeat(5 - ticket.rating)}{ticket.ratingComment ? ` · ${ticket.ratingComment}` : ''}</dd></>}
              </dl>

              {handle && open && (
                <div className='grid gap-3'>
                  <div className='grid gap-1.5'>
                    <Label>Statut</Label>
                    <Select value={ticket.statusKey} onValueChange={(v) => action.mutate({ path: 'status', body: { key: v } })}>
                      <SelectTrigger aria-label='Statut'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ticket.statuses.filter((s) => s.key !== 'closed').map((s) => <SelectItem key={s.key} value={s.key}>{s.emoji} {s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='grid gap-1.5'>
                    <Label>Priorité</Label>
                    <Select value={ticket.priority} onValueChange={(v) => action.mutate({ path: 'priority', body: { priority: v as TicketPriority } })}>
                      <SelectTrigger aria-label='Priorité'><SelectValue /></SelectTrigger>
                      <SelectContent>{ticket.priorities.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {!ticket.claimedBy && <Button size='sm' onClick={() => action.mutate({ path: 'claim' })}>Prendre en charge</Button>}
                    <Button size='sm' variant='outline' onClick={() => setAdding(true)}><UserPlus /> Ajouter</Button>
                    <Button size='sm' variant='outline' onClick={() => setAsking(true)}><HelpCircle /> Demander la fermeture</Button>
                    <Button size='sm' variant='danger-outline' onClick={() => setClosing(true)}><Lock /> Fermer</Button>
                  </div>
                </div>
              )}
              {handle && ticket.archived && (
                <Button size='sm' variant='outline' onClick={() => action.mutate({ path: 'reopen' })}><RotateCcw /> Rouvrir</Button>
              )}
            </div>
          </Section>

          {ticket.answers.length > 0 && (
            <Section title='Formulaire'>
              <dl className='grid gap-3 p-4 text-sm'>
                {ticket.answers.map((a) => (
                  <div key={a.id}>
                    <dt className='text-xs font-medium text-muted-foreground'>{a.label}</dt>
                    <dd className='whitespace-pre-wrap break-words'>{a.value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          <Section title='Historique'>
            <ol className='grid gap-2 p-4 text-xs'>
              {ticket.statusHistory.map((h, i) => {
                const s = ticket.statuses.find((x) => x.key === h.key)
                return (
                  <li key={i} className='flex items-center gap-2'>
                    <span aria-hidden className='size-2 rounded-full' style={{ background: s?.color ?? 'var(--muted-foreground)' }} />
                    <span className='flex-1'>{s?.emoji} {s?.label ?? h.key}</span>
                    <span className='text-muted-foreground'>{dateTime(h.at)}</span>
                  </li>
                )
              })}
            </ol>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={`Fermer le ticket #${ticket.number} ?`}
        desc='La conversation est enregistrée et envoyée selon les réglages du type de ticket.'
        confirmText='Fermer le ticket'
        destructive
        isLoading={action.isPending}
        handleConfirm={() => action.mutate({ path: 'close', body: { confirm: true, reason } })}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Raison' maxLength={200} rows={2} />
      </ConfirmDialog>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title='Demander au membre si le ticket peut être fermé ?'
        desc={`Un message avec « Fermer le ticket » et « J’ai encore besoin d’aide » part dans le ticket.${ticket.closeRequestHours ? ` Sans réponse, il est fermé au bout de ${ticket.closeRequestHours} h.` : ''}`}
        confirmText='Envoyer la demande'
        isLoading={action.isPending}
        handleConfirm={() => action.mutate({ path: 'close-request', body: { reason: askReason } })}
      >
        <Textarea value={askReason} onChange={(e) => setAskReason(e.target.value)} placeholder='Raison affichée au membre (facultatif)' maxLength={200} rows={2} />
      </ConfirmDialog>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader><DialogTitle>Ajouter quelqu’un au ticket</DialogTitle></DialogHeader>
          <UserPicker value='' onChange={(userId) => userId && action.mutate({ path: 'members', body: { userId } })} placeholder='Pseudo ou ID Discord' autoFocus />
        </DialogContent>
      </Dialog>
      {transcript && (
        <Dialog open onOpenChange={setTranscript}>
          <DialogContent className='max-h-[90svh] sm:max-w-3xl'>
            <DialogHeader><DialogTitle>Transcript du ticket #{ticket.number}</DialogTitle></DialogHeader>
            <pre className='max-h-[70svh] overflow-auto rounded-md bg-console p-3 font-mono text-xs whitespace-pre-wrap text-console-foreground'>{ticket.transcript ?? 'Transcript indisponible.'}</pre>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  )
}

// Saved replies of this ticket's type: a click puts the text in the reply box, still editable
function ReplyPicker({ ticketId, onPick }: { ticketId: number; onPick: (reply: TicketReply) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const replies = useQuery({ queryKey: ['ticket-replies', ticketId], queryFn: () => api<TicketReply[]>(`/tickets/${ticketId}/replies`), enabled: open })
  const q = query.trim().toLowerCase()
  const shown = (replies.data ?? []).filter((r) => !q || `${r.name} ${r.content}`.toLowerCase().includes(q))
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        <Button type='button' size='sm' variant='outline'><MessageSquareText /> Réponses</Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-[min(26rem,calc(100vw-1rem))] p-0'>
        <div className='border-b p-2'>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Chercher une réponse' aria-label='Chercher une réponse enregistrée'
            className='h-8 w-full rounded-md bg-muted px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50' />
        </div>
        <div className='max-h-80 overflow-y-auto p-1'>
          {replies.isLoading && <p className='p-3 text-center text-sm text-muted-foreground'>Chargement…</p>}
          {shown.map((r) => (
            <button key={r.id} type='button' onClick={() => { onPick(r); setOpen(false) }}
              className='grid w-full gap-0.5 rounded px-2 py-1.5 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'>
              <span className='text-sm font-medium'>{r.name}</span>
              <span className='line-clamp-2 text-xs break-words text-muted-foreground'>{r.content}</span>
            </button>
          ))}
          {!replies.isLoading && !shown.length && <p className='p-3 text-center text-sm text-muted-foreground'>Aucune réponse enregistrée. Elles se créent dans Tickets → Configuration.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MessageRow({ message: m }: { message: TicketMessage }) {
  const time = new Date(m.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={cn(
      'group flex animate-in gap-3 rounded-md px-2 py-1.5 fade-in-0 slide-in-from-bottom-1',
      m.internal && 'border-s-2 border-warning bg-warning/8',
      m.deletedAt && 'opacity-60',
    )}>
      <UserAvatar src={m.authorAvatar} name={m.authorName ?? '?'} className='mt-0.5 size-8' />
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-baseline gap-2'>
          <span className='text-sm font-medium'>{m.authorName ?? 'Inconnu'}</span>
          {m.panelUser && !m.internal && <Pill tone='accent'>Panel</Pill>}
          {m.internal && <Pill tone='warning'>Note interne</Pill>}
          {m.bot && !m.panelUser && <Pill>Bot</Pill>}
          <span className='text-xs text-muted-foreground'>{time}</span>
          {m.editedAt && <span className='text-xs text-muted-foreground'>(modifié)</span>}
          {m.deletedAt && <span className='text-xs text-destructive'>supprimé</span>}
        </div>
        {m.content && <p className={cn('text-sm whitespace-pre-wrap break-words', m.deletedAt && 'line-through')}>{m.content}</p>}
        {m.embeds.map((e, i) => (
          <div key={i} className='mt-1 max-w-lg rounded border-s-4 bg-muted/50 p-2 text-sm' style={{ borderColor: e.color ?? 'var(--border)' }}>
            {e.title && <div className='font-semibold'>{e.title}</div>}
            {e.description && <div className='whitespace-pre-wrap text-muted-foreground'>{e.description}</div>}
            {e.fields.map((f, j) => <div key={j} className='mt-1'><span className='font-medium'>{f.name}</span> : {f.value}</div>)}
          </div>
        ))}
        {m.attachments.map((a) => (
          a.contentType?.startsWith('image/')
            ? <a key={a.url} href={a.url} target='_blank' rel='noreferrer'><img src={a.url} alt={a.name} className='mt-1 max-h-60 rounded border' loading='lazy' /></a>
            : <a key={a.url} href={a.url} target='_blank' rel='noreferrer' className='mt-1 block text-sm text-primary underline'>{a.name}</a>
        ))}
      </div>
    </div>
  )
}
