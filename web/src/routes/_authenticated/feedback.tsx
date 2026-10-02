import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bug, Check, Download, Lightbulb, Plus, Save, Send, ShieldAlert, ThumbsDown, ThumbsUp, Trash2, UserCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, FormDef, Guild, Role } from '@/lib/types'
import { ago } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, UserAvatar, GuildIcon } from '@/components/app/ui'
import { ChannelSelect, RolesPicker } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormBuilder } from '@/features/forms/form-builder'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { EmojiField } from '@/components/app/emoji-picker'

export const Route = createFileRoute('/_authenticated/feedback')({
  component: FeedbackPage,
})

type Status = { key: string; label: string; emoji: string; color: string; final: boolean }
type Urgency = { key: string; label: string; color: string; pingRoleIds: string[]; slaMinutes: number }
type BoxConfig = {
  channelId: string | null; reviewChannelId: string | null; acceptedChannelId: string | null; rejectedChannelId: string | null; form: FormDef; statuses: Status[]
  votes: boolean; anonymousAllowed: boolean; allowedRoleIds: string[]; cooldownMinutes: number; thread: boolean; dmAuthor: boolean; urgencies: Urgency[]
}
type Box = { id: number; guildId: string; name: string; kind: 'public' | 'staff'; config: BoxConfig; panelChannelId: string | null; panelMessageId: string | null }
type Item = {
  id: number; number: number; title: string; answers: { id: string; label: string; value: string }[]; status: string; statusReason: string | null; urgency: string | null
  approved: boolean; anonymous: boolean; up: number; down: number; createdAt: number; duplicateOf: number | null
  author: { name: string | null; avatar: string | null } | null; assignee: { name: string | null; avatar: string | null } | null
}
type Payload = { boxes: Box[]; channels: Channel[]; roles: Role[]; presets: { key: string; name: string; kind: string }[] }

const ICONS = { public: Lightbulb, staff: ShieldAlert }

function FeedbackPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id
  const currentGuild = active.find((g) => g.id === current)
  return (
    <Page
      title='Suggestions et bugs'
      description='Boîtes à suggestions, reports de bug et bugs internes du staff : formulaire personnalisable, votes, statuts avec réponse, fil de discussion, niveaux d’urgence.'
      actions={current && (
        <div className='flex items-center gap-2'>
          <Label htmlFor='fb-guild' className='text-muted-foreground'>Serveur</Label>
          <Select value={current} onValueChange={setGuildId}>
            <SelectTrigger id='fb-guild' className='w-60'><span className='flex items-center gap-2 truncate'>{currentGuild && <GuildIcon src={currentGuild.icon} name={currentGuild.name} className='size-5' />}<SelectValue /></span></SelectTrigger>
            <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      {current && <Boxes key={current} guildId={current} />}
    </Page>
  )
}

function Boxes({ guildId }: { guildId: string }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['feedback', guildId], queryFn: () => api<Payload>(`/feedback/${guildId}`) })
  const [selected, setSelected] = useState<number | null>(null)
  const create = useMutation({
    mutationFn: (preset: string) => api<Box>(`/feedback/${guildId}/boxes`, { method: 'POST', body: { preset } }),
    onSuccess: (box) => { toast.success('Boîte créée : règle son salon dans « Réglages »'); qc.invalidateQueries({ queryKey: ['feedback', guildId] }); setSelected(box.id) },
  })
  if (!data) return <Skeleton className='h-96 w-full' />
  const box = data.boxes.find((b) => b.id === selected) ?? data.boxes[0]
  return (
    <div className='grid gap-6'>
      <div className='flex flex-wrap items-center gap-2'>
        {data.boxes.map((b) => {
          const Icon = b.name.toLowerCase().includes('bug') && b.kind === 'public' ? Bug : ICONS[b.kind]
          return (
            <Button key={b.id} variant={box?.id === b.id ? 'default' : 'outline'} onClick={() => setSelected(b.id)}>
              <Icon /> {b.name}
            </Button>
          )
        })}
        {can('feedback.manage') && (
          <Select onValueChange={(v) => create.mutate(v)} value=''>
            <SelectTrigger className='w-56'><span className='flex items-center gap-2'><Plus className='size-4' /> Nouvelle boîte</span></SelectTrigger>
            <SelectContent>{data.presets.map((p) => <SelectItem key={p.key} value={p.key}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
      {!box ? <EmptyState title='Aucune boîte'>Crée une boîte « Suggestions », « Reports de bug » ou « Bugs internes du staff ».</EmptyState> : (
        <Tabs key={box.id} defaultValue={box.config.channelId ? 'items' : 'settings'}>
          <TabsList>
            <TabsTrigger value='items'>{box.kind === 'staff' ? 'Bugs' : 'Propositions'}</TabsTrigger>
            <TabsTrigger value='settings'>Réglages</TabsTrigger>
          </TabsList>
          <TabsContent value='items' className='mt-4'><Items box={box} /></TabsContent>
          <TabsContent value='settings' className='mt-4'><BoxSettings key={JSON.stringify(box)} box={box} data={data} guildId={guildId} onDeleted={() => setSelected(null)} /></TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function Items({ box }: { box: Box }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState(box.kind === 'staff' ? 'urgency' : 'recent')
  const key = ['feedback-items', box.id, status, sort]
  const { data } = useQuery({ queryKey: key, queryFn: () => api<Item[]>(`/feedback/boxes/${box.id}/items?${new URLSearchParams({ sort, ...(status !== 'all' ? { status } : {}) })}`), refetchInterval: 15_000 })
  const [editing, setEditing] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['feedback-items', box.id] })
  const assign = useMutation({ mutationFn: (i: Item) => api(`/feedback/items/${i.id}/assign`, { method: 'POST', body: {} }), onSuccess: () => { toast.success('Assigné'); refresh() } })
  const review = useMutation({ mutationFn: ({ i, ok }: { i: Item; ok: boolean }) => api(`/feedback/items/${i.id}/review`, { method: 'POST', body: { approved: ok } }), onSuccess: () => { toast.success('Fait'); refresh() } })
  const remove = useMutation({ mutationFn: (i: Item) => api(`/feedback/items/${i.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Supprimé'); setDeleting(null); refresh() } })
  const statusOf = (k: string) => box.config.statuses.find((s) => s.key === k)
  const urgencyOf = (k: string | null) => box.config.urgencies.find((u) => u.key === k)
  const handle = can('feedback.manage') || (box.kind === 'staff' && can('feedback.staff'))

  return (
    <Section
      title={`${data?.length ?? 0} élément${(data?.length ?? 0) > 1 ? 's' : ''}`}
      actions={
        <div className='flex flex-wrap gap-2'>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className='w-44'><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value='all'>Tous les statuts</SelectItem>{box.config.statuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.emoji} {s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className='w-40'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='recent'>Plus récents</SelectItem>
              {box.config.votes && <SelectItem value='score'>Mieux notés</SelectItem>}
              {box.kind === 'staff' && <SelectItem value='urgency'>Plus urgents</SelectItem>}
            </SelectContent>
          </Select>
          <Button variant='outline' size='sm' asChild><a href={`/api/feedback/boxes/${box.id}/export`}><Download /> CSV</a></Button>
        </div>
      }
    >
      {!data ? <Skeleton className='m-4 h-40' /> : !data.length ? <EmptyState title='Rien pour l’instant'>Publie le panneau de la boîte, ou utilise /proposer dans Discord.</EmptyState> : (
        <ul className='divide-y'>
          {data.map((i) => {
            const s = statusOf(i.status)
            const u = urgencyOf(i.urgency)
            return (
              <li key={i.id} className='flex animate-in flex-wrap items-start gap-3 px-4 py-3 fade-in-0'>
                <span aria-hidden className='mt-1 h-10 w-1 shrink-0 rounded-full' style={{ background: u && !s?.final ? u.color : s?.color }} />
                <div className='min-w-0 flex-1 basis-56'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='min-w-0 font-medium [overflow-wrap:anywhere]'>#{i.number} · {i.title}</span>
                    <Pill style={{ color: s?.color }}>{s?.emoji} {s?.label}</Pill>
                    {u && <Pill style={{ color: u.color }}>{u.label}</Pill>}
                    {!i.approved && <Pill tone='warning'>À valider</Pill>}
                  </div>
                  {i.answers.length > 0 && <Answers answers={i.answers} />}
                  <div className='mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
                    <span className='flex items-center gap-1'>{i.author ? <><UserAvatar src={i.author.avatar} name={i.author.name ?? '?'} className='size-4' />{i.author.name}</> : 'anonyme'}</span>
                    <span>{ago(i.createdAt)}</span>
                    {box.config.votes && <span className='flex items-center gap-2'><ThumbsUp className='size-3 text-success' />{i.up}<ThumbsDown className='size-3 text-destructive' />{i.down}</span>}
                    {i.assignee && <span>pris par {i.assignee.name}</span>}
                    {i.statusReason && <span className='min-w-0 italic [overflow-wrap:anywhere]'>« {i.statusReason} »</span>}
                  </div>
                </div>
                {handle && (
                  <div className='flex flex-wrap gap-1'>
                    {!i.approved && <>
                      <Button size='sm' variant='outline' onClick={() => review.mutate({ i, ok: true })}><Check /> Publier</Button>
                      <Button size='sm' variant='danger-ghost' onClick={() => review.mutate({ i, ok: false })}><X /> Refuser</Button>
                    </>}
                    {box.kind === 'staff' && !i.assignee && i.approved && <Button size='sm' variant='outline' onClick={() => assign.mutate(i)}><UserCheck /> Je prends</Button>}
                    {i.approved && <Button size='sm' variant='outline' onClick={() => setEditing(i)}>Statut</Button>}
                    {can('feedback.manage') && <Button size='icon' variant='danger-ghost' aria-label='Supprimer' onClick={() => setDeleting(i)}><Trash2 /></Button>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editing && <StatusDialog box={box} item={editing} onClose={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title='Supprimer cet élément ?' desc='Le message Discord est supprimé aussi.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </Section>
  )
}

// Answers of the form: two lines, the rest on demand; long words wrap instead of overflowing
function Answers({ answers }: { answers: Item['answers'] }) {
  const [open, setOpen] = useState(false)
  const long = answers.length > 1 || answers.some((a) => a.value.length > 160 || a.value.includes('\n'))
  return (
    <div className='mt-1 text-sm text-muted-foreground'>
      {open ? (
        <dl className='grid gap-2'>
          {answers.map((a) => (
            <div key={a.id}>
              <dt className='text-xs font-medium text-foreground/80'>{a.label}</dt>
              <dd className='whitespace-pre-line [overflow-wrap:anywhere]'>{a.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className='line-clamp-2 [overflow-wrap:anywhere]'>{answers.map((a) => a.value).join(' · ')}</p>
      )}
      {long && <button type='button' className='mt-0.5 text-xs text-primary hover:underline' aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Réduire' : 'Tout afficher'}</button>}
    </div>
  )
}

function StatusDialog({ box, item, onClose }: { box: Box; item: Item; onClose: () => void }) {
  const [status, setStatus] = useState(item.status)
  const [reason, setReason] = useState(item.statusReason ?? '')
  const [duplicateOf, setDuplicateOf] = useState(item.duplicateOf ? String(item.duplicateOf) : '')
  const save = useMutation({
    mutationFn: () => api(`/feedback/items/${item.id}/status`, { method: 'POST', body: { status, reason, duplicateOf: status === 'duplicate' && duplicateOf ? Number(duplicateOf) : null } }),
    onSuccess: () => { toast.success('Statut changé, l’auteur est prévenu'); onClose() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader><DialogTitle className='[overflow-wrap:anywhere]'>#{item.number} · {item.title}</DialogTitle></DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-1.5'>
            <Label>Statut</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{box.config.statuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.emoji} {s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {status === 'duplicate' && <div className='grid gap-1.5'><Label htmlFor='dup'>Doublon de (identifiant interne)</Label><Input id='dup' value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value.replace(/\D/g, ''))} /></div>}
          <div className='grid gap-1.5'><Label htmlFor='reason'>Réponse (affichée et envoyée à l’auteur)</Label><Textarea id='reason' rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BoxSettings({ box, data, guildId, onDeleted }: { box: Box; data: Payload; guildId: string; onDeleted: () => void }) {
  const { can } = useMe()
  const manage = can('feedback.manage')
  const qc = useQueryClient()
  const [name, setName] = useState(box.name)
  const [c, setC] = useState<BoxConfig>(box.config)
  const [panelChannelId, setPanelChannelId] = useState(box.panelChannelId)
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<BoxConfig>) => setC((prev) => ({ ...prev, ...patch }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['feedback', guildId] })
  const save = useMutation({ mutationFn: () => api(`/feedback/boxes/${box.id}`, { method: 'PUT', body: { name, config: c, panelChannelId } }), onSuccess: () => { toast.success('Réglages enregistrés'); refresh() } })
  const panel = useMutation({
    mutationFn: async () => {
      await api(`/feedback/boxes/${box.id}`, { method: 'PUT', body: { name, config: c, panelChannelId } })
      return api(`/feedback/boxes/${box.id}/panel`, { method: 'POST' })
    },
    onSuccess: () => { toast.success('Panneau publié'); refresh() },
  })
  const remove = useMutation({ mutationFn: () => api(`/feedback/boxes/${box.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Boîte supprimée'); refresh(); onDeleted() } })
  const patchStatus = (i: number, patch: Partial<Status>) => set({ statuses: c.statuses.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const patchUrgency = (i: number, patch: Partial<Urgency>) => set({ urgencies: c.urgencies.map((u, j) => (j === i ? { ...u, ...patch } : u)) })

  return (
    <div className='grid gap-6'>
      <Section title='Général' actions={manage && <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(true)}><Trash2 /> Supprimer la boîte</Button>}>
        <div className='grid gap-4 p-4'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'><Label htmlFor='b-name'>Nom</Label><Input id='b-name' value={name} maxLength={60} disabled={!manage} onChange={(e) => setName(e.target.value)} /></div>
            <div className='grid gap-1.5'><Label>Salon de publication</Label><ChannelSelect channels={data.channels} value={c.channelId} disabled={!manage} onChange={(v) => set({ channelId: v })} label='Salon de publication' /></div>
            <div className='grid gap-1.5'><Label>Validation par le staff avant publication</Label><ChannelSelect channels={data.channels} value={c.reviewChannelId} disabled={!manage} onChange={(v) => set({ reviewChannelId: v })} noneLabel='Non, publier directement' label='Salon de validation' /></div>
            <div className='grid gap-1.5'><Label>Rôles autorisés à poster</Label><RolesPicker roles={data.roles} value={c.allowedRoleIds} disabled={!manage} onChange={(ids) => set({ allowedRoleIds: ids })} placeholder='Tout le monde' label='Rôles autorisés' /></div>
            <div className='grid gap-1.5'><Label>Salon des propositions acceptées (déplacées)</Label><ChannelSelect channels={data.channels} value={c.acceptedChannelId} disabled={!manage} onChange={(v) => set({ acceptedChannelId: v })} noneLabel='Ne pas déplacer' label='Salon des acceptées' /></div>
            <div className='grid gap-1.5'><Label>Salon des propositions refusées (déplacées)</Label><ChannelSelect channels={data.channels} value={c.rejectedChannelId} disabled={!manage} onChange={(v) => set({ rejectedChannelId: v })} noneLabel='Ne pas déplacer' label='Salon des refusées' /></div>
            <div className='grid gap-1.5'><Label htmlFor='b-cool'>Délai entre deux posts (minutes)</Label><Input id='b-cool' type='number' min={0} value={c.cooldownMinutes} disabled={!manage} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) || 0 })} /></div>
          </div>
          <div className='grid gap-2 text-sm sm:grid-cols-2'>
            <label className='flex items-center gap-2'><Checkbox checked={c.votes} disabled={!manage} onCheckedChange={(v) => set({ votes: v === true })} /> Votes 👍 / 👎</label>
            <label className='flex items-center gap-2'><Checkbox checked={c.thread} disabled={!manage} onCheckedChange={(v) => set({ thread: v === true })} /> Fil de discussion sous chaque proposition</label>
            <label className='flex items-center gap-2'><Checkbox checked={c.anonymousAllowed} disabled={!manage} onCheckedChange={(v) => set({ anonymousAllowed: v === true })} /> Autoriser l’anonymat (nom visible par le staff seulement)</label>
            <label className='flex items-center gap-2'><Checkbox checked={c.dmAuthor} disabled={!manage} onCheckedChange={(v) => set({ dmAuthor: v === true })} /> Prévenir l’auteur en MP à chaque statut</label>
          </div>
          <div className='flex flex-wrap items-end gap-3 rounded-md border border-dashed p-3'>
            <div className='grid min-w-60 flex-1 gap-1.5'><Label>Panneau avec le bouton « Proposer »</Label><ChannelSelect channels={data.channels} value={panelChannelId} disabled={!manage} onChange={setPanelChannelId} label='Salon du panneau' /></div>
            {manage && <Button variant='outline' onClick={() => panel.mutate()} disabled={!panelChannelId || panel.isPending}><Send /> {box.panelMessageId ? 'Mettre à jour' : 'Publier'} le panneau</Button>}
          </div>
        </div>
      </Section>

      <Section title='Statuts' description='Le premier statut est celui des nouvelles propositions. Un statut « final » ferme le vote et verrouille le fil.'>
        <ul className='divide-y'>
          {c.statuses.map((s, i) => (
            <li key={i} className='grid gap-2 px-4 py-2 sm:grid-cols-[auto_1fr_6rem_auto_auto] sm:items-center'>
              <EmojiField value={s.emoji} label='Émoji du statut' disabled={!manage} onChange={(v) => patchStatus(i, { emoji: v })} />
              <Input value={s.label} maxLength={40} aria-label='Nom' disabled={!manage} onChange={(e) => patchStatus(i, { label: e.target.value })} />
              <Input type='color' className='h-9 p-1' value={s.color} aria-label='Couleur' disabled={!manage} onChange={(e) => patchStatus(i, { color: e.target.value })} />
              <label className='flex items-center gap-1.5 text-xs'><Checkbox checked={s.final} disabled={!manage} onCheckedChange={(v) => patchStatus(i, { final: v === true })} /> Final</label>
              <Button size='icon' variant='ghost' aria-label='Supprimer' disabled={!manage || c.statuses.length <= 2} onClick={() => set({ statuses: c.statuses.filter((_, j) => j !== i) })}><X /></Button>
            </li>
          ))}
        </ul>
        {manage && <div className='p-3'><Button size='sm' variant='outline' onClick={() => set({ statuses: [...c.statuses, { key: `s${Date.now().toString(36).slice(-5)}`, label: 'Nouveau statut', emoji: '🔵', color: '#5b9cf6', final: false }] })}><Plus /> Statut</Button></div>}
      </Section>

      {box.kind === 'staff' && (
        <Section title='Niveaux d’urgence' description='Chaque niveau mentionne des rôles à la publication, et relance si personne ne prend le bug après le délai.'>
          <ul className='divide-y'>
            {c.urgencies.map((u, i) => (
              <li key={i} className='grid gap-2 px-4 py-2 sm:grid-cols-[1fr_6rem_1.4fr_8rem] sm:items-center'>
                <Input value={u.label} maxLength={30} aria-label='Nom' disabled={!manage} onChange={(e) => patchUrgency(i, { label: e.target.value })} />
                <Input type='color' className='h-9 p-1' value={u.color} aria-label='Couleur' disabled={!manage} onChange={(e) => patchUrgency(i, { color: e.target.value })} />
                <RolesPicker roles={data.roles} value={u.pingRoleIds} disabled={!manage} onChange={(ids) => patchUrgency(i, { pingRoleIds: ids })} placeholder='Aucun ping' label={`Rôles pour ${u.label}`} />
                <Input type='number' min={0} value={u.slaMinutes} aria-label='Relance après (minutes)' title='Relance après (minutes, 0 = jamais)' disabled={!manage} onChange={(e) => patchUrgency(i, { slaMinutes: Number(e.target.value) || 0 })} />
              </li>
            ))}
          </ul>
          <p className='px-4 pb-3 text-xs text-muted-foreground'>Dernière colonne : relance après N minutes sans personne (0 = jamais). Le formulaire doit contenir un choix « urgency » avec ces clés.</p>
        </Section>
      )}

      <Section title='Formulaire'>
        <div className='p-4'><FormBuilder value={c.form} disabled={!manage} allowEmpty={false} onChange={(form) => set({ form })} /></div>
      </Section>

      {manage && <div className='flex justify-end'><Button onClick={() => save.mutate()} disabled={save.isPending}><Save /> Enregistrer</Button></div>}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Supprimer « ${box.name} » ?`} desc='Toutes ses propositions sont supprimées du panel (les messages Discord restent).' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </div>
  )
}
