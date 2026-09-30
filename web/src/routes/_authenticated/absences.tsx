import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarOff, CalendarPlus, Check, Hourglass, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, Role } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { UserPicker } from '@/components/app/user-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_authenticated/absences')({
  component: AbsencesPage,
})

type Status = 'pending' | 'approved' | 'active' | 'ended' | 'rejected' | 'cancelled'
type Person = { name: string | null; avatar: string | null } | null
type Absence = {
  id: number; userId: string; startAt: number; endAt: number; reason: string | null; status: Status; declaredBy: string; reviewedBy: string | null
  names: { userId: Person; declaredBy: Person; reviewedBy: Person }
}
type Config = { requireApproval: boolean; roleByGuild: Record<string, string>; nicknamePrefix: string; announce: { guildId: string; channelId: string } | null; remindBeforeEnd: boolean }
type Payload = { absences: Absence[]; config: Config; guilds: { id: string; name: string }[]; roles: Record<string, Role[]>; channels: Record<string, Channel[]> }

const STATUS: Record<Status, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  pending: { label: 'En attente', tone: 'warning' },
  approved: { label: 'Prévue', tone: 'accent' },
  active: { label: 'En cours', tone: 'success' },
  ended: { label: 'Terminée', tone: 'neutral' },
  rejected: { label: 'Refusée', tone: 'danger' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
}

// datetime-local value <-> timestamp
const toInput = (at: number) => { const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) }
const fromInput = (v: string) => new Date(v).getTime()

