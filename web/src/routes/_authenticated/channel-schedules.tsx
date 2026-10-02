import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarPlus, Clock, Lock, LockOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel } from '@/lib/types'
import { cn, copyOf } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, GuildIcon } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toLocalInput } from '@/features/announcements/schedule-editor'
import { DuplicateButton } from '@/components/app/duplicate-button'

export const Route = createFileRoute('/_authenticated/channel-schedules')({
  component: SchedulesPage,
})

type Slot = { days: number[]; from: string; to: string }
type Period = { from: number; to: number; label: string }
type Schedule = {
  id: number; guildId: string; name: string; channelIds: string[]; mode: 'open_during' | 'closed_during'; lockType: 'write' | 'hide'
  weekly: Slot[]; dates: Period[]; announce: boolean; enabled: boolean; state: 'open' | 'closed'; next: { at: number; state: 'open' | 'closed' } | null
}
type GuildData = { id: string; name: string; icon: string | null; channels: (Channel & { voice?: boolean })[] }
type Draft = Omit<Schedule, 'id' | 'state' | 'next'> & { id?: number }

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const DAY_VALUE = [1, 2, 3, 4, 5, 6, 0]
const LONG_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function describeSlot(s: Slot) {
  const days = s.days.length === 7 ? 'Tous les jours' : s.days.length === 5 && !s.days.includes(0) && !s.days.includes(6) ? 'En semaine' : s.days.length === 2 && s.days.includes(0) && s.days.includes(6) ? 'Le week-end' : [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => LONG_DAYS[d]).join(', ')
  return `${days}, ${s.from} → ${s.to}${s.to <= s.from ? ' (lendemain)' : ''}`
}

function SchedulesPage() {
  const { can } = useMe()
  const manage = can('schedules.manage')
  const { data, isLoading } = useQuery({ queryKey: ['channel-schedules'], queryFn: () => api<{ schedules: Schedule[]; guilds: GuildData[] }>('/channel-schedules'), refetchInterval: 30_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const guild = data?.guilds.find((g) => g.id === selected) ?? data?.guilds[0]
  const list = data?.schedules.filter((s) => s.guildId === guild?.id) ?? []
  const fresh = (): Draft => ({ guildId: guild!.id, name: '', channelIds: [], mode: 'open_during', lockType: 'write', weekly: [{ days: [5, 6], from: '20:00', to: '23:59' }], dates: [], announce: true, enabled: true })

  return (
    <Page
      title='Horaires des salons'
      description='Ouvre ou ferme des salons tout seuls : chaque semaine à heures fixes, et à des dates précises (soirée, vacances, événement). Fermé = @everyone ne peut plus écrire (ou ne voit plus le salon).'
      actions={manage && guild && <Button onClick={() => setEditing(fresh())}><Plus /> Nouvel horaire</Button>}
    >
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && guild && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {data.guilds.length > 1 && (
            <nav aria-label='Serveurs' className='flex gap-2 overflow-x-auto pb-1'>
              {data.guilds.map((g) => (
                <button key={g.id} type='button' onClick={() => setSelected(g.id)} aria-current={g.id === guild.id ? 'page' : undefined} className='flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:bg-primary/10'>
                  <GuildIcon src={g.icon} name={g.name} className='size-5' />{g.name}
                </button>
              ))}
            </nav>
          )}
          {!list.length ? <Section title='Horaires'><EmptyState title='Aucun horaire' icon={CalendarClock}>Par exemple : salon « events » ouvert le vendredi et le samedi de 20 h à 2 h, et fermé du 24 au 26 décembre.</EmptyState></Section> : (
            <div className='stagger grid gap-4 lg:grid-cols-2'>
              {list.map((s) => <ScheduleCard key={s.id} schedule={s} guild={guild} manage={manage} onEdit={() => setEditing({ ...s })} onDuplicate={() => setEditing(copyOf(s, 'name'))} />)}
            </div>
          )}
        </div>
      )}
      {editing && guild && <Editor key={editing.id ?? 'new'} draft={editing} guild={guild} onClose={() => setEditing(null)} />}
    </Page>
  )
}

