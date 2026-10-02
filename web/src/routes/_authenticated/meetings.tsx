import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays, CalendarPlus, Check, CircleStop, ClipboardList, Clock, Mic, Pencil, Play, Plus, Repeat, Save, Trash2, Users, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, Role } from '@/lib/types'
import { cn } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar } from '@/components/app/ui'
import { ChannelSelect, RolesPicker } from '@/components/app/pickers'
import { UserPicker } from '@/components/app/user-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toLocalInput } from '@/features/announcements/schedule-editor'
import { DuplicateButton } from '@/components/app/duplicate-button'

export const Route = createFileRoute('/_authenticated/meetings')({
  component: MeetingsPage,
})

type Person = { id: string; name: string | null; avatar: string | null } | null
type Rsvp = 'pending' | 'yes' | 'maybe' | 'no'
type ReportPerson = { userId: string; user: Person; invited: boolean; rsvp: Rsvp | null; reason: string | null; status: 'present' | 'late' | 'excused' | 'absent' | 'guest'; minutes: number; firstJoin: number | null; inVoice: boolean }
type Action = { id: number; meetingId: number; text: string; assigneeId: string | null; assignee: Person; dueAt: number | null; doneAt: number | null; meetingTitle?: string }
type AgendaItem = { text: string; done: boolean; note: string }
type Meeting = {
  id: number; guildId: string; title: string; description: string; agenda: AgendaItem[]; startsAt: number; endsAt: number; durationMinutes: number
  voiceChannelId: string; announceChannelId: string | null; invites: { rankIds: number[]; roleIds: string[]; userIds: string[] }; reminders: number[]
  recurrence: { type: string; days: number[]; time: string } | null; status: 'scheduled' | 'live' | 'ended' | 'cancelled'; startedAt: number | null; endedAt: number | null
  notes: string; answers: Record<Rsvp, number>; invitees: { userId: string; user: Person; rsvp: Rsvp; reason: string | null }[]
  report: { people: ReportPerson[]; counts: Record<string, number> } | null; actions: Action[]
}
type GuildData = { id: string; name: string; icon: string | null; voiceChannels: { id: string; name: string; members: number }[]; textChannels: Channel[]; roles: Role[] }
type Payload = {
  meetings: Meeting[]; tasks: Action[]; ranks: { id: number; name: string; color: string | null; level: number }[]; guilds: GuildData[]
  stats: { meetings: number; people: { userId: string; user: Person; invited: number; present: number; late: number; excused: number; absent: number; minutes: number; rate: number }[] }
}

const STATUS = { scheduled: { label: 'Prévue', tone: 'info' }, live: { label: 'En cours', tone: 'danger' }, ended: { label: 'Terminée', tone: 'success' }, cancelled: { label: 'Annulée', tone: 'neutral' } } as const
const PRESENCE = { present: { label: 'À l’heure', tone: 'success' }, late: { label: 'En retard', tone: 'warning' }, excused: { label: 'Excusé', tone: 'info' }, absent: { label: 'Absent', tone: 'danger' }, guest: { label: 'De passage', tone: 'neutral' } } as const
const RSVP = { yes: '✅', maybe: '🤔', no: '❌', pending: '⏳' }
const REMINDERS = [[1440, '1 jour avant'], [180, '3 h avant'], [60, '1 h avant'], [10, '10 min avant']] as const

