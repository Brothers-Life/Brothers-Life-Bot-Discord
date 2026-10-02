import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, Inbox, MessageSquarePlus, MessagesSquare, Plus, Save, Send, ThumbsDown, ThumbsUp, Trash2, Minus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, FormDef, Guild, RankSummary, Role } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar, GuildIcon } from '@/components/app/ui'
import { CategorySelect, ChannelSelect, RolesPicker } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormBuilder } from '@/features/forms/form-builder'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { VariableButton } from '@/components/app/variable-picker'

export const Route = createFileRoute('/_authenticated/recruitment')({
  component: RecruitmentPage,
})

type StatusKey = 'received' | 'review' | 'interview' | 'accepted' | 'rejected' | 'withdrawn'
type Position = {
  id: number; name: string; description: string; panelChannelId: string | null; panelMessageId: string | null
  config: {
    open: boolean; closesAt: number | null; form: FormDef; cooldownDays: number; reviewChannelId: string | null; pingRoleIds: string[]; acceptRoleIds: string[]
    acceptRankId: number | null; interviewCategoryId: string | null; interviewerRoleIds: string[]; dm: Record<string, string>
    requirements: { minAccountAgeDays: number; minMemberDays: number; noSanctionDays: number; requiredRoleIds: string[]; minMessages: number; activityDays: number }
  }
}
type Application = {
  id: number; positionId: number; userId: string; status: StatusKey; createdAt: number; score: { for: number; against: number; neutral: number }
  names: { userId: { name: string | null; avatar: string | null } | null }
}
type Detail = Application & {
  answers: { id: string; label: string; value: string }[]; history: { status: string; by: string; at: number; reason: string | null }[]
  notes: { by: string; at: number; text: string }[]; votes: { userId: string; vote: number; comment: string | null; at: number }[]; interviewChannelId: string | null
  names: Record<string, { name: string | null; avatar: string | null } | null>
}
type Payload = { positions: Position[]; applications: Application[]; statuses: Record<StatusKey, { label: string; emoji: string; color: string }>; channels: Channel[]; categories: { id: string; name: string }[]; roles: Role[]; ranks: RankSummary[] }

function RecruitmentPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id
  const currentGuild = active.find((g) => g.id === current)
  return (
    <Page
      title='Recrutement'
      description='Des postes avec leur propre formulaire et leurs conditions ; les candidatures arrivent dans un salon du staff, qui vote, discute, organise un entretien puis décide. Le candidat est prévenu à chaque étape.'
      actions={current && (
        <div className='flex items-center gap-2'>
          <Label htmlFor='rc-guild' className='text-muted-foreground'>Serveur</Label>
          <Select value={current} onValueChange={setGuildId}>
            <SelectTrigger id='rc-guild' className='w-60'><span className='flex items-center gap-2 truncate'>{currentGuild && <GuildIcon src={currentGuild.icon} name={currentGuild.name} className='size-5' />}<SelectValue /></span></SelectTrigger>
            <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      {current && <Recruitment key={current} guildId={current} />}
    </Page>
  )
}

function Recruitment({ guildId }: { guildId: string }) {
  const { data } = useQuery({ queryKey: ['recruitment', guildId], queryFn: () => api<Payload>(`/recruitment/${guildId}`), refetchInterval: 20_000 })
  const [status, setStatus] = useState<'open' | 'all' | StatusKey>('open')
  const [viewing, setViewing] = useState<number | null>(null)
  if (!data) return <Skeleton className='h-96 w-full' />
  const list = data.applications.filter((a) => (status === 'all' ? true : status === 'open' ? ['received', 'review', 'interview'].includes(a.status) : a.status === status))
  const positionName = (id: number) => data.positions.find((p) => p.id === id)?.name ?? 'Poste supprimé'
  return (
    <Tabs defaultValue='applications'>
      <TabsList>
        <TabsTrigger value='applications'>Candidatures</TabsTrigger>
        <TabsTrigger value='positions'>Postes ({data.positions.length})</TabsTrigger>
      </TabsList>
      <TabsContent value='applications' className='mt-4 grid gap-4'>
        <StatCards className='lg:grid-cols-3' items={[
          { label: 'À traiter', value: data.applications.filter((a) => ['received', 'review'].includes(a.status)).length, icon: Inbox, tone: 'warning' },
          { label: 'En entretien', value: data.applications.filter((a) => a.status === 'interview').length, icon: MessagesSquare, tone: 'info' },
          { label: 'Acceptées', value: data.applications.filter((a) => a.status === 'accepted').length, icon: CheckCircle2, tone: 'success' },
        ]} />
        <Section
          title={`${list.length} candidature${list.length > 1 ? 's' : ''}`}
          actions={
            <div className='flex gap-2'>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger className='w-44'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='open'>À traiter</SelectItem>
                  <SelectItem value='all'>Toutes</SelectItem>
                  {(Object.keys(data.statuses) as StatusKey[]).map((k) => <SelectItem key={k} value={k}>{data.statuses[k].emoji} {data.statuses[k].label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant='outline' size='sm' asChild><a href={`/api/recruitment/${guildId}/export`}><Download /> CSV</a></Button>
            </div>
          }
        >
          {!list.length ? <EmptyState title='Aucune candidature ici'>Publie le panneau d’un poste pour recevoir des candidatures.</EmptyState> : (
            <ul className='divide-y'>
              {list.map((a) => {
                const s = data.statuses[a.status]
                return (
                  <li key={a.id}>
                    <button type='button' onClick={() => setViewing(a.id)} className='flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/40'>
                      <UserAvatar src={a.names.userId?.avatar} name={a.names.userId?.name ?? a.userId} />
                      <div className='min-w-48 flex-1'>
                        <div className='flex flex-wrap items-center gap-2 font-medium'>{a.names.userId?.name ?? a.userId}<Pill style={{ color: s.color }}>{s.emoji} {s.label}</Pill></div>
                        <div className='text-xs text-muted-foreground'>{positionName(a.positionId)} · {ago(a.createdAt)}</div>
                      </div>
                      <span className='flex items-center gap-3 text-sm tabular-nums'>
                        <span className='flex items-center gap-1 text-success'><ThumbsUp className='size-3.5' />{a.score.for}</span>
                        <span className='flex items-center gap-1 text-muted-foreground'><Minus className='size-3.5' />{a.score.neutral}</span>
                        <span className='flex items-center gap-1 text-destructive'><ThumbsDown className='size-3.5' />{a.score.against}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
        {viewing !== null && <ApplicationDialog id={viewing} data={data} guildId={guildId} onClose={() => setViewing(null)} />}
      </TabsContent>
      <TabsContent value='positions' className='mt-4'><Positions data={data} guildId={guildId} /></TabsContent>
    </Tabs>
  )
}

function ApplicationDialog({ id, data, guildId, onClose }: { id: number; data: Payload; guildId: string; onClose: () => void }) {
  const { can, me } = useMe()
  const qc = useQueryClient()
  const key = ['application', id]
  const { data: a } = useQuery({ queryKey: key, queryFn: () => api<Detail>(`/recruitment/applications/${id}`) })
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['recruitment', guildId] }) }
  const vote = useMutation({ mutationFn: (v: number) => api(`/recruitment/applications/${id}/vote`, { method: 'POST', body: { vote: v } }), onSuccess: () => { toast.success('Vote enregistré'); refresh() } })
  const addNote = useMutation({ mutationFn: () => api(`/recruitment/applications/${id}/notes`, { method: 'POST', body: { text: note } }), onSuccess: () => { setNote(''); refresh() } })
  const decide = useMutation({ mutationFn: (status: string) => api(`/recruitment/applications/${id}/status`, { method: 'POST', body: { status, reason } }), onSuccess: () => { toast.success('Décision enregistrée, le candidat est prévenu'); setReason(''); refresh() } })
  const name = (userId: string) => a?.names[userId]?.name ?? userId
  const open = a && ['received', 'review', 'interview'].includes(a.status)
  const myVote = a?.votes.find((v) => v.userId === me?.user.id)?.vote
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-3xl'>
        {!a ? <Skeleton className='h-60' /> : (
          <>
            <DialogHeader><DialogTitle>{name(a.userId)} · {data.positions.find((p) => p.id === a.positionId)?.name}</DialogTitle></DialogHeader>
            <div className='grid gap-5'>
              <div className='flex flex-wrap items-center gap-2'>
                <Pill style={{ color: data.statuses[a.status].color }}>{data.statuses[a.status].emoji} {data.statuses[a.status].label}</Pill>
                <span className='text-xs text-muted-foreground'>Déposée le {dateTime(a.createdAt)}</span>
                {a.interviewChannelId && <Pill tone='accent'>Salon d’entretien ouvert</Pill>}
              </div>
              <dl className='grid gap-3'>
                {a.answers.map((x) => <div key={x.id}><dt className='text-xs font-medium text-muted-foreground'>{x.label}</dt><dd className='whitespace-pre-wrap text-sm'>{x.value || '—'}</dd></div>)}
              </dl>
              <div className='grid gap-2'>
                <h3 className='text-sm font-semibold'>Votes du staff</h3>
                {open && can('recruitment.vote') && (
                  <div className='flex gap-2'>
                    <Button size='sm' variant={myVote === 1 ? 'default' : 'outline'} onClick={() => vote.mutate(1)}><ThumbsUp /> Pour</Button>
                    <Button size='sm' variant={myVote === 0 ? 'default' : 'outline'} onClick={() => vote.mutate(0)}><Minus /> Neutre</Button>
                    <Button size='sm' variant={myVote === -1 ? 'default' : 'outline'} onClick={() => vote.mutate(-1)}><ThumbsDown /> Contre</Button>
                  </div>
                )}
                <ul className='grid gap-1 text-sm'>
                  {a.votes.map((v) => <li key={v.userId}>{v.vote === 1 ? '👍' : v.vote === -1 ? '👎' : '🤷'} {name(v.userId)}{v.comment ? ` : ${v.comment}` : ''}</li>)}
                  {!a.votes.length && <li className='text-muted-foreground'>Pas encore de vote.</li>}
                </ul>
              </div>
              <div className='grid gap-2'>
                <h3 className='text-sm font-semibold'>Notes internes</h3>
                {a.notes.map((n, i) => <p key={i} className='rounded-md border-s-2 border-warning bg-warning/8 px-3 py-2 text-sm'><span className='text-xs text-muted-foreground'>{name(n.by)} · {dateTime(n.at)}</span><br />{n.text}</p>)}
                {can('recruitment.vote') && (
                  <div className='flex gap-2'>
                    <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder='Une remarque pour le reste du staff' />
                    <Button variant='outline' onClick={() => addNote.mutate()} disabled={!note.trim()}><MessageSquarePlus /> Ajouter</Button>
                  </div>
                )}
              </div>
              <div className='grid gap-1 text-xs text-muted-foreground'>
                {a.history.map((h, i) => <span key={i}>{dateTime(h.at)} · {data.statuses[h.status as StatusKey]?.label ?? h.status} · {name(h.by)}{h.reason ? ` · ${h.reason}` : ''}</span>)}
              </div>
            </div>
            {open && can('recruitment.manage') && (
              <DialogFooter className='flex-col gap-2 sm:flex-col'>
                <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder='Message ajouté au MP du candidat (facultatif)' />
                <div className='flex flex-wrap justify-end gap-2'>
                  {a.status === 'received' && <Button variant='outline' onClick={() => decide.mutate('review')}>🔎 En étude</Button>}
                  {a.status !== 'interview' && <Button variant='outline' onClick={() => decide.mutate('interview')}>🗣️ Entretien</Button>}
                  <Button variant='destructive' onClick={() => decide.mutate('rejected')}>Refuser</Button>
                  <Button variant='success' onClick={() => decide.mutate('accepted')}>Accepter</Button>
                </div>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const EMPTY_POSITION: Omit<Position, 'id'> & { id?: number } = {
  name: '', description: '', panelChannelId: null, panelMessageId: null,
  config: {
    open: true, closesAt: null, form: { steps: [{ title: 'Ta candidature', when: null, questions: [{ id: 'why', type: 'paragraph', label: 'Pourquoi toi ?', description: '', required: true, maxLength: 2000 }] }] },
    cooldownDays: 14, reviewChannelId: null, pingRoleIds: [], acceptRoleIds: [], acceptRankId: null, interviewCategoryId: null, interviewerRoleIds: [], dm: {},
    requirements: { minAccountAgeDays: 0, minMemberDays: 0, noSanctionDays: 0, requiredRoleIds: [], minMessages: 0, activityDays: 30 },
  },
}

function Positions({ data, guildId }: { data: Payload; guildId: string }) {
  const { can } = useMe()
  const manage = can('recruitment.manage')
  const qc = useQueryClient()
  const [editing, setEditing] = useState<(Omit<Position, 'id'> & { id?: number }) | null>(null)
  const [deleting, setDeleting] = useState<Position | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['recruitment', guildId] })
  const panel = useMutation({ mutationFn: (channelId: string) => api(`/recruitment/${guildId}/panel`, { method: 'POST', body: { channelId } }), onSuccess: () => { toast.success('Panneau publié'); refresh() } })
  const remove = useMutation({ mutationFn: (p: Position) => api(`/recruitment/positions/${p.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Poste supprimé'); setDeleting(null); refresh() } })
  const setOpen = useMutation({
    mutationFn: async ({ list, open }: { list: Position[]; open: boolean }) => { for (const p of list) await api(`/recruitment/positions/${p.id}/open`, { method: 'POST', body: { open } }) },
    onSuccess: (_, v) => { toast.success(v.list.length > 1 ? (v.open ? 'Toutes les candidatures sont ouvertes' : 'Toutes les candidatures sont fermées') : (v.open ? `Candidatures ouvertes : ${v.list[0].name}` : `Candidatures fermées : ${v.list[0].name}`)); refresh() },
  })
  const panelChannels = [...new Set(data.positions.map((p) => p.panelChannelId).filter(Boolean))] as string[]
  return (
    <div className='grid gap-6'>
      <Section title='Postes' actions={manage && (
        <div className='flex flex-wrap gap-2'>
          {data.positions.length > 1 && <Button size='sm' variant='success-outline' loading={setOpen.isPending && setOpen.variables?.open === true} onClick={() => setOpen.mutate({ list: data.positions.filter((p) => !p.config.open), open: true })} disabled={data.positions.every((p) => p.config.open)}>Tout ouvrir</Button>}
          {data.positions.length > 1 && <Button size='sm' variant='danger-outline' loading={setOpen.isPending && setOpen.variables?.open === false} onClick={() => setOpen.mutate({ list: data.positions.filter((p) => p.config.open), open: false })} disabled={data.positions.every((p) => !p.config.open)}>Tout fermer</Button>}
          <Button size='sm' onClick={() => setEditing(EMPTY_POSITION)}><Plus /> Poste</Button>
        </div>
      )}>
        {!data.positions.length ? <EmptyState title='Aucun poste'>Crée par exemple « Modérateur », « Helper » ou « Développeur ».</EmptyState> : (
          <ul className='divide-y'>
            {data.positions.map((p) => (
              <li key={p.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                <div className='min-w-48 flex-1'>
                  <div className='flex items-center gap-2 font-medium'>{p.name} {p.config.open ? <Pill tone='success'>Ouvert</Pill> : <Pill>Fermé</Pill>}</div>
                  <div className='text-xs text-muted-foreground'>{p.config.form.steps.reduce((n, s) => n + s.questions.length, 0)} questions · {data.applications.filter((a) => a.positionId === p.id).length} candidature(s)</div>
                </div>
                {manage && (
                  <div className='flex items-center gap-2'>
                    <label className='flex items-center gap-2 text-sm'>
                      <Switch checked={p.config.open} disabled={setOpen.isPending} onCheckedChange={(open) => setOpen.mutate({ list: [p], open })} aria-label={`Candidatures ${p.name}`} />
                      <span className='hidden sm:inline'>{p.config.open ? 'Ouvert' : 'Fermé'}</span>
                    </label>
                    <Button size='sm' variant='outline' onClick={() => setEditing(p)}>Modifier</Button>
                    <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(p)}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {manage && panelChannels.length > 0 && (
        <Section title='Panneaux' description='Un message par salon, avec un bouton par poste qui a ce salon comme panneau.'>
          <ul className='divide-y'>
            {panelChannels.map((c) => (
              <li key={c} className='flex items-center gap-3 px-4 py-3'>
                <span className='flex-1 text-sm'>#{data.channels.find((x) => x.id === c)?.name ?? c}</span>
                <Button size='sm' variant='outline' onClick={() => panel.mutate(c)}><Send /> Publier / mettre à jour</Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {editing && <PositionDialog initial={editing} data={data} guildId={guildId} onClose={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Supprimer le poste ${deleting?.name} ?`} desc='Ses candidatures sont supprimées aussi.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  )
}

function PositionDialog({ initial, data, guildId, onClose }: { initial: Omit<Position, 'id'> & { id?: number }; data: Payload; guildId: string; onClose: () => void }) {
  const [p, setP] = useState(initial)
  const c = p.config
  const set = (patch: Partial<Position['config']>) => setP({ ...p, config: { ...c, ...patch } })
  const setReq = (patch: Partial<Position['config']['requirements']>) => set({ requirements: { ...c.requirements, ...patch } })
  const save = useMutation({ mutationFn: () => api(`/recruitment/${guildId}/positions`, { method: 'PUT', body: p }), onSuccess: () => { toast.success('Poste enregistré'); onClose() } })
  const num = (label: string, value: number, onChange: (n: number) => void) => (
    <div className='grid gap-1.5'><Label>{label}</Label><Input type='number' min={0} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} /></div>
  )
  const dmBox = useRef<HTMLDivElement>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader><DialogTitle>{p.id ? `Modifier ${initial.name}` : 'Nouveau poste'}</DialogTitle></DialogHeader>
        <Tabs defaultValue='general'>
          <TabsList><TabsTrigger value='general'>Général</TabsTrigger><TabsTrigger value='form'>Formulaire</TabsTrigger><TabsTrigger value='rules'>Conditions</TabsTrigger><TabsTrigger value='messages'>Messages</TabsTrigger></TabsList>
          <TabsContent value='general' className='mt-4 grid gap-4'>
            <div className='grid gap-4 sm:grid-cols-[1fr_auto]'>
              <div className='grid gap-1.5'><Label htmlFor='pos-name'>Nom</Label><Input id='pos-name' value={p.name} maxLength={60} onChange={(e) => setP({ ...p, name: e.target.value })} /></div>
              <label className='flex items-end gap-2 pb-2 text-sm'><Switch checked={c.open} onCheckedChange={(v) => set({ open: v })} /> Candidatures ouvertes</label>
            </div>
            <div className='grid gap-1.5'><Label htmlFor='pos-desc'>Description (affichée sur le panneau)</Label><Textarea id='pos-desc' rows={2} maxLength={1000} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'><Label>Salon du panneau</Label><ChannelSelect channels={data.channels} value={p.panelChannelId} onChange={(v) => setP({ ...p, panelChannelId: v })} label='Salon du panneau' /></div>
              <div className='grid gap-1.5'><Label>Salon des candidatures (staff)</Label><ChannelSelect channels={data.channels} value={c.reviewChannelId} onChange={(v) => set({ reviewChannelId: v })} label='Salon des candidatures' /></div>
              <div className='grid gap-1.5'><Label>Rôles mentionnés à chaque candidature</Label><RolesPicker roles={data.roles} value={c.pingRoleIds} onChange={(ids) => set({ pingRoleIds: ids })} label='Rôles mentionnés' /></div>
              <div className='grid gap-1.5'><Label>Rôles donnés si acceptée</Label><RolesPicker roles={data.roles} value={c.acceptRoleIds} onChange={(ids) => set({ acceptRoleIds: ids })} label='Rôles donnés' /></div>
              <div className='grid gap-1.5'>
                <Label>Rang du panel donné si acceptée</Label>
                <Select value={c.acceptRankId ? String(c.acceptRankId) : 'none'} onValueChange={(v) => set({ acceptRankId: v === 'none' ? null : Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value='none'>Aucun</SelectItem>{data.ranks.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className='grid gap-1.5'><Label>Catégorie des salons d’entretien</Label><CategorySelect categories={data.categories} value={c.interviewCategoryId} onChange={(v) => set({ interviewCategoryId: v })} label='Catégorie des entretiens' /></div>
              <div className='grid gap-1.5'><Label>Recruteurs (voient les entretiens)</Label><RolesPicker roles={data.roles} value={c.interviewerRoleIds} onChange={(ids) => set({ interviewerRoleIds: ids })} label='Recruteurs' /></div>
              {num('Délai avant de repostuler (jours)', c.cooldownDays, (n) => set({ cooldownDays: n }))}
            </div>
          </TabsContent>
          <TabsContent value='form' className='mt-4'><FormBuilder value={c.form} allowEmpty={false} onChange={(form) => set({ form })} /></TabsContent>
          <TabsContent value='rules' className='mt-4 grid gap-4 sm:grid-cols-2'>
            {num('Âge du compte (jours)', c.requirements.minAccountAgeDays, (n) => setReq({ minAccountAgeDays: n }))}
            {num('Ancienneté sur le serveur (jours)', c.requirements.minMemberDays, (n) => setReq({ minMemberDays: n }))}
            {num('Aucune sanction depuis (jours)', c.requirements.noSanctionDays, (n) => setReq({ noSanctionDays: n }))}
            {num('Messages minimum', c.requirements.minMessages, (n) => setReq({ minMessages: n }))}
            {num('…sur les derniers (jours)', c.requirements.activityDays, (n) => setReq({ activityDays: n || 30 }))}
            <div className='grid gap-1.5'><Label>Rôles requis</Label><RolesPicker roles={data.roles} value={c.requirements.requiredRoleIds} onChange={(ids) => setReq({ requiredRoleIds: ids })} placeholder='Aucun' label='Rôles requis' /></div>
          </TabsContent>
          <TabsContent value='messages' className='mt-4 grid gap-3' ref={dmBox}>
            <div className='flex flex-wrap items-center gap-2'>
              <VariableButton container={dmBox} extra={[{ title: 'Candidature', items: [{ key: 'position', label: 'Nom du poste' }] }]} />
              <p className='text-sm text-muted-foreground'>Messages privés envoyés au candidat. Vide = texte par défaut.</p>
            </div>
            {(['received', 'review', 'interview', 'accepted', 'rejected'] as const).map((k) => (
              <div key={k} className='grid gap-1.5'>
                <Label htmlFor={`dm-${k}`}>{data.statuses[k].emoji} {data.statuses[k].label}</Label>
                <Textarea id={`dm-${k}`} rows={2} maxLength={1000} value={c.dm[k] ?? ''} onChange={(e) => set({ dm: { ...c.dm, [k]: e.target.value } })} />
              </div>
            ))}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={!p.name.trim() || save.isPending}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