function ScheduleCard({ schedule: s, guild, manage, onEdit, onDuplicate }: { schedule: Schedule; guild: GuildData; manage: boolean; onEdit: () => void; onDuplicate: () => void }) {
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const remove = useMutation({ mutationFn: () => api(`/channel-schedules/${s.id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Horaire supprimé, salons rouverts'); qc.invalidateQueries({ queryKey: ['channel-schedules'] }) } })
  const open = s.state === 'open'
  return (
    <section className='lift grid gap-3 rounded-xl border bg-card p-4'>
      <div className='flex flex-wrap items-start gap-3'>
        <span className={cn('grid size-10 place-items-center rounded-lg', !s.enabled ? 'bg-muted text-muted-foreground' : open ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')}>{open ? <LockOpen className='size-5' /> : <Lock className='size-5' />}</span>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'><h3 className='font-display text-lg font-semibold'>{s.name}</h3>{!s.enabled ? <Pill tone='neutral'>En pause</Pill> : <Pill tone={open ? 'success' : 'danger'}>{open ? 'Ouvert' : 'Fermé'}</Pill>}</div>
          <p className='text-sm text-muted-foreground'>{s.next && s.enabled ? <>{s.next.state === 'open' ? 'Ouvre' : 'Ferme'} le {dateTime(s.next.at)}</> : 'Pas de changement prévu'}</p>
        </div>
        {manage && <div className='flex gap-1'><Button size='icon' variant='ghost' aria-label={`Modifier ${s.name}`} onClick={onEdit}><Pencil /></Button><DuplicateButton name={s.name} onClick={onDuplicate} /><Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${s.name}`} onClick={() => setDeleting(true)}><Trash2 /></Button></div>}
      </div>
      <div className='flex flex-wrap gap-1'>{s.channelIds.map((id) => { const c = guild.channels.find((x) => x.id === id); return <Pill key={id} tone='neutral'>{c?.voice ? '🔊' : '#'}{c?.name ?? 'supprimé'}</Pill> })}</div>
      <ul className='grid gap-1 text-sm'>
        <li className='text-xs font-medium text-muted-foreground'>{s.mode === 'open_during' ? 'Ouvert pendant :' : 'Fermé pendant :'} {s.lockType === 'hide' ? '(salon caché quand fermé)' : '(écriture bloquée quand fermé)'}</li>
        {s.weekly.map((w, i) => <li key={`w${i}`} className='flex items-center gap-2'><Clock className='size-3.5 text-muted-foreground' />{describeSlot(w)}</li>)}
        {s.dates.map((d, i) => <li key={`d${i}`} className='flex items-center gap-2'><CalendarPlus className='size-3.5 text-muted-foreground' />{d.label ? <strong>{d.label} :</strong> : null} du {dateTime(d.from)} au {dateTime(d.to)}</li>)}
      </ul>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Supprimer « ${s.name} » ?`} desc='Les salons fermés par cet horaire sont rouverts.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </section>
  )
}

function Editor({ draft, guild, onClose }: { draft: Draft; guild: GuildData; onClose: () => void }) {
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(draft)
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))
  const setSlot = (i: number, patch: Partial<Slot>) => set({ weekly: d.weekly.map((w, j) => (j === i ? { ...w, ...patch } : w)) })
  const setPeriod = (i: number, patch: Partial<Period>) => set({ dates: d.dates.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const save = useMutation({
    mutationFn: () => api('/channel-schedules', { method: 'PUT', body: d }),
    onSuccess: () => { toast.success('Horaire enregistré'); qc.invalidateQueries({ queryKey: ['channel-schedules'] }); onClose() },
  })
  const [hour] = useState(() => Date.now())
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{d.id ? 'Modifier l’horaire' : 'Nouvel horaire'}</DialogTitle>
          <DialogDescription>Heures de Paris. Un créneau qui finit avant son début continue le lendemain (20:00 → 02:00).</DialogDescription>
        </DialogHeader>
        <div className='grid gap-5'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'><Label htmlFor='s-name'>Nom</Label><Input id='s-name' value={d.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder='Soirées event' /></div>
            <div className='grid gap-1.5'>
              <Label>Les salons sont…</Label>
              <Select value={d.mode} onValueChange={(mode) => set({ mode: mode as Draft['mode'] })}>
                <SelectTrigger aria-label='Mode'><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='open_during'>Ouverts pendant les créneaux</SelectItem><SelectItem value='closed_during'>Fermés pendant les créneaux</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className='grid gap-2'>
            <Label>Salons</Label>
            <div className='grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2'>
              {guild.channels.map((c) => (
                <label key={c.id} className='flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/40'>
                  <Checkbox checked={d.channelIds.includes(c.id)} onCheckedChange={(on) => set({ channelIds: on ? [...d.channelIds, c.id] : d.channelIds.filter((x) => x !== c.id) })} />
                  <span className='truncate'>{c.voice ? '🔊' : '#'}{c.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className='grid gap-2'>
            <div className='flex items-center justify-between'><Label>Chaque semaine</Label><Button size='sm' variant='ghost' onClick={() => set({ weekly: [...d.weekly, { days: [1, 2, 3, 4, 5], from: '18:00', to: '23:00' }] })}><Plus /> Créneau</Button></div>
            {d.weekly.map((w, i) => (
              <div key={i} className='flex flex-wrap items-center gap-2 rounded-lg border p-2'>
                <div className='flex gap-1' role='group' aria-label='Jours'>
                  {DAYS.map((label, k) => {
                    const value = DAY_VALUE[k]
                    const on = w.days.includes(value)
                    return <button key={label} type='button' aria-pressed={on} onClick={() => setSlot(i, { days: on ? w.days.filter((x) => x !== value) : [...w.days, value] })} className={cn('h-8 w-10 rounded-md border text-xs', on ? 'border-primary bg-primary/15 text-primary' : 'text-muted-foreground')}>{label}</button>
                  })}
                </div>
                <Input type='time' aria-label='Début' value={w.from} onChange={(e) => setSlot(i, { from: e.target.value })} className='h-8 w-28' />
                <span className='text-muted-foreground'>→</span>
                <Input type='time' aria-label='Fin' value={w.to} onChange={(e) => setSlot(i, { to: e.target.value })} className='h-8 w-28' />
                <Button size='icon' variant='danger-ghost' className='ms-auto size-8' aria-label='Retirer le créneau' onClick={() => set({ weekly: d.weekly.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            ))}
          </div>

          <div className='grid gap-2'>
            <div className='flex items-center justify-between'><Label>Dates précises</Label><Button size='sm' variant='ghost' onClick={() => set({ dates: [...d.dates, { from: hour + 86_400_000, to: hour + 2 * 86_400_000, label: '' }] })}><CalendarPlus /> Période</Button></div>
            {d.dates.map((p, i) => (
              <div key={i} className='grid gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center'>
                <Input aria-label='Nom de la période' value={p.label} maxLength={60} placeholder='Soirée Halloween' onChange={(e) => setPeriod(i, { label: e.target.value })} className='h-8' />
                <Input type='datetime-local' aria-label='Début' value={toLocalInput(p.from)} onChange={(e) => setPeriod(i, { from: new Date(e.target.value).getTime() })} className='h-8' />
                <Input type='datetime-local' aria-label='Fin' value={toLocalInput(p.to)} onChange={(e) => setPeriod(i, { to: new Date(e.target.value).getTime() })} className='h-8' />
                <Button size='icon' variant='danger-ghost' className='size-8' aria-label='Retirer la période' onClick={() => set({ dates: d.dates.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            ))}
            <p className='text-xs text-muted-foreground'>Une date précise compte comme un créneau : avec « ouverts pendant les créneaux », le salon s’ouvre aussi pendant ces périodes.</p>
          </div>

          <div className='grid gap-3'>
            <div className='grid gap-1.5 sm:max-w-xs'>
              <Label>Quand c’est fermé</Label>
              <Select value={d.lockType} onValueChange={(lockType) => set({ lockType: lockType as Draft['lockType'] })}>
                <SelectTrigger aria-label='Fermeture'><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='write'>Lecture seule</SelectItem><SelectItem value='hide'>Salon caché</SelectItem></SelectContent>
              </Select>
            </div>
            <p className='-mt-1 text-xs text-muted-foreground'>Lecture seule : plus d’écriture, de réactions ni de connexion en vocal pour @everyone.</p>
            <div className='grid gap-2'>
              <label className='flex items-center gap-2 text-sm'><Switch checked={d.announce} onCheckedChange={(announce) => set({ announce })} /> Message « ouvert / fermé jusqu’à… » dans le salon</label>
              <label className='flex items-center gap-2 text-sm'><Switch checked={d.enabled} onCheckedChange={(enabled) => set({ enabled })} /> Actif</label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} disabled={!d.name.trim() || !d.channelIds.length || (!d.weekly.length && !d.dates.length)} onClick={() => save.mutate()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