function MeetingsPage() {
  const { can } = useMe()
  const manage = can('meetings.manage')
  const { data, isLoading } = useQuery({ queryKey: ['meetings'], queryFn: () => api<Payload>('/meetings'), refetchInterval: (q) => (q.state.data?.meetings.some((m) => m.status === 'live') ? 10_000 : 60_000) })
  const [open, setOpen] = useState<number | null>(null)
  const [editing, setEditing] = useState<Partial<Meeting> | null>(null)
  const upcoming = data?.meetings.filter((m) => m.status === 'scheduled' || m.status === 'live') ?? []
  const past = data?.meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled') ?? []
  const current = data?.meetings.find((m) => m.id === open)
  const live = upcoming.find((m) => m.status === 'live')

  return (
    <Page
      title='Réunions du staff'
      description='Convoque le staff (par rang, rôle ou personne), suis les réponses, et laisse le bot noter qui est venu dans le salon vocal, combien de temps et qui était en retard. Compte rendu, tâches et rappels compris. Aussi avec /reunion.'
      actions={manage && data?.guilds.length ? <Button onClick={() => setEditing({})}><CalendarPlus /> Nouvelle réunion</Button> : null}
    >
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards items={[
            { label: 'À venir', value: upcoming.filter((m) => m.status === 'scheduled').length, icon: CalendarDays, tone: 'info' },
            { label: 'Réunions (90 j)', value: data.stats.meetings, icon: Users, tone: 'accent' },
            { label: 'Tâches ouvertes', value: data.tasks.length, icon: ClipboardList, tone: 'warning' },
          ]} />
          {live && <LiveBanner meeting={live} onOpen={() => setOpen(live.id)} />}
          <Tabs defaultValue='upcoming'>
            <TabsList className='h-auto flex-wrap'>
              <TabsTrigger value='upcoming'>À venir ({upcoming.length})</TabsTrigger>
              <TabsTrigger value='past'>Passées ({past.length})</TabsTrigger>
              <TabsTrigger value='stats'>Présences</TabsTrigger>
              <TabsTrigger value='tasks'>Tâches ({data.tasks.length})</TabsTrigger>
            </TabsList>
            <TabsContent value='upcoming' className='mt-4'>
              {!upcoming.length ? <Section title='À venir'><EmptyState title='Aucune réunion prévue' icon={CalendarDays}>Programme la prochaine réunion du staff : le bot convoque, rappelle et compte les présents.</EmptyState></Section> : (
                <div className='stagger grid gap-4 lg:grid-cols-2'>{upcoming.map((m) => <MeetingCard key={m.id} meeting={m} data={data} onOpen={() => setOpen(m.id)} onEdit={() => setEditing(m)} onDuplicate={() => setEditing(meetingCopy(m))} />)}</div>
              )}
            </TabsContent>
            <TabsContent value='past' className='mt-4'>
              <Section title='Réunions passées'>
                {!past.length ? <EmptyState title='Pas encore de réunion terminée' icon={ClipboardList} /> : (
                  <ul className='divide-y'>
                    {past.map((m) => (
                      <li key={m.id}>
                        <button type='button' onClick={() => setOpen(m.id)} className='flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start hover:bg-accent/40'>
                          <div className='min-w-0 flex-1 basis-56'>
                            <div className='flex items-center gap-2 font-medium'>{m.title}<Pill tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Pill></div>
                            <div className='text-xs text-muted-foreground'>{dateTime(m.startedAt ?? m.startsAt)}</div>
                          </div>
                          {m.report && <span className='text-sm text-muted-foreground'>{m.report.counts.present + m.report.counts.late}/{m.report.counts.invited} présents · {m.report.counts.absent} absent{m.report.counts.absent > 1 ? 's' : ''}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </TabsContent>
            <TabsContent value='stats' className='mt-4'><Stats data={data} /></TabsContent>
            <TabsContent value='tasks' className='mt-4'><Tasks tasks={data.tasks} onOpen={setOpen} /></TabsContent>
          </Tabs>
        </div>
      )}
      {current && data && <MeetingDialog key={current.id} meeting={current} data={data} onClose={() => setOpen(null)} onEdit={() => { setEditing(current); setOpen(null) }} />}
      {editing && data && <EditDialog key={editing.id ?? 'new'} meeting={editing} data={data} onClose={() => setEditing(null)} />}
    </Page>
  )
}

function LiveBanner({ meeting: m, onOpen }: { meeting: Meeting; onOpen: () => void }) {
  const here = m.report?.people.filter((p) => p.inVoice) ?? []
  return (
    <button type='button' onClick={onOpen} className='brackets flex flex-wrap items-center gap-4 rounded-xl border border-destructive/40 bg-destructive/8 p-4 text-start'>
      <span className='live-dot size-3 rounded-full bg-destructive' aria-hidden />
      <div className='min-w-0 flex-1'>
        <div className='font-display text-lg font-semibold'>En cours : {m.title}</div>
        <div className='text-sm text-muted-foreground'>{here.length} en vocal · commencée {dateTime(m.startedAt)}</div>
      </div>
      <div className='flex -space-x-2'>{here.slice(0, 8).map((p) => <UserAvatar key={p.userId} src={p.user?.avatar} name={p.user?.name ?? '?'} className='size-8 border-2 border-background' />)}</div>
    </button>
  )
}

// Planning fields only: the new meeting starts fresh (no attendance, notes or status)
function meetingCopy(m: Meeting): Partial<Meeting> {
  const { guildId, title, durationMinutes, voiceChannelId, announceChannelId, invites, agenda, recurrence } = m
  return structuredClone({ guildId, title: `${title} (copie)`, durationMinutes, voiceChannelId, announceChannelId, invites, agenda, recurrence })
}

function MeetingCard({ meeting: m, data, onOpen, onEdit, onDuplicate }: { meeting: Meeting; data: Payload; onOpen: () => void; onEdit: () => void; onDuplicate: () => void }) {
  const { can } = useMe()
  const guild = data.guilds.find((g) => g.id === m.guildId)
  const voice = guild?.voiceChannels.find((c) => c.id === m.voiceChannelId)
  return (
    <section className='lift grid gap-3 rounded-xl border bg-card p-4'>
      <div className='flex flex-wrap items-start gap-3'>
        <div className='grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-center leading-none text-primary'>
          <span className='font-display text-lg font-bold'>{new Date(m.startsAt).getDate()}</span>
          <span className='text-[10px] uppercase'>{new Date(m.startsAt).toLocaleDateString('fr-FR', { month: 'short' })}</span>
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'><h3 className='font-display text-lg font-semibold'>{m.title}</h3><Pill tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Pill>{m.recurrence && <Pill tone='neutral'><Repeat className='size-3' />chaque semaine</Pill>}</div>
          <p className='flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground'><span className='inline-flex items-center gap-1'><Clock className='size-3.5' />{dateTime(m.startsAt)} · {m.durationMinutes} min</span><span className='inline-flex items-center gap-1'><Mic className='size-3.5' />{voice?.name ?? 'salon'}</span></p>
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-3 text-sm'>
        <span>✅ {m.answers.yes}</span><span>🤔 {m.answers.maybe}</span><span>❌ {m.answers.no}</span><span className='text-muted-foreground'>⏳ {m.answers.pending} sans réponse</span>
        <div className='ms-auto flex -space-x-2'>{m.invitees.filter((i) => i.rsvp === 'yes').slice(0, 6).map((i) => <UserAvatar key={i.userId} src={i.user?.avatar} name={i.user?.name ?? '?'} className='size-7 border-2 border-card' />)}</div>
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' variant='outline' onClick={onOpen}>Ouvrir</Button>
        {can('meetings.manage') && m.status === 'scheduled' && <Button size='sm' variant='ghost' onClick={onEdit}><Pencil /> Modifier</Button>}
        {can('meetings.manage') && <DuplicateButton name={m.title} onClick={onDuplicate} />}
      </div>
    </section>
  )
}

function MeetingDialog({ meeting: m, data, onClose, onEdit }: { meeting: Meeting; data: Payload; onClose: () => void; onEdit: () => void }) {
  const { can } = useMe()
  const manage = can('meetings.manage')
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['meetings'] })
  const [notes, setNotes] = useState(m.notes)
  const [agenda, setAgenda] = useState(m.agenda)
  const [cancelling, setCancelling] = useState(false)
  const [task, setTask] = useState({ text: '', assigneeId: '', due: '' })
  const act = useMutation({ mutationFn: (path: string) => api(`/meetings/${m.id}/${path}`, { method: 'POST' }), onSuccess: (_, path) => { toast.success(path === 'start' ? 'Réunion démarrée' : 'Réunion terminée, compte rendu publié'); refresh() } })
  const cancel = useMutation({ mutationFn: () => api(`/meetings/${m.id}/cancel`, { method: 'POST', body: {} }), onSuccess: () => { toast.success('Réunion annulée, les invités sont prévenus'); refresh(); onClose() } })
  const saveNotes = useMutation({ mutationFn: () => api(`/meetings/${m.id}/notes`, { method: 'PUT', body: { notes, agenda } }), onSuccess: () => { toast.success('Compte rendu enregistré'); refresh() } })
  const addTask = useMutation({
    mutationFn: () => api(`/meetings/${m.id}/actions`, { method: 'POST', body: { text: task.text, assigneeId: /^\d{17,20}$/.test(task.assigneeId) ? task.assigneeId : null, dueAt: task.due ? new Date(task.due).getTime() : null } }),
    onSuccess: () => { setTask({ text: '', assigneeId: '', due: '' }); refresh() },
  })
  const toggleTask = useMutation({ mutationFn: ({ id, done }: { id: number; done: boolean }) => api(`/meeting-actions/${id}`, { method: 'PATCH', body: { done } }), onSuccess: refresh })
  const removeTask = useMutation({ mutationFn: (id: number) => api(`/meeting-actions/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  const guild = data.guilds.find((g) => g.id === m.guildId)
  const people = m.report?.people ?? m.invitees.map((i) => ({ ...i, invited: true, status: null, minutes: 0, firstJoin: null, inVoice: false }))
  const dirty = notes !== m.notes || JSON.stringify(agenda) !== JSON.stringify(m.agenda)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-x-hidden overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>{m.title}<Pill tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Pill></DialogTitle>
          <DialogDescription>
            {dateTime(m.startsAt)} · {m.durationMinutes} min · 🔊 {guild?.voiceChannels.find((c) => c.id === m.voiceChannelId)?.name ?? 'salon'}
            {m.startedAt && <> · commencée {dateTime(m.startedAt)}</>}{m.endedAt && <> · terminée {dateTime(m.endedAt)}</>}
          </DialogDescription>
        </DialogHeader>
        {manage && (
          <div className='flex flex-wrap gap-2'>
            {m.status === 'scheduled' && <Button size='sm' loading={act.isPending} onClick={() => act.mutate('start')}><Play /> Démarrer maintenant</Button>}
            {m.status === 'live' && <Button size='sm' variant='destructive' loading={act.isPending} onClick={() => act.mutate('end')}><CircleStop /> Terminer et publier le compte rendu</Button>}
            {m.status === 'scheduled' && <Button size='sm' variant='outline' onClick={onEdit}><Pencil /> Modifier</Button>}
            {(m.status === 'scheduled' || m.status === 'live') && <Button size='sm' variant='danger-ghost' onClick={() => setCancelling(true)}><X /> Annuler la réunion</Button>}
          </div>
        )}
        {m.description && <p className='text-sm whitespace-pre-line text-muted-foreground'>{m.description}</p>}

        <div className='grid gap-6 lg:grid-cols-2'>
          <div className='grid content-start gap-2'>
            <h3 className='font-medium'>{m.report ? 'Présences' : 'Réponses'}</h3>
            <ul className='divide-y rounded-lg border'>
              {people.map((p) => (
                <li key={p.userId} className='flex items-center gap-2 px-3 py-2 text-sm'>
                  <span className={cn('size-2 shrink-0 rounded-full', p.inVoice ? 'live-dot bg-success' : 'bg-transparent')} aria-label={p.inVoice ? 'en vocal' : undefined} />
                  <UserAvatar src={p.user?.avatar} name={p.user?.name ?? '?'} className='size-6' />
                  <Link to='/people' search={{ id: p.userId }} className='min-w-0 flex-1 truncate hover:underline'>{p.user?.name ?? p.userId}</Link>
                  {p.rsvp && <span title='Réponse'>{RSVP[p.rsvp]}</span>}
                  {m.report && p.status && <Pill tone={PRESENCE[p.status].tone}>{PRESENCE[p.status].label}</Pill>}
                  {m.report && <span className='w-14 text-end text-xs text-muted-foreground tabular-nums'>{p.minutes} min</span>}
                </li>
              ))}
            </ul>
            {people.some((p) => p.reason) && <div className='grid gap-1 text-xs text-muted-foreground'>{people.filter((p) => p.reason).map((p) => <p key={p.userId}>❌ {p.user?.name} : {p.reason}</p>)}</div>}
          </div>

          <div className='grid content-start gap-4'>
            <div className='grid gap-2'>
              <h3 className='font-medium'>Ordre du jour</h3>
              {!agenda.length && <p className='text-sm text-muted-foreground'>Pas d’ordre du jour.</p>}
              {agenda.map((a, i) => (
                <div key={i} className='grid gap-1 rounded-lg border p-2'>
                  <label className='flex items-start gap-2 text-sm'><Checkbox checked={a.done} disabled={!manage} onCheckedChange={(done) => setAgenda(agenda.map((x, j) => (j === i ? { ...x, done: Boolean(done) } : x)))} /><span className={cn(a.done && 'text-muted-foreground line-through')}>{a.text}</span></label>
                  {manage && <Input value={a.note} placeholder='Décision, remarque…' maxLength={500} aria-label={`Note pour ${a.text}`} onChange={(e) => setAgenda(agenda.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} className='h-8 text-xs' />}
                </div>
              ))}
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='m-notes'>Compte rendu</Label>
              <Textarea id='m-notes' rows={6} value={notes} maxLength={20000} disabled={!manage} onChange={(e) => setNotes(e.target.value)} placeholder='Ce qui s’est dit, les décisions…' />
              {manage && dirty && <div><Button size='sm' loading={saveNotes.isPending} onClick={() => saveNotes.mutate()}><Save /> Enregistrer</Button></div>}
            </div>
          </div>
        </div>

        <div className='grid gap-2'>
          <h3 className='font-medium'>Tâches</h3>
          {m.actions.map((a) => (
            <div key={a.id} className='flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'>
              <Checkbox checked={Boolean(a.doneAt)} onCheckedChange={(done) => toggleTask.mutate({ id: a.id, done: Boolean(done) })} aria-label={`Fait : ${a.text}`} />
              <span className={cn('min-w-0 flex-1', a.doneAt && 'text-muted-foreground line-through')}>{a.text}</span>
              {a.assignee && <span className='inline-flex items-center gap-1 text-xs'><UserAvatar src={a.assignee.avatar} name={a.assignee.name ?? '?'} className='size-5' />{a.assignee.name}</span>}
              {a.dueAt && <span className='text-xs text-muted-foreground'>pour le {new Date(a.dueAt).toLocaleDateString('fr-FR')}</span>}
              {manage && <Button size='icon' variant='danger-ghost' className='size-7' aria-label='Supprimer la tâche' onClick={() => removeTask.mutate(a.id)}><Trash2 className='size-3.5' /></Button>}
            </div>
          ))}
          {manage && (
            <form className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_11rem_auto]' onSubmit={(e) => { e.preventDefault(); if (task.text.trim()) addTask.mutate() }}>
              <Input value={task.text} maxLength={300} placeholder='Nouvelle tâche…' aria-label='Nouvelle tâche' onChange={(e) => setTask({ ...task, text: e.target.value })} />
              <UserPicker value={task.assigneeId} onChange={(assigneeId) => setTask({ ...task, assigneeId })} placeholder='Pour qui ?' />
              <Input type='date' aria-label='Échéance' value={task.due} onChange={(e) => setTask({ ...task, due: e.target.value })} />
              <Button type='submit' loading={addTask.isPending} disabled={!task.text.trim()}><Plus /> Ajouter</Button>
            </form>
          )}
        </div>
        <ConfirmDialog open={cancelling} onOpenChange={setCancelling} title='Annuler cette réunion ?' desc='Les invités reçoivent un message privé.' confirmText='Annuler la réunion' destructive isLoading={cancel.isPending} handleConfirm={() => cancel.mutate()} />
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ meeting, data, onClose }: { meeting: Partial<Meeting>; data: Payload; onClose: () => void }) {
  const qc = useQueryClient()
  const [now] = useState(() => Date.now())
  const nextHour = Math.ceil((now + 3_600_000) / 1_800_000) * 1_800_000
  const [m, setM] = useState({
    guildId: meeting.guildId ?? data.guilds[0]?.id ?? '',
    title: meeting.title ?? '',
    description: meeting.description ?? '',
    agenda: (meeting.agenda ?? []).map((a) => a.text),
    startsAt: meeting.startsAt ?? nextHour,
    durationMinutes: meeting.durationMinutes ?? 60,
    voiceChannelId: meeting.voiceChannelId ?? '',
    announceChannelId: meeting.announceChannelId ?? null,
    invites: meeting.invites ?? { rankIds: [], roleIds: [], userIds: [] },
    reminders: meeting.reminders ?? [1440, 60, 10],
    weekly: Boolean(meeting.recurrence),
  })
  const [userToAdd, setUserToAdd] = useState('')
  const set = (patch: Partial<typeof m>) => setM((prev) => ({ ...prev, ...patch }))
  const guild = data.guilds.find((g) => g.id === m.guildId)
  const start = new Date(m.startsAt)
  const body = {
    ...m,
    agenda: m.agenda.filter((a) => a.trim()).map((text) => ({ text })),
    recurrence: m.weekly ? { type: 'weekly', days: [start.getDay()], time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` } : null,
  }
  const save = useMutation({
    mutationFn: () => (meeting.id ? api(`/meetings/${meeting.id}`, { method: 'PUT', body }) : api('/meetings', { method: 'POST', body })),
    onSuccess: () => { toast.success(meeting.id ? 'Réunion modifiée' : 'Réunion programmée, convocations envoyées'); qc.invalidateQueries({ queryKey: ['meetings'] }); onClose() },
  })
  const invited = m.invites.rankIds.length + m.invites.roleIds.length + m.invites.userIds.length

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{meeting.id ? 'Modifier la réunion' : 'Nouvelle réunion'}</DialogTitle>
          <DialogDescription>Les invités reçoivent la convocation en message privé, avec des boutons pour répondre.</DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-1.5'><Label htmlFor='m-title'>Titre</Label><Input id='m-title' value={m.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder='Réunion staff hebdomadaire' autoFocus /></div>
          <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]'>
            <div className='grid gap-1.5'><Label htmlFor='m-start'>Date et heure</Label><Input id='m-start' type='datetime-local' value={toLocalInput(m.startsAt)} onChange={(e) => set({ startsAt: new Date(e.target.value).getTime() })} /></div>
            <div className='grid gap-1.5'><Label htmlFor='m-duration'>Durée (min)</Label><Input id='m-duration' type='number' min={5} max={600} value={m.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })} /></div>
          </div>
          <label className='flex items-center gap-2 text-sm'><Switch checked={m.weekly} onCheckedChange={(weekly) => set({ weekly })} /> Toutes les semaines ({start.toLocaleDateString('fr-FR', { weekday: 'long' })} à {start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})</label>
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='grid gap-1.5'>
              <Label>Serveur</Label>
              <Select value={m.guildId} onValueChange={(guildId) => set({ guildId, voiceChannelId: '', announceChannelId: null, invites: { ...m.invites, roleIds: [] } })}>
                <SelectTrigger aria-label='Serveur'><SelectValue /></SelectTrigger>
                <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'>
              <Label>Salon vocal</Label>
              <Select value={m.voiceChannelId} onValueChange={(voiceChannelId) => set({ voiceChannelId })}>
                <SelectTrigger aria-label='Salon vocal'><SelectValue placeholder='Choisir' /></SelectTrigger>
                <SelectContent>{guild?.voiceChannels.map((c) => <SelectItem key={c.id} value={c.id}>🔊 {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'>
              <Label>Salon de la convocation</Label>
              <ChannelSelect channels={guild?.textChannels ?? []} value={m.announceChannelId} onChange={(announceChannelId) => set({ announceChannelId })} label='Salon de la convocation' noneLabel='Aucun (MP seulement)' />
            </div>
          </div>

          <div className='grid gap-2 rounded-lg border p-3'>
            <Label>Invités</Label>
            <div className='flex flex-wrap gap-x-4 gap-y-1'>
              {data.ranks.map((r) => (
                <label key={r.id} className='flex items-center gap-2 text-sm'>
                  <Checkbox checked={m.invites.rankIds.includes(r.id)} onCheckedChange={(on) => set({ invites: { ...m.invites, rankIds: on ? [...m.invites.rankIds, r.id] : m.invites.rankIds.filter((x) => x !== r.id) } })} />
                  <span style={r.color ? { color: r.color } : undefined}>{r.name}</span>
                </label>
              ))}
            </div>
            <RolesPicker roles={guild?.roles ?? []} value={m.invites.roleIds} onChange={(roleIds) => set({ invites: { ...m.invites, roleIds } })} label='Rôles invités' placeholder='Aucun rôle' />
            <div className='flex flex-wrap items-center gap-2'>
              {m.invites.userIds.map((id) => <Pill key={id} tone='neutral'>{id}<button type='button' aria-label='Retirer' onClick={() => set({ invites: { ...m.invites, userIds: m.invites.userIds.filter((x) => x !== id) } })}><X className='size-3' /></button></Pill>)}
              <UserPicker value={userToAdd} placeholder='Ajouter une personne' className='w-56' onChange={(id) => { if (/^\d{17,20}$/.test(id) && !m.invites.userIds.includes(id)) set({ invites: { ...m.invites, userIds: [...m.invites.userIds, id] } }); setUserToAdd('') }} />
            </div>
          </div>

          <div className='grid gap-2'>
            <div className='flex items-center justify-between'><Label>Ordre du jour</Label><Button size='sm' variant='ghost' onClick={() => set({ agenda: [...m.agenda, ''] })}><Plus /> Point</Button></div>
            {m.agenda.map((a, i) => (
              <div key={i} className='flex gap-2'>
                <Input value={a} maxLength={200} aria-label={`Point ${i + 1}`} placeholder={`Point ${i + 1}`} onChange={(e) => set({ agenda: m.agenda.map((x, j) => (j === i ? e.target.value : x)) })} />
                <Button size='icon' variant='danger-ghost' aria-label='Retirer le point' onClick={() => set({ agenda: m.agenda.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            ))}
          </div>
          <div className='grid gap-1.5'><Label htmlFor='m-desc'>Description</Label><Textarea id='m-desc' rows={2} maxLength={2000} value={m.description} onChange={(e) => set({ description: e.target.value })} /></div>
          <div className='grid gap-2'>
            <Label>Rappels en MP</Label>
            <div className='flex flex-wrap gap-4'>
              {REMINDERS.map(([minutes, label]) => (
                <label key={minutes} className='flex items-center gap-2 text-sm'>
                  <Checkbox checked={m.reminders.includes(minutes)} onCheckedChange={(on) => set({ reminders: on ? [...m.reminders, minutes] : m.reminders.filter((x) => x !== minutes) })} />{label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} disabled={!m.title.trim() || !m.voiceChannelId || !invited} onClick={() => save.mutate()}>{meeting.id ? 'Enregistrer' : 'Programmer et convoquer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stats({ data }: { data: Payload }) {
  if (!data.stats.people.length) return <Section title='Présences sur 90 jours'><EmptyState title='Pas encore de réunion terminée' icon={Users} /></Section>
  return (
    <Section title='Présences sur 90 jours' description={`${data.stats.meetings} réunion${data.stats.meetings > 1 ? 's' : ''} terminée${data.stats.meetings > 1 ? 's' : ''}. Le taux compte les présences (à l’heure ou en retard) sur les convocations.`}>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[40rem] text-sm'>
          <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Membre</th><th className='px-2 text-start font-medium'>Taux</th><th className='px-2 text-end font-medium'>Convoqué</th><th className='px-2 text-end font-medium'>À l’heure</th><th className='px-2 text-end font-medium'>Retard</th><th className='px-2 text-end font-medium'>Excusé</th><th className='px-2 text-end font-medium'>Absent</th><th className='px-4 text-end font-medium'>Temps</th></tr></thead>
          <tbody className='divide-y'>
            {data.stats.people.map((p) => (
              <tr key={p.userId}>
                <td className='px-4 py-2'><span className='flex items-center gap-2'><UserAvatar src={p.user?.avatar} name={p.user?.name ?? '?'} className='size-6' />{p.user?.name ?? p.userId}</span></td>
                <td className='px-2'><span className='flex items-center gap-2'><span className='h-1.5 w-20 overflow-hidden rounded-full bg-muted'><span className={cn('block h-full rounded-full', p.rate >= 75 ? 'bg-success' : p.rate >= 50 ? 'bg-warning' : 'bg-destructive')} style={{ width: `${p.rate}%` }} /></span><span className='tabular-nums'>{p.rate} %</span></span></td>
                <td className='px-2 text-end tabular-nums'>{p.invited}</td><td className='px-2 text-end tabular-nums'>{p.present}</td><td className='px-2 text-end tabular-nums'>{p.late}</td><td className='px-2 text-end tabular-nums'>{p.excused}</td>
                <td className={cn('px-2 text-end tabular-nums', p.absent > 0 && 'text-destructive')}>{p.absent}</td><td className='px-4 text-end tabular-nums'>{Math.round(p.minutes / 6) / 10} h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function Tasks({ tasks, onOpen }: { tasks: Action[]; onOpen: (id: number) => void }) {
  const qc = useQueryClient()
  const toggle = useMutation({ mutationFn: (id: number) => api(`/meeting-actions/${id}`, { method: 'PATCH', body: { done: true } }), onSuccess: () => { toast.success('Tâche faite'); qc.invalidateQueries({ queryKey: ['meetings'] }) } })
  const [now] = useState(() => Date.now())
  return (
    <Section title='Tâches ouvertes' description='Décidées en réunion. La personne en charge peut cocher sa tâche elle-même.'>
      {!tasks.length ? <EmptyState title='Tout est fait' icon={Check} /> : (
        <ul className='divide-y'>
          {tasks.map((t) => (
            <li key={t.id} className='flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm'>
              <Button size='icon' variant='outline' className='size-7' aria-label={`Marquer « ${t.text} » comme faite`} onClick={() => toggle.mutate(t.id)}><Check className='size-3.5' /></Button>
              <span className='min-w-0 flex-1 basis-48'>{t.text}</span>
              {t.assignee && <span className='inline-flex items-center gap-1'><UserAvatar src={t.assignee.avatar} name={t.assignee.name ?? '?'} className='size-5' />{t.assignee.name}</span>}
              {t.dueAt && <Pill tone={t.dueAt < now ? 'danger' : 'neutral'}>pour le {new Date(t.dueAt).toLocaleDateString('fr-FR')}</Pill>}
              <button type='button' className='text-xs text-primary hover:underline' onClick={() => onOpen(t.meetingId)}>{t.meetingTitle}</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
