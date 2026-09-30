import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Lock, MailOpen, MessageSquarePlus, Save, Send, StickyNote, Trash2, Unlock, UserCheck, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { useLive } from '@/hooks/use-live'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { UserPicker } from '@/components/app/user-picker'
import { UploadButton } from '@/features/uploads/image-input'
import { imageUrl } from '@/features/uploads/upload'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/dms')({
  component: DmsPage,
})

type Person = { name: string | null; avatar: string | null }
type Thread = {
  id: number; userId: string; userName: string | null; status: 'open' | 'closed'; assignedTo: string | null; unread: number; dmsClosed: boolean; blocked: boolean
  startedBy: string; lastMessageAt: number; lastMessage: { content: string; direction: string } | null; user: Person; assignee: Person | null
}
type Message = { id: number; direction: 'in' | 'out' | 'note' | 'system'; authorId: string; content: string; attachments: { name: string; url: string; contentType?: string | null }[]; at: number }
type Config = { modmail: boolean; greeting: string; notify: { guildId: string; channelId: string } | null; signature: string }
type Inbox = { threads: Thread[]; snippets: { id: number; name: string; content: string }[]; config: Config | null; blocklist: { userId: string; reason: string | null; at: number }[]; guilds: { id: string; name: string; channels: Channel[] }[] }
type Conversation = { thread: Thread; messages: Message[]; authors: Record<string, Person> }