function AbsencesPage() {
  const { can, me } = useMe()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['absences'], queryFn: () => api<Payload>('/absences'), refetchInterval: 30_000 })
  const [declaring, setDeclaring] = useState(false)
  const [extending, setExtending] = useState<Absence | null>(null)
  const [filter, setFilter] = useState<'current' | 'all'>('current')
  const manage = can('absences.manage')
  const refresh = () => qc.invalidateQueries({ queryKey: ['absences'] })
  const review = useMutation({ mutationFn: ({ id, approved }: { id: number; approved: boolean }) => api(`/absences/${id}/review`, { method: 'POST', body: { approved } }), onSuccess: (_, v) => { toast.success(v.approved ? 'Absence validée' : 'Absence refusée'); refresh() } })
  const end = useMutation({ mutationFn: (id: number) => api(`/absences/${id}/end`, { method: 'POST' }), onSuccess: () => { toast.success('Absence terminée'); refresh() } })
  const list = data?.absences.filter((a) => filter === 'all' || ['pending', 'approved', 'active'].includes(a.status)) ?? []
  const mine = (a: Absence) => a.userId === me?.user.id
  return (
    <Page
      title='Absences'
      description='Chaque membre du staff déclare ses absences ; pendant qu’elles durent, le bot pose un rôle et un préfixe de pseudo sur tous les serveurs, puis les retire au retour.'
      actions={(can('absences.declare') || manage) && <Button onClick={() => setDeclaring(true)}><CalendarPlus /> Déclarer une absence</Button>}
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid gap-6'>
          <StatCards className='lg:grid-cols-3' items={[
            { label: 'Absents en ce moment', value: data.absences.filter((a) => a.status === 'active').length, icon: CalendarOff, tone: 'info' },
            { label: 'Absences prévues', value: data.absences.filter((a) => a.status === 'approved').length, icon: CalendarClock, tone: 'accent' },
            { label: 'À valider', value: data.absences.filter((a) => a.status === 'pending').length, icon: Hourglass, tone: data.absences.some((a) => a.status === 'pending') ? 'warning' : 'neutral' },
          ]} />
          <Section
            title={filter === 'current' ? 'En cours et à venir' : 'Historique'}
            actions={
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger className='w-44'><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='current'>En cours et à venir</SelectItem><SelectItem value='all'>Toutes</SelectItem></SelectContent>
              </Select>
            }
          >
            {!list.length ? <EmptyState title='Personne n’est absent'>Les absences déclarées apparaîtront ici.</EmptyState> : (
              <ul className='divide-y'>
                {list.map((a) => (
                  <li key={a.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                    <UserAvatar src={a.names.userId?.avatar} name={a.names.userId?.name ?? a.userId} />
                    <div className='min-w-48 flex-1'>
                      <div className='flex flex-wrap items-center gap-2 font-medium'>{a.names.userId?.name ?? a.userId}<Pill tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Pill></div>
                      <div className='text-xs text-muted-foreground'>Du {dateTime(a.startAt)} au {dateTime(a.endAt)}{a.reason ? ` · ${a.reason}` : ''}</div>
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      {a.status === 'pending' && manage && !mine(a) && (
                        <>
                          <Button size='sm' variant='success-outline' onClick={() => review.mutate({ id: a.id, approved: true })}><Check /> Valider</Button>
                          <Button size='sm' variant='danger-outline' onClick={() => review.mutate({ id: a.id, approved: false })}><X /> Refuser</Button>
                        </>
                      )}
                      {['pending', 'approved', 'active'].includes(a.status) && (manage || mine(a)) && (
                        <>
                          <Button size='sm' variant='outline' onClick={() => setExtending(a)}>Prolonger</Button>
                          <Button size='sm' variant='ghost' onClick={() => end.mutate(a.id)}>{a.status === 'active' ? 'Signaler le retour' : 'Annuler'}</Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {manage && <Settings key={JSON.stringify(data.config)} data={data} />}
        </div>
      )}
      {declaring && <DeclareDialog canForOthers={manage} onClose={() => { setDeclaring(false); refresh() }} />}
      {extending && <ExtendDialog absence={extending} onClose={() => { setExtending(null); refresh() }} />}
    </Page>
  )
}

function DeclareDialog({ canForOthers, onClose }: { canForOthers: boolean; onClose: () => void }) {
  const [start] = useState(() => Date.now())
  const [userId, setUserId] = useState('')
  const [startAt, setStartAt] = useState(toInput(start))
  const [endAt, setEndAt] = useState(toInput(start + 3 * 86_400_000))
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: () => api('/absences', { method: 'POST', body: { ...(userId ? { userId } : {}), startAt: fromInput(startAt), endAt: fromInput(endAt), reason } }),
    onSuccess: () => { toast.success('Absence déclarée'); onClose() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Déclarer une absence</DialogTitle></DialogHeader>
        <div className='grid gap-4'>
          {canForOthers && <div className='grid gap-1.5'><Label>Pour un autre membre (facultatif)</Label><UserPicker value={userId} onChange={(id) => setUserId(id)} placeholder='Moi-même' /></div>}
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'><Label htmlFor='abs-start'>Début</Label><Input id='abs-start' type='datetime-local' value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div>
            <div className='grid gap-1.5'><Label htmlFor='abs-end'>Retour</Label><Input id='abs-end' type='datetime-local' value={endAt} onChange={(e) => setEndAt(e.target.value)} /></div>
          </div>
          <div className='grid gap-1.5'><Label htmlFor='abs-reason'>Raison (facultatif)</Label><Input id='abs-reason' maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Vacances, examens…' /></div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={!startAt || !endAt || save.isPending}><CalendarPlus /> Déclarer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExtendDialog({ absence, onClose }: { absence: Absence; onClose: () => void }) {
  const [endAt, setEndAt] = useState(toInput(absence.endAt + 86_400_000))
  const save = useMutation({ mutationFn: () => api(`/absences/${absence.id}/extend`, { method: 'POST', body: { endAt: fromInput(endAt) } }), onSuccess: () => { toast.success('Absence prolongée'); onClose() } })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Prolonger l’absence</DialogTitle></DialogHeader>
        <div className='grid gap-1.5'><Label htmlFor='abs-extend'>Nouvelle date de retour</Label><Input id='abs-extend' type='datetime-local' value={endAt} onChange={(e) => setEndAt(e.target.value)} /></div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}><Save /> Prolonger</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Settings({ data }: { data: Payload }) {
  const qc = useQueryClient()
  const [c, setC] = useState(data.config)
  const save = useMutation({ mutationFn: () => api('/absences/config', { method: 'PUT', body: c }), onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['absences'] }) } })
  const [announceGuild, setAnnounceGuild] = useState(c.announce?.guildId ?? data.guilds[0]?.id)
  return (
    <Section title='Réglages' actions={<Button size='sm' onClick={() => save.mutate()} disabled={save.isPending}><Save /> Enregistrer</Button>}>
      <div className='grid gap-5 p-4'>
        <div className='flex flex-wrap gap-6'>
          <label className='flex items-center gap-2 text-sm'><Switch checked={c.requireApproval} onCheckedChange={(v) => setC({ ...c, requireApproval: v })} /> Validation par un rang supérieur</label>
          <label className='flex items-center gap-2 text-sm'><Switch checked={c.remindBeforeEnd} onCheckedChange={(v) => setC({ ...c, remindBeforeEnd: v })} /> Rappel en MP la veille du retour</label>
        </div>
        <div className='grid gap-1.5 sm:max-w-xs'><Label htmlFor='abs-prefix'>Préfixe de pseudo pendant l’absence</Label><Input id='abs-prefix' maxLength={10} value={c.nicknamePrefix} onChange={(e) => setC({ ...c, nicknamePrefix: e.target.value })} placeholder='[ABS]' /></div>
        <div className='grid gap-2'>
          <Label>Rôle « absent » par serveur</Label>
          <div className='grid gap-3 sm:grid-cols-2'>
            {data.guilds.map((g) => (
              <div key={g.id} className='grid min-w-0 gap-1'>
                <span className='truncate text-xs text-muted-foreground'>{g.name}</span>
                <Select value={c.roleByGuild[g.id] ?? 'none'} onValueChange={(v) => { const roleByGuild = { ...c.roleByGuild }; if (v === 'none') delete roleByGuild[g.id]; else roleByGuild[g.id] = v; setC({ ...c, roleByGuild }) }}>
                  <SelectTrigger aria-label={`Rôle absent sur ${g.name}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value='none'>Aucun</SelectItem>{(data.roles[g.id] ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
        <div className='grid gap-2'>
          <Label>Annonce des départs et retours</Label>
          <div className='grid gap-3 sm:grid-cols-2'>
            <Select value={announceGuild} onValueChange={(v) => { setAnnounceGuild(v); setC({ ...c, announce: null }) }}>
              <SelectTrigger aria-label='Serveur de l’annonce'><SelectValue /></SelectTrigger>
              <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
            <ChannelSelect channels={data.channels[announceGuild ?? ''] ?? []} value={c.announce?.channelId ?? null} onChange={(v) => setC({ ...c, announce: v && announceGuild ? { guildId: announceGuild, channelId: v } : null })} label='Salon de l’annonce' noneLabel='Pas d’annonce' />
          </div>
        </div>
      </div>
    </Section>
  )
}
