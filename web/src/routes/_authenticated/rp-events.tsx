import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CalendarDays, CalendarPlus, Clock, MapPin, Pencil, Save, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { cn, copyOf } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TargetsEditor } from '@/features/announcements/targets-editor'
import { ImageInput } from '@/features/uploads/image-input'
import { imageUrl } from '@/features/uploads/upload'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { DuplicateButton } from '@/components/app/duplicate-button'

export const Route = createFileRoute('/_authenticated/rp-events')({
  component: RpEventsPage,
})

type Status = 'scheduled' | 'live' | 'ended' | 'cancelled'
type RpEvent = {
  id: number; title: string; description: string; image: string | null; location: string | null; startsAt: number; endsAt: number; capacity: number | null; allowMaybe: boolean
  targets: AnnouncementTarget[]; roles: Record<string, string>; reminders: number[]; status: Status; counts: { going: number; maybe: number; waitlist: number }
}
type Data = { events: RpEvent[]; guilds: (AnnouncementTargetsPayload[number] & { roles: { id: string; name: string; color: number | string | null; editable?: boolean }[] })[] }

const STATUS: Record<Status, { label: string; tone: 'accent' | 'danger' | 'neutral' | 'warning' }> = {
  scheduled: { label: 'Prévu', tone: 'accent' }, live: { label: 'En cours', tone: 'danger' }, ended: { label: 'Terminé', tone: 'neutral' }, cancelled: { label: 'Annulé', tone: 'warning' },
}
const REMINDERS = [[1440, '1 jour'], [180, '3 h'], [60, '1 h'], [30, '30 min'], [10, '10 min']] as const
const toInput = (at: number) => new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const dayLabel = (at: number) => new Date(at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const time = (at: number) => new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function RpEventsPage() {
  const { can } = useMe()
  const manage = can('rpevents.manage')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['rp-events'], queryFn: () => api<Data>('/rp-events'), refetchInterval: 30_000 })
  const [editing, setEditing] = useState<Partial<RpEvent> | null>(null)
  const [participants, setParticipants] = useState<RpEvent | null>(null)
  const [cancelling, setCancelling] = useState<RpEvent | null>(null)
  const [deleting, setDeleting] = useState<RpEvent | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['rp-events'] })
  const cancel = useMutation({ mutationFn: (e: RpEvent) => api(`/rp-events/${e.id}/cancel`, { method: 'POST', body: { confirm: true } }), onSuccess: () => { toast.success('Événement annulé, les inscrits sont prévenus'); setCancelling(null); refresh() } })
  const remove = useMutation({ mutationFn: (e: RpEvent) => api(`/rp-events/${e.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Événement supprimé'); setDeleting(null); refresh() } })

  const upcoming = (data?.events ?? []).filter((e) => e.status === 'scheduled' || e.status === 'live').sort((a, b) => a.startsAt - b.startsAt)
  const past = (data?.events ?? []).filter((e) => e.status === 'ended' || e.status === 'cancelled')
  // Upcoming events grouped by day
  const days = upcoming.reduce<Record<string, RpEvent[]>>((acc, e) => { (acc[dayLabel(e.startsAt)] ??= []).push(e); return acc }, {})

  const card = (e: RpEvent) => (
    <li key={e.id} className='lift flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3'>
      <div className='relative size-16 shrink-0 overflow-hidden rounded-md bg-muted'>
        {e.image ? <img src={imageUrl(e.image) ?? undefined} alt='' className='size-full object-cover' /> : <CalendarDays className='m-auto mt-5 size-6 text-muted-foreground' />}
        {e.status === 'live' && <span className='live-dot absolute end-1 top-1' aria-label='En cours' />}
      </div>
      <div className='min-w-52 flex-1'>
        <div className='flex flex-wrap items-center gap-2'><span className='font-display text-base font-semibold'>{e.title}</span><Pill tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Pill></div>
        <div className='flex flex-wrap gap-x-3 text-xs text-muted-foreground'>
          <span className='flex items-center gap-1'><Clock className='size-3' />{time(e.startsAt)} – {time(e.endsAt)}</span>
          {e.location && <span className='flex items-center gap-1'><MapPin className='size-3' />{e.location}</span>}
          <span className='flex items-center gap-1'><Users className='size-3' />{e.counts.going}{e.capacity ? `/${e.capacity}` : ''} inscrits{e.counts.maybe ? ` · ${e.counts.maybe} peut-être` : ''}{e.counts.waitlist ? ` · ${e.counts.waitlist} en attente` : ''}</span>
        </div>
        {e.capacity && <div className='mt-1.5 h-1 max-w-60 overflow-hidden rounded-full bg-muted'><div className={cn('h-full rounded-full transition-[width] duration-700', e.counts.going >= e.capacity ? 'bg-destructive' : 'bg-brand')} style={{ width: `${Math.min(100, (e.counts.going / e.capacity) * 100)}%` }} /></div>}
      </div>
      <div className='flex gap-1'>
        <Button size='sm' variant='outline' onClick={() => setParticipants(e)}><Users /> Inscrits</Button>
        {manage && (e.status === 'scheduled' || e.status === 'live') && <Button size='icon' variant='ghost' aria-label={`Modifier ${e.title}`} onClick={() => setEditing(e)}><Pencil /></Button>}
        {manage && (e.status === 'scheduled' || e.status === 'live') && <Button size='icon' variant='ghost' className='text-warning' aria-label={`Annuler ${e.title}`} onClick={() => setCancelling(e)}><Ban /></Button>}
        {manage && <DuplicateButton name={e.title} onClick={() => setEditing(copyOf(e, 'title', ['status', 'startsAt', 'messageId'] as (keyof typeof e)[]))} />}
        {manage && <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${e.title}`} onClick={() => setDeleting(e)}><Trash2 /></Button>}
      </div>
    </li>
  )

  return (
    <Page
      title='Événements RP'
      description='Planifie tes soirées et animations : le bot les annonce, les membres s’inscrivent avec des boutons (avec liste d’attente si c’est complet), reçoivent un rappel en MP et un rôle pendant l’événement.'
      actions={manage && <Button onClick={() => setEditing({})}><CalendarPlus /> Nouvel événement</Button>}
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid gap-6'>
          <StatCards className='lg:grid-cols-3' items={[
            { label: 'À venir', value: upcoming.length, icon: CalendarDays, tone: 'accent' },
            { label: 'Inscrits aux prochains', value: upcoming.reduce((n, e) => n + e.counts.going, 0), icon: Users, tone: 'success' },
            { label: 'Événements passés', value: past.filter((e) => e.status === 'ended').length, icon: Clock, tone: 'info' },
          ]} />
          <Tabs defaultValue='upcoming'>
            <TabsList><TabsTrigger value='upcoming'>À venir ({upcoming.length})</TabsTrigger><TabsTrigger value='past'>Passés</TabsTrigger></TabsList>
            <TabsContent value='upcoming' className='mt-4 grid gap-5'>
              {!upcoming.length ? <Section title='Planning'><EmptyState title='Rien de prévu' icon={CalendarDays}>Crée un événement : course, soirée, braquage organisé, réunion…</EmptyState></Section> : Object.entries(days).map(([day, list]) => (
                <section key={day} className='grid gap-2'>
                  <h2 className='kicker'>{day}</h2>
                  <ul className='stagger grid gap-2'>{list.map(card)}</ul>
                </section>
              ))}
            </TabsContent>
            <TabsContent value='past' className='mt-4'>
              {!past.length ? <EmptyState title='Aucun événement passé' /> : <ul className='grid gap-2'>{past.map(card)}</ul>}
            </TabsContent>
          </Tabs>
        </div>
      )}
      {editing && data && <EventDialog initial={editing} data={data} onClose={() => { setEditing(null); refresh() }} />}
      {participants && <ParticipantsDialog event={participants} onClose={() => setParticipants(null)} />}
      <ConfirmDialog open={Boolean(cancelling)} onOpenChange={(o) => !o && setCancelling(null)} title={`Annuler « ${cancelling?.title} » ?`} desc='Le message devient « Annulé » et les inscrits sont prévenus en MP.' confirmText='Annuler l’événement' destructive isLoading={cancel.isPending} handleConfirm={() => cancelling && cancel.mutate(cancelling)} />
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Supprimer « ${deleting?.title} » ?`} desc='Ses messages sont retirés de Discord, avec les inscriptions.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </Page>
  )
}

function ParticipantsDialog({ event, onClose }: { event: RpEvent; onClose: () => void }) {
  type P = { userId: string; status: 'going' | 'maybe' | 'waitlist'; at: number; user: { name: string | null; avatar: string | null } | null }
  const { data } = useQuery({ queryKey: ['rp-event-participants', event.id], queryFn: () => api<P[]>(`/rp-events/${event.id}/participants`) })
  const groups = [['going', 'Participants'], ['waitlist', 'Liste d’attente'], ['maybe', 'Peut-être']] as const
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[85svh] overflow-y-auto'>
        <DialogHeader><DialogTitle>Inscrits · {event.title}</DialogTitle></DialogHeader>
        {!data ? <Skeleton className='h-40' /> : !data.length ? <EmptyState title='Personne pour l’instant' /> : groups.map(([status, label]) => {
          const list = data.filter((p) => p.status === status)
          if (!list.length) return null
          return (
            <div key={status} className='grid gap-2'>
              <h3 className='kicker'>{label} ({list.length})</h3>
              <ul className='grid gap-1.5'>
                {list.map((p) => <li key={p.userId} className='flex items-center gap-2 text-sm'><UserAvatar src={p.user?.avatar} name={p.user?.name ?? p.userId} className='size-6' />{p.user?.name ?? p.userId}</li>)}
              </ul>
            </div>
          )
        })}
      </DialogContent>
    </Dialog>
  )
}

function EventDialog({ initial, data, onClose }: { initial: Partial<RpEvent>; data: Data; onClose: () => void }) {
  const [start] = useState(() => initial.startsAt ?? Math.ceil((Date.now() + 86_400_000) / 3_600_000) * 3_600_000)
  const [e, setE] = useState({
    title: initial.title ?? '', description: initial.description ?? '', image: initial.image ?? null, location: initial.location ?? '',
    startsAt: toInput(start), endsAt: toInput(initial.endsAt ?? start + 2 * 3_600_000),
    capacity: initial.capacity ? String(initial.capacity) : '', allowMaybe: initial.allowMaybe ?? true,
    reminders: initial.reminders ?? [60], targets: initial.targets ?? [], roles: initial.roles ?? {},
  })
  const set = (patch: Partial<typeof e>) => setE({ ...e, ...patch })
  const save = useMutation({
    mutationFn: () => {
      const body = { ...e, startsAt: new Date(e.startsAt).getTime(), endsAt: new Date(e.endsAt).getTime(), capacity: e.capacity ? Number(e.capacity) : null }
      return initial.id ? api(`/rp-events/${initial.id}`, { method: 'PUT', body }) : api('/rp-events', { method: 'POST', body })
    },
    onSuccess: () => { toast.success(initial.id ? 'Événement mis à jour' : 'Événement annoncé'); onClose() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[94svh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader><DialogTitle>{initial.id ? `Modifier ${initial.title}` : 'Nouvel événement'}</DialogTitle></DialogHeader>
        <Tabs defaultValue='infos'>
          <TabsList><TabsTrigger value='infos'>Infos</TabsTrigger><TabsTrigger value='where'>Salons ({e.targets.length})</TabsTrigger><TabsTrigger value='options'>Inscriptions</TabsTrigger></TabsList>
          <TabsContent value='infos' className='mt-4 grid gap-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'><Label htmlFor='ev-title'>Titre</Label><Input id='ev-title' value={e.title} maxLength={100} onChange={(x) => set({ title: x.target.value })} placeholder='Course de rue au port' /></div>
              <div className='grid gap-1.5'><Label htmlFor='ev-loc'>Lieu (en jeu)</Label><Input id='ev-loc' value={e.location} maxLength={200} onChange={(x) => set({ location: x.target.value })} placeholder='Port de Los Santos' /></div>
              <div className='grid gap-1.5'><Label htmlFor='ev-start'>Début</Label><Input id='ev-start' type='datetime-local' value={e.startsAt} onChange={(x) => set({ startsAt: x.target.value })} /></div>
              <div className='grid gap-1.5'><Label htmlFor='ev-end'>Fin</Label><Input id='ev-end' type='datetime-local' value={e.endsAt} onChange={(x) => set({ endsAt: x.target.value })} /></div>
            </div>
            <div className='grid gap-1.5'><Label htmlFor='ev-desc'>Description</Label><Textarea id='ev-desc' rows={4} maxLength={2000} value={e.description} onChange={(x) => set({ description: x.target.value })} placeholder='Règles, véhicules autorisés, récompenses…' /></div>
            <div className='grid gap-1.5'><Label htmlFor='ev-img'>Image</Label><ImageInput id='ev-img' value={e.image} onChange={(image) => set({ image })} /></div>
          </TabsContent>
          <TabsContent value='where' className='mt-4'>
            <TargetsEditor guilds={data.guilds} targets={e.targets} onChange={(targets) => set({ targets })} disabled={false} />
          </TabsContent>
          <TabsContent value='options' className='mt-4 grid gap-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'><Label htmlFor='ev-cap'>Places (vide = illimité)</Label><Input id='ev-cap' type='number' min={1} value={e.capacity} onChange={(x) => set({ capacity: x.target.value })} /></div>
              <label className='flex items-end gap-2 pb-2 text-sm'><Switch checked={e.allowMaybe} onCheckedChange={(allowMaybe) => set({ allowMaybe })} /> Proposer « Peut-être »</label>
            </div>
            <div className='grid gap-2'>
              <Label>Rappels en MP avant le début</Label>
              <div className='flex flex-wrap gap-2' role='group' aria-label='Rappels'>
                {REMINDERS.map(([m, label]) => {
                  const on = e.reminders.includes(m)
                  return <button key={m} type='button' aria-pressed={on} onClick={() => set({ reminders: on ? e.reminders.filter((x) => x !== m) : [...e.reminders, m] })} className={cn('rounded-full border px-3 py-1 text-sm transition-colors', on ? 'border-brand bg-brand/15 text-primary' : 'hover:bg-accent')}>{label}</button>
                })}
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Rôle donné aux participants pendant l’événement</Label>
              <div className='grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2'>
                {data.guilds.filter((g) => e.targets.some((t) => t.guildId === g.id)).map((g) => (
                  <div key={g.id} className='grid min-w-0 gap-1'>
                    <span className='truncate text-xs text-muted-foreground'>{g.name}</span>
                    <Select value={e.roles[g.id] ?? 'none'} onValueChange={(v) => { const roles = { ...e.roles }; if (v === 'none') delete roles[g.id]; else roles[g.id] = v; set({ roles }) }}>
                      <SelectTrigger aria-label={`Rôle participant sur ${g.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value='none'>Aucun</SelectItem>{g.roles.filter((r) => (r as { editable?: boolean }).editable !== false).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ))}
                {!e.targets.length && <p className='text-sm text-muted-foreground'>Choisis d’abord les salons d’annonce.</p>}
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} disabled={!e.title.trim() || !e.targets.length} onClick={() => save.mutate()}><Save /> {initial.id ? 'Mettre à jour' : 'Annoncer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