function DmsPage() {
  const { can } = useMe()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'open' | 'closed' | 'mine'>('open')
  const [selected, setSelected] = useState<number | null>(null)
  const [composing, setComposing] = useState(false)
  const query = filter === 'mine' ? '?status=open&mine=true' : `?status=${filter}`
  const { data } = useQuery({ queryKey: ['dms', query], queryFn: () => api<Inbox>(`/dms${query}`) })
  const live = useLive<{ type: string; thread: Thread }>('/api/dms/live', (event) => {
    qc.invalidateQueries({ queryKey: ['dms'] })
    if (event.thread.id === selected) qc.invalidateQueries({ queryKey: ['dm', selected] })
    else if (event.type === 'message' && event.thread.unread) toast.info(`Nouveau message de ${event.thread.user.name ?? event.thread.userId}`)
  })

  return (
    <Page
      title='Messages privés'
      description='Écris en MP à n’importe quel membre via le bot et suis les réponses ici, en direct. Une conversation par personne.'
      actions={
        <div className='flex items-center gap-3'>
          <span className='flex items-center gap-1.5 text-xs text-muted-foreground'><span className={cn(live ? 'live-dot' : 'size-2 rounded-full bg-muted-foreground')} aria-hidden />{live ? 'En direct' : 'Connexion…'}</span>
          {can('dm.send') && <Button onClick={() => setComposing(true)}><MessageSquarePlus /> Écrire à quelqu’un</Button>}
        </div>
      }
    >
      <Tabs defaultValue='inbox'>
        <TabsList>
          <TabsTrigger value='inbox'>Conversations</TabsTrigger>
          {can('dm.manage') && <TabsTrigger value='settings'>Réglages</TabsTrigger>}
        </TabsList>
        <TabsContent value='inbox' className='mt-4 grid gap-4'>
          {data && filter !== 'closed' && (
            <StatCards className='lg:grid-cols-3' items={[
              { label: 'Conversations ouvertes', value: data.threads.length, icon: MessageSquarePlus, tone: 'accent' },
              { label: 'Messages non lus', value: data.threads.reduce((n, t) => n + t.unread, 0), icon: MailOpen, tone: data.threads.some((t) => t.unread) ? 'warning' : 'neutral' },
              { label: 'Sans personne pour les suivre', value: data.threads.filter((t) => !t.assignedTo).length, icon: UserCheck, tone: 'info' },
            ]} />
          )}
          <div className='grid min-h-[36rem] overflow-hidden rounded-xl border bg-card md:grid-cols-[20rem_minmax(0,1fr)]'>
            <aside className={cn('flex min-w-0 flex-col border-e', selected !== null && 'hidden md:flex')}>
              <div className='flex gap-1 border-b p-2' role='group' aria-label='Filtre'>
                {([['open', 'Ouvertes'], ['mine', 'Les miennes'], ['closed', 'Fermées']] as const).map(([v, label]) => (
                  <button key={v} type='button' aria-pressed={filter === v} onClick={() => setFilter(v)} className={cn('flex-1 rounded-md px-2 py-1 text-sm transition-colors', filter === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>{label}</button>
                ))}
              </div>
              {!data ? <Skeleton className='m-2 h-40' /> : !data.threads.length ? <p className='p-6 text-center text-sm text-muted-foreground'>Aucune conversation.</p> : (
                <ul className='flex-1 divide-y overflow-y-auto'>
                  {data.threads.map((t) => (
                    <li key={t.id}>
                      <button type='button' onClick={() => setSelected(t.id)} aria-current={selected === t.id} className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-accent/40', selected === t.id && 'bg-accent/60')}>
                        <UserAvatar src={t.user.avatar} name={t.user.name ?? t.userId} />
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-1.5'>
                            <span className={cn('truncate text-sm', t.unread ? 'font-semibold' : 'font-medium')}>{t.user.name ?? t.userId}</span>
                            {t.blocked && <Ban className='size-3.5 text-destructive' aria-label='Bloqué' />}
                            <span className='ms-auto shrink-0 text-[11px] text-muted-foreground'>{ago(t.lastMessageAt)}</span>
                          </div>
                          <div className='flex items-center gap-1.5'>
                            <span className='truncate text-xs text-muted-foreground'>{t.lastMessage ? `${t.lastMessage.direction === 'out' ? 'Vous : ' : ''}${t.lastMessage.content || '📎 Pièce jointe'}` : 'Pas encore de message'}</span>
                            {t.unread > 0 && <span className='ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground'>{t.unread}</span>}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
            <div className={cn('min-w-0', selected === null && 'hidden md:block')}>
              {selected === null
                ? <div className='grid h-full place-items-center p-8'><EmptyState title='Choisis une conversation'>Les réponses arrivent ici en direct.</EmptyState></div>
                : <ConversationView key={selected} id={selected} snippets={data?.snippets ?? []} onBack={() => setSelected(null)} />}
            </div>
          </div>
        </TabsContent>
        {can('dm.manage') && data?.config && (
          <TabsContent value='settings' className='mt-4'><Settings key={JSON.stringify(data.config)} data={data} /></TabsContent>
        )}
      </Tabs>
      {composing && <NewConversation onClose={() => setComposing(false)} onOpened={(id) => { setComposing(false); setFilter('open'); setSelected(id) }} />}
    </Page>
  )
}

function NewConversation({ onClose, onOpened }: { onClose: () => void; onOpened: (id: number) => void }) {
  const [user, setUser] = useState<{ id: string; name: string | null }>({ id: '', name: null })
  const open = useMutation({
    mutationFn: () => api<Thread>('/dms', { method: 'POST', body: { userId: user.id, userName: user.name } }),
    onSuccess: (t) => onOpened(t.id),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Écrire à quelqu’un</DialogTitle></DialogHeader>
        <div className='grid gap-1.5'>
          <Label>Membre</Label>
          <UserPicker value={user.id} onChange={(id, picked) => setUser({ id, name: picked?.globalName ?? picked?.username ?? null })} autoFocus />
          <span className='text-xs text-muted-foreground'>La conversation s’ouvre ; ton premier message part quand tu l’envoies.</span>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => open.mutate()} disabled={!/^\d{17,20}$/.test(user.id) || open.isPending}><MessageSquarePlus /> Ouvrir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConversationView({ id, snippets, onBack }: { id: number; snippets: Inbox['snippets']; onBack: () => void }) {
  const { can, me } = useMe()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['dm', id], queryFn: () => api<Conversation>(`/dms/${id}`) })
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [signed, setSigned] = useState(false)
  const [noteMode, setNoteMode] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['dm', id] }); qc.invalidateQueries({ queryKey: ['dms'] }) }

  const unread = data?.thread.unread ?? 0
  useEffect(() => {
    if (unread > 0) api(`/dms/${id}/read`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['dms'] })).catch(() => null)
  }, [id, unread, qc])
  const count = data?.messages.length ?? 0
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [count])

  const send = useMutation({
    mutationFn: () => noteMode
      ? api(`/dms/${id}/notes`, { method: 'POST', body: { text } })
      : api(`/dms/${id}/messages`, { method: 'POST', body: { content: text, attachments, signed } }),
    onSuccess: () => { setText(''); setAttachments([]); refresh() },
    onError: refresh,
  })
  const status = useMutation({ mutationFn: (s: 'open' | 'closed') => api(`/dms/${id}/status`, { method: 'POST', body: { status: s } }), onSuccess: refresh })
  const assign = useMutation({ mutationFn: (userId: string | null) => api(`/dms/${id}/assign`, { method: 'POST', body: { userId } }), onSuccess: refresh })

  if (!data) return <Skeleton className='m-4 h-80' />
  const t = data.thread
  const author = (m: Message) => (m.direction === 'in' ? t.user.name ?? t.userId : m.authorId === 'bot' ? 'Bot' : data.authors[m.authorId]?.name ?? m.authorId)
  const canSend = can('dm.send')

  return (
    <div className='flex h-full max-h-[48rem] flex-col'>
      <header className='flex flex-wrap items-center gap-2 border-b p-3'>
        <Button size='icon' variant='ghost' className='md:hidden' aria-label='Retour aux conversations' onClick={onBack}><X /></Button>
        <UserAvatar src={t.user.avatar} name={t.user.name ?? t.userId} />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2 font-medium'>
            {t.user.name ?? t.userId}
            {t.status === 'closed' && <Pill>Fermée</Pill>}
            {t.dmsClosed && <Pill tone='danger'>MP fermés</Pill>}
            {t.blocked && <Pill tone='danger'>Bloqué</Pill>}
          </div>
          <div className='text-xs text-muted-foreground'>{t.assignee ? `Suivie par ${t.assignee.name}` : 'Personne ne suit cette conversation'} · {t.startedBy === 'user' ? 'a écrit en premier' : 'ouverte par le staff'}</div>
        </div>
        {canSend && (
          <div className='flex gap-2'>
            {t.assignedTo === me?.user.id
              ? <Button size='sm' variant='ghost' onClick={() => assign.mutate(null)}>Ne plus suivre</Button>
              : <Button size='sm' variant='outline' onClick={() => assign.mutate(me?.user.id ?? null)}><UserCheck /> Je m’en occupe</Button>}
            {t.status === 'open'
              ? <Button size='sm' variant='outline' onClick={() => status.mutate('closed')}><Lock /> Fermer</Button>
              : <Button size='sm' variant='outline' onClick={() => status.mutate('open')}><Unlock /> Rouvrir</Button>}
          </div>
        )}
      </header>

      <div className='flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4' aria-live='polite'>
        {!data.messages.length && <p className='text-center text-sm text-muted-foreground'>Aucun message pour l’instant.</p>}
        {data.messages.map((m) => {
          if (m.direction === 'note' || m.direction === 'system') {
            return (
              <div key={m.id} className={cn('mx-auto max-w-lg rounded-md px-3 py-2 text-sm', m.direction === 'note' ? 'border border-dashed border-warning/60 bg-warning/10' : 'text-center text-xs text-muted-foreground')}>
                {m.direction === 'note' && <span className='me-1 font-medium'><StickyNote className='me-1 inline size-3.5' />{author(m)} :</span>}
                <span className='whitespace-pre-wrap'>{m.direction === 'system' ? `Message automatique : ${m.content}` : m.content}</span>
                <span className='ms-2 text-[11px] text-muted-foreground'>{dateTime(m.at)}</span>
              </div>
            )
          }
          const out = m.direction === 'out'
          return (
            <div key={m.id} className={cn('flex animate-in fade-in slide-in-from-bottom-1', out ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-xs', out ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-card')}>
                {m.content && <p className='whitespace-pre-wrap break-words'>{m.content}</p>}
                {m.attachments.map((a) => {
                  const src = imageUrl(a.url) ?? a.url
                  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.name) || a.contentType?.startsWith('image/')
                    ? <a key={a.url} href={src} target='_blank' rel='noreferrer'><img src={src} alt={a.name} className='mt-1.5 max-h-60 rounded-lg' /></a>
                    : <a key={a.url} href={src} target='_blank' rel='noreferrer' className='mt-1 block underline'>📎 {a.name}</a>
                })}
                <div className={cn('mt-0.5 text-[11px]', out ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{out ? `${author(m)} · ` : ''}{dateTime(m.at)}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      {(canSend || can('dm.view')) && (
        <form
          className='grid gap-2 border-t p-3'
          onSubmit={(e) => { e.preventDefault(); if (text.trim() || attachments.length) send.mutate() }}
        >
          {t.dmsClosed && !noteMode && <p className='text-xs text-destructive'>Le dernier envoi a échoué : ses messages privés sont fermés. Tu peux réessayer s’il les a rouverts.</p>}
          {attachments.length > 0 && (
            <div className='flex flex-wrap gap-2'>
              {attachments.map((a) => (
                <span key={a} className='relative'>
                  <img src={imageUrl(a) ?? undefined} alt='' className='size-14 rounded border object-cover' />
                  <button type='button' aria-label='Retirer la pièce jointe' className='absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-destructive text-white' onClick={() => setAttachments(attachments.filter((x) => x !== a))}><X className='size-3' /></button>
                </span>
              ))}
            </div>
          )}
          <Textarea
            rows={3} maxLength={noteMode ? 1000 : 1800} value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (text.trim() || attachments.length) send.mutate() } }}
            placeholder={noteMode ? 'Note interne, visible seulement dans le panel' : 'Ton message (Ctrl+Entrée pour envoyer)'}
            className={cn(noteMode && 'border-warning/60 bg-warning/5')}
            aria-label={noteMode ? 'Note interne' : 'Message'}
          />
          <div className='flex flex-wrap items-center gap-2'>
            {canSend && (
              <label className='flex items-center gap-1.5 text-sm'>
                <Switch checked={!noteMode} onCheckedChange={(v) => setNoteMode(!v)} aria-label='Message ou note interne' /> {noteMode ? 'Note interne' : 'Message'}
              </label>
            )}
            {!noteMode && canSend && (
              <>
                {snippets.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type='button' size='sm' variant='outline'><Zap /> Réponses rapides</Button></DropdownMenuTrigger>
                    <DropdownMenuContent>{snippets.map((s) => <DropdownMenuItem key={s.id} onSelect={() => setText(text ? `${text}\n${s.content}` : s.content)}>{s.name}</DropdownMenuItem>)}</DropdownMenuContent>
                  </DropdownMenu>
                )}
                {attachments.length < 5 && <UploadButton onUploaded={(src) => setAttachments([...attachments, src])} label='Image' />}
                <label className='flex items-center gap-1.5 text-sm'><Checkbox checked={signed} onCheckedChange={(v) => setSigned(v === true)} /> Signer de mon nom</label>
              </>
            )}
            <Button loading={send.isPending} type='submit' className='ms-auto' disabled={send.isPending || (!text.trim() && !attachments.length) || (!noteMode && !canSend)}>
              {noteMode ? <><StickyNote /> Ajouter la note</> : <><Send /> Envoyer</>}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function Settings({ data }: { data: Inbox }) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['dms'] })
  const [c, setC] = useState<Config>(data.config!)
  const [notifyGuild, setNotifyGuild] = useState(c.notify?.guildId ?? data.guilds[0]?.id ?? '')
  const [snippet, setSnippet] = useState<{ id: number | null; name: string; content: string } | null>(null)
  const [blockUser, setBlockUser] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const save = useMutation({ mutationFn: () => api('/dms/config', { method: 'PUT', body: c }), onSuccess: () => { toast.success('Réglages enregistrés'); refresh() } })
  const saveSnippet = useMutation({ mutationFn: () => api('/dms/snippets', { method: 'POST', body: snippet }), onSuccess: () => { toast.success('Réponse rapide enregistrée'); setSnippet(null); refresh() } })
  const dropSnippet = useMutation({ mutationFn: (id: number) => api(`/dms/snippets/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  const block = useMutation({ mutationFn: () => api('/dms/blocklist', { method: 'POST', body: { userId: blockUser, reason: blockReason } }), onSuccess: () => { toast.success('Membre bloqué'); setBlockUser(''); setBlockReason(''); refresh() } })
  const unblock = useMutation({ mutationFn: (userId: string) => api(`/dms/blocklist/${userId}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Membre débloqué'); refresh() } })

  return (
    <div className='grid gap-6'>
      <Section title='Premier contact' description='Quand un membre écrit au bot sans conversation ouverte : conversation créée, message d’accueil automatique et alerte au staff.' actions={<Button size='sm' onClick={() => save.mutate()} disabled={save.isPending}><Save /> Enregistrer</Button>}>
        <div className='grid gap-4 p-4'>
          <label className='flex items-center gap-2 text-sm'><Switch checked={c.modmail} onCheckedChange={(v) => setC({ ...c, modmail: v })} /> Les membres peuvent écrire au bot en premier</label>
          <div className='grid gap-1.5'><Label htmlFor='dm-greeting'>Message d’accueil</Label><Textarea id='dm-greeting' rows={3} maxLength={1500} value={c.greeting} onChange={(e) => setC({ ...c, greeting: e.target.value })} /></div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'><Label htmlFor='dm-signature'>Signature des messages</Label><Input id='dm-signature' maxLength={80} value={c.signature} onChange={(e) => setC({ ...c, signature: e.target.value })} /></div>
            <div className='grid gap-1.5'>
              <Label>Salon d’alerte du staff</Label>
              <div className='flex flex-wrap gap-2'>
                <Select value={notifyGuild} onValueChange={(v) => { setNotifyGuild(v); setC({ ...c, notify: null }) }}>
                  <SelectTrigger className='w-40' aria-label='Serveur de l’alerte'><SelectValue /></SelectTrigger>
                  <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
                <ChannelSelect channels={data.guilds.find((g) => g.id === notifyGuild)?.channels ?? []} value={c.notify?.channelId ?? null} onChange={(v) => setC({ ...c, notify: v ? { guildId: notifyGuild, channelId: v } : null })} label='Salon d’alerte' noneLabel='Pas d’alerte' />
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title='Réponses rapides' actions={<Button size='sm' variant='outline' onClick={() => setSnippet({ id: null, name: '', content: '' })}><Zap /> Ajouter</Button>}>
        {!data.snippets.length ? <EmptyState title='Aucune réponse rapide'>Des textes prêts à insérer dans une réponse.</EmptyState> : (
          <ul className='divide-y'>
            {data.snippets.map((s) => (
              <li key={s.id} className='flex items-center gap-3 px-4 py-2.5'>
                <div className='min-w-0 flex-1'><div className='font-medium'>{s.name}</div><div className='truncate text-xs text-muted-foreground'>{s.content}</div></div>
                <Button size='sm' variant='ghost' onClick={() => setSnippet(s)}>Modifier</Button>
                <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${s.name}`} onClick={() => dropSnippet.mutate(s.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title='Liste noire' description='Les MP de ces membres au bot sont ignorés. Aussi avec /dm bloquer sur Discord.'>
        <div className='grid gap-3 p-4'>
          <div className='flex flex-wrap gap-2'>
            <UserPicker value={blockUser} onChange={(id) => setBlockUser(id)} className='w-64' />
            <Input value={blockReason} maxLength={300} onChange={(e) => setBlockReason(e.target.value)} placeholder='Raison (facultatif)' className='w-64' aria-label='Raison du blocage' />
            <Button variant='danger-outline' onClick={() => block.mutate()} disabled={!/^\d{17,20}$/.test(blockUser)}><Ban /> Bloquer</Button>
          </div>
          {data.blocklist.map((b) => (
            <div key={b.userId} className='flex items-center gap-2 text-sm'>
              <span className='flex-1'><code className='text-xs'>{b.userId}</code>{b.reason ? ` · ${b.reason}` : ''} · {ago(b.at)}</span>
              <Button size='sm' variant='ghost' onClick={() => unblock.mutate(b.userId)}>Débloquer</Button>
            </div>
          ))}
        </div>
      </Section>

      <Dialog open={snippet !== null} onOpenChange={(o) => !o && setSnippet(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{snippet?.id ? 'Modifier la réponse rapide' : 'Nouvelle réponse rapide'}</DialogTitle></DialogHeader>
          {snippet && (
            <div className='grid gap-3'>
              <div className='grid gap-1.5'><Label htmlFor='sn-name'>Nom</Label><Input id='sn-name' maxLength={60} value={snippet.name} onChange={(e) => setSnippet({ ...snippet, name: e.target.value })} /></div>
              <div className='grid gap-1.5'><Label htmlFor='sn-content'>Texte</Label><Textarea id='sn-content' rows={5} maxLength={1800} value={snippet.content} onChange={(e) => setSnippet({ ...snippet, content: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setSnippet(null)}>Annuler</Button>
            <Button onClick={() => saveSnippet.mutate()} disabled={!snippet?.name.trim() || !snippet.content.trim()}><Save /> Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

