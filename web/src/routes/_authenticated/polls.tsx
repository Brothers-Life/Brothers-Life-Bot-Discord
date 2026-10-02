import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Lock, Plus, Save, Send, Trash2, Vote, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { RolesPicker } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TargetsEditor } from '@/features/announcements/targets-editor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { EmojiField } from '@/components/app/emoji-picker'
import { ColorPicker } from '@/components/app/color-picker'

export const Route = createFileRoute('/_authenticated/polls')({
  component: PollsPage,
})

type Option = { id?: string; label: string; emoji: string; description: string }
type Settings = {
  multiple: boolean; minChoices: number; maxChoices: number; allowChange: boolean; anonymous: boolean; showResults: 'live' | 'end' | 'never'
  style: 'buttons' | 'select'; requiredRoleIds: string[]; blockedRoleIds: string[]; minAccountAgeDays: number; minMemberDays: number; maxVotes: number
  pin: boolean; color: string; image: string | null; resultsMessage: boolean
}
type Poll = {
  id: number; question: string; description: string; options: (Option & { id: string })[]; settings: Settings; targets: AnnouncementTarget[]
  messages: { guildId: string; channelId: string; messageId: string }[]; status: 'draft' | 'scheduled' | 'open' | 'closed'
  startsAt: number | null; endsAt: number | null; updatedAt: number; openedAt: number | null; closedAt: number | null
  results: { voters: number; total: number; options: (Option & { id: string; votes: number; percent: number })[] }
  byGuild?: { guildId: string; choice: string; n: number }[]
}
const STATUS = { draft: { label: 'Brouillon', tone: 'neutral' }, scheduled: { label: 'Programmé', tone: 'accent' }, open: { label: 'En cours', tone: 'success' }, closed: { label: 'Terminé', tone: 'neutral' } } as const
const DEFAULT_SETTINGS: Settings = {
  multiple: false, minChoices: 1, maxChoices: 1, allowChange: true, anonymous: true, showResults: 'live', style: 'buttons', requiredRoleIds: [], blockedRoleIds: [],
  minAccountAgeDays: 0, minMemberDays: 0, maxVotes: 0, pin: false, color: '#d6a249', image: null, resultsMessage: true,
}
const toLocal = (at: number | null) => (at ? new Date(at - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const fromLocal = (value: string) => (value ? new Date(value).getTime() : null)

function PollsPage() {
  const { can } = useMe()
  const { data: list } = useQuery({ queryKey: ['polls'], queryFn: () => api<Poll[]>('/polls'), refetchInterval: 10_000 })
  const guilds = useQuery({ queryKey: ['polls-targets'], queryFn: () => api<AnnouncementTargetsPayload>('/polls/targets') })
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  return (
    <Page
      title='Sondages'
      description='Un sondage publié dans un ou plusieurs salons du réseau, avec les votes comptés ensemble. Résultats en direct, à la fin ou jamais ; anonyme ou non ; conditions pour voter.'
      actions={can('polls.manage') && <Button onClick={() => setSelected('new')}><Plus /> Nouveau sondage</Button>}
    >
      <div className='grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]'>
        <Section title='Sondages'>
          {!list ? <Skeleton className='m-4 h-24' /> : !list.length ? <EmptyState title='Aucun sondage'>Crée ton premier sondage, ou utilise /sondage creer dans Discord.</EmptyState> : (
            <ul className='divide-y'>
              {list.map((p) => (
                <li key={p.id}>
                  <button type='button' onClick={() => setSelected(p.id)} className={cn('w-full px-4 py-3 text-start transition-colors hover:bg-accent/40', selected === p.id && 'bg-primary/10')}>
                    <div className='flex items-center gap-2'>
                      <span className='min-w-0 flex-1 truncate font-medium'>{p.question}</span>
                      <Pill tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Pill>
                    </div>
                    <div className='text-xs text-muted-foreground'>#{p.id} · {p.results.voters} votant{p.results.voters > 1 ? 's' : ''}{p.endsAt && p.status === 'open' ? ` · fin le ${dateTime(p.endsAt)}` : ''}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {selected !== null && guilds.data
          ? <PollEditor key={`${selected}-${selected === 'new' ? 0 : list?.find((p) => p.id === selected)?.updatedAt}`} pollId={selected === 'new' ? null : selected} guilds={guilds.data} onSaved={setSelected} onDeleted={() => setSelected(null)} />
          : <div className='grid place-items-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground'>Choisis un sondage ou crées-en un.</div>}
      </div>
    </Page>
  )
}

function PollEditor({ pollId, guilds, onSaved, onDeleted }: { pollId: number | null; guilds: AnnouncementTargetsPayload; onSaved: (id: number) => void; onDeleted: () => void }) {
  const { data: poll } = useQuery({ queryKey: ['poll', pollId], queryFn: () => api<Poll>(`/polls/${pollId}`), enabled: pollId !== null, refetchInterval: 5000 })
  if (pollId !== null && !poll) return <Skeleton className='h-96 w-full' />
  return <PollForm key={poll?.updatedAt ?? 'new'} poll={poll ?? null} guilds={guilds} onSaved={onSaved} onDeleted={onDeleted} />
}

function PollForm({ poll, guilds, onSaved, onDeleted }: { poll: Poll | null; guilds: AnnouncementTargetsPayload; onSaved: (id: number) => void; onDeleted: () => void }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const editable = can('polls.manage') && (!poll || poll.status !== 'closed')
  const locked = Boolean(poll && (poll.status === 'open' || poll.status === 'closed'))
  const [question, setQuestion] = useState(poll?.question ?? '')
  const [description, setDescription] = useState(poll?.description ?? '')
  const [options, setOptions] = useState<Option[]>(poll?.options ?? [{ label: 'Oui', emoji: '✅', description: '' }, { label: 'Non', emoji: '❌', description: '' }])
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...poll?.settings })
  const [targets, setTargets] = useState<AnnouncementTarget[]>(poll?.targets ?? [])
  const [startsAt, setStartsAt] = useState(toLocal(poll?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState(toLocal(poll?.endsAt ?? null))
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null)
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))
  const allRoles = guilds.flatMap((g) => g.roles.map((r) => ({ ...r, name: `${r.name} (${g.name})`, position: 0, editable: true, dangerous: false })))

  const body = () => ({ question, description, options: options.filter((o) => o.label.trim()), settings: { ...settings, image: settings.image || null }, targets, startsAt: fromLocal(startsAt), endsAt: fromLocal(endsAt) })
  const after = (p: Poll, label: string) => { toast.success(label); qc.invalidateQueries({ queryKey: ['polls'] }); qc.invalidateQueries({ queryKey: ['poll', p.id] }); onSaved(p.id) }
  const saveThen = async () => (poll ? api<Poll>(`/polls/${poll.id}`, { method: 'PUT', body: body() }) : api<Poll>('/polls', { method: 'POST', body: body() }))
  const save = useMutation({ mutationFn: saveThen, onSuccess: (p) => after(p, 'Sondage enregistré') })
  const publish = useMutation({
    mutationFn: async () => api<Poll>(`/polls/${(await saveThen()).id}/publish`, { method: 'POST' }),
    onSuccess: (p) => after(p, p.status === 'scheduled' ? `Programmé pour le ${dateTime(p.startsAt)}` : 'Sondage publié'),
  })
  const close = useMutation({ mutationFn: () => api<Poll>(`/polls/${poll!.id}/close`, { method: 'POST', body: { confirm: true } }), onSuccess: (p) => { setConfirm(null); after(p, 'Sondage terminé') } })
  const duplicate = useMutation({ mutationFn: () => api<Poll>(`/polls/${poll!.id}/duplicate`, { method: 'POST' }), onSuccess: (p) => after(p, 'Sondage dupliqué') })
  const remove = useMutation({ mutationFn: () => api(`/polls/${poll!.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Supprimé'); qc.invalidateQueries({ queryKey: ['polls'] }); onDeleted() } })

  const results = poll?.results
  const max = Math.max(1, ...(results?.options.map((o) => o.votes) ?? [1]))
  return (
    <div className='grid content-start gap-6'>
      {poll && results && poll.status !== 'draft' && (
        <Section
          title={`Résultats · ${results.voters} votant${results.voters > 1 ? 's' : ''}`}
          actions={
            <div className='flex flex-wrap gap-2'>
              <Button size='sm' variant='outline' asChild><a href={`/api/polls/${poll.id}/export`}><Download /> CSV</a></Button>
              {poll.status === 'open' && can('polls.manage') && <Button size='sm' variant='outline' onClick={() => setConfirm('close')}><Lock /> Terminer</Button>}
            </div>
          }
        >
          <ul className='grid gap-3 p-4'>
            {[...results.options].sort((a, b) => b.votes - a.votes).map((o, i) => (
              <li key={o.id} className='grid gap-1'>
                <div className='flex items-center gap-2 text-sm'>
                  <span className='font-medium'>{o.emoji} {o.label}</span>
                  {i === 0 && o.votes > 0 && <Pill tone='success'>En tête</Pill>}
                  <span className='ms-auto tabular-nums text-muted-foreground'>{o.votes} · {o.percent} %</span>
                </div>
                <div className='h-2.5 rounded-full bg-muted'><div className={cn('h-full rounded-full transition-[width] duration-700', i === 0 ? 'bg-success' : 'bg-primary')} style={{ width: `${(o.votes / max) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          {poll.byGuild && guilds.length > 1 && (
            <div className='border-t px-4 py-3 text-xs text-muted-foreground'>
              {guilds.map((g) => {
                const n = poll.byGuild!.filter((b) => b.guildId === g.id).reduce((a, b) => a + b.n, 0)
                return n ? <span key={g.id} className='me-4'>{g.name} : {n} vote{n > 1 ? 's' : ''}</span> : null
              })}
            </div>
          )}
        </Section>
      )}

      <Section title={poll ? `Sondage #${poll.id}` : 'Nouveau sondage'} actions={poll && can('polls.manage') && (
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' onClick={() => duplicate.mutate()}><Copy /> Dupliquer</Button>
          <Button size='sm' variant='danger-ghost' onClick={() => setConfirm('delete')}><Trash2 /> Supprimer</Button>
        </div>
      )}>
        <div className='grid gap-4 p-4'>
          <div className='grid gap-1.5'><Label htmlFor='p-q'>Question</Label><Input id='p-q' value={question} maxLength={250} disabled={!editable} onChange={(e) => setQuestion(e.target.value)} placeholder='Quel event pour samedi ?' /></div>
          <div className='grid gap-1.5'><Label htmlFor='p-d'>Précisions (facultatif)</Label><Textarea id='p-d' rows={2} maxLength={2000} value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} /></div>
          <fieldset className='grid gap-2'>
            <legend className='mb-1 text-sm font-medium'>Choix ({options.length}/25){locked && <span className='font-normal text-muted-foreground'> · figés une fois publié</span>}</legend>
            {options.map((o, i) => (
              <div key={i} className='grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 sm:grid-cols-[auto_1fr_1.2fr_auto]'>
                <EmojiField value={o.emoji} label={`Émoji du choix ${i + 1}`} disabled={!editable} onChange={(v) => setOptions(options.map((x, j) => (j === i ? { ...x, emoji: v } : x)))} />
                <Input value={o.label} maxLength={80} placeholder={`Choix ${i + 1}`} aria-label={`Choix ${i + 1}`} disabled={!editable || locked} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input value={o.description} maxLength={100} placeholder='Description (menu seulement)' className='col-span-2 sm:col-span-1' aria-label={`Description du choix ${i + 1}`} disabled={!editable} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Button size='icon' variant='ghost' aria-label='Supprimer le choix' disabled={!editable || locked || options.length <= 2} onClick={() => setOptions(options.filter((_, j) => j !== i))}><X /></Button>
              </div>
            ))}
            {editable && !locked && options.length < 25 && <Button size='sm' variant='outline' className='justify-self-start' onClick={() => setOptions([...options, { label: '', emoji: '', description: '' }])}><Plus /> Choix</Button>}
          </fieldset>
        </div>
      </Section>

      <Section title='Règles du vote'>
        <div className='grid gap-4 p-4'>
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='grid gap-1.5'>
              <Label>Affichage</Label>
              <Select value={settings.style} disabled={!editable} onValueChange={(v) => set({ style: v as Settings['style'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='buttons'>Boutons</SelectItem><SelectItem value='select'>Menu déroulant</SelectItem></SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'>
              <Label>Résultats visibles</Label>
              <Select value={settings.showResults} disabled={!editable} onValueChange={(v) => set({ showResults: v as Settings['showResults'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='live'>En direct</SelectItem><SelectItem value='end'>À la fin</SelectItem><SelectItem value='never'>Jamais (panel seulement)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'><Label htmlFor='p-color'>Couleur</Label><ColorPicker disabled={!editable} id='p-color' value={settings.color} onChange={(hex) => set({ color: hex })} /></div>
          </div>
          <div className='grid gap-2 text-sm sm:grid-cols-2'>
            <label className='flex items-center gap-2'><Checkbox checked={settings.multiple} disabled={!editable || locked} onCheckedChange={(v) => set({ multiple: v === true, maxChoices: v === true ? options.length : 1 })} /> Plusieurs choix possibles</label>
            <label className='flex items-center gap-2'><Checkbox checked={settings.allowChange} disabled={!editable} onCheckedChange={(v) => set({ allowChange: v === true })} /> On peut changer son vote</label>
            <label className='flex items-center gap-2'><Checkbox checked={settings.anonymous} disabled={!editable} onCheckedChange={(v) => set({ anonymous: v === true })} /> Vote anonyme</label>
            <label className='flex items-center gap-2'><Checkbox checked={settings.pin} disabled={!editable} onCheckedChange={(v) => set({ pin: v === true })} /> Épingler le message</label>
            <label className='flex items-center gap-2'><Checkbox checked={settings.resultsMessage} disabled={!editable} onCheckedChange={(v) => set({ resultsMessage: v === true })} /> Message de résultats à la fin</label>
          </div>
          {settings.multiple && (
            <div className='flex flex-wrap items-end gap-3 text-sm'>
              <div className='grid gap-1.5'><Label htmlFor='p-min'>Choix minimum</Label><Input id='p-min' type='number' className='w-24' min={1} max={options.length} value={settings.minChoices} disabled={!editable || locked} onChange={(e) => set({ minChoices: Number(e.target.value) || 1 })} /></div>
              <div className='grid gap-1.5'><Label htmlFor='p-max'>Choix maximum</Label><Input id='p-max' type='number' className='w-24' min={1} max={options.length} value={settings.maxChoices} disabled={!editable || locked} onChange={(e) => set({ maxChoices: Number(e.target.value) || 1 })} /></div>
            </div>
          )}
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'><Label>Rôles requis pour voter</Label><RolesPicker roles={allRoles} value={settings.requiredRoleIds} disabled={!editable} onChange={(ids) => set({ requiredRoleIds: ids })} placeholder='Tout le monde' label='Rôles requis' /></div>
            <div className='grid gap-1.5'><Label>Rôles interdits</Label><RolesPicker roles={allRoles} value={settings.blockedRoleIds} disabled={!editable} onChange={(ids) => set({ blockedRoleIds: ids })} placeholder='Aucun' label='Rôles interdits' /></div>
            <div className='grid gap-1.5'><Label htmlFor='p-age'>Âge minimum du compte (jours)</Label><Input id='p-age' type='number' min={0} value={settings.minAccountAgeDays} disabled={!editable} onChange={(e) => set({ minAccountAgeDays: Number(e.target.value) || 0 })} /></div>
            <div className='grid gap-1.5'><Label htmlFor='p-seniority'>Ancienneté sur le serveur (jours)</Label><Input id='p-seniority' type='number' min={0} value={settings.minMemberDays} disabled={!editable} onChange={(e) => set({ minMemberDays: Number(e.target.value) || 0 })} /></div>
          </div>
        </div>
      </Section>

      <Section title='Publication'>
        <div className='grid gap-4 p-4'>
          <TargetsEditor guilds={guilds} targets={targets} onChange={setTargets} disabled={!editable || locked} />
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='grid gap-1.5'><Label htmlFor='p-start'>Début (vide = à la publication)</Label><Input id='p-start' type='datetime-local' value={startsAt} disabled={!editable || locked} onChange={(e) => setStartsAt(e.target.value)} /></div>
            <div className='grid gap-1.5'><Label htmlFor='p-end'>Fin (vide = fermeture à la main)</Label><Input id='p-end' type='datetime-local' value={endsAt} disabled={!editable} onChange={(e) => setEndsAt(e.target.value)} /></div>
            <div className='grid gap-1.5'><Label htmlFor='p-maxv'>Fin après N votants (0 = non)</Label><Input id='p-maxv' type='number' min={0} value={settings.maxVotes} disabled={!editable} onChange={(e) => set({ maxVotes: Number(e.target.value) || 0 })} /></div>
          </div>
          <div className='grid gap-1.5'><Label htmlFor='p-img'>Image (adresse https, facultatif)</Label><Input id='p-img' value={settings.image ?? ''} placeholder='https://…' disabled={!editable} onChange={(e) => set({ image: e.target.value })} /></div>
        </div>
      </Section>

      {editable && (
        <div className='flex flex-wrap justify-end gap-2'>
          <Button variant='outline' onClick={() => save.mutate()} disabled={!question.trim() || save.isPending}><Save /> Enregistrer</Button>
          {(!poll || poll.status === 'draft') && <Button onClick={() => publish.mutate()} disabled={!question.trim() || !targets.length || publish.isPending}>{startsAt ? <><Vote /> Programmer</> : <><Send /> Publier</>}</Button>}
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'close' ? 'Terminer ce sondage ?' : 'Supprimer ce sondage ?'}
        desc={confirm === 'close' ? 'Plus personne ne pourra voter ; les résultats sont affichés selon les réglages.' : 'Les messages du sondage sont aussi supprimés de Discord, avec les votes.'}
        confirmText={confirm === 'close' ? 'Terminer' : 'Supprimer'} destructive={confirm === 'delete'}
        isLoading={close.isPending || remove.isPending}
        handleConfirm={() => (confirm === 'close' ? close.mutate() : remove.mutate())}
      />
    </div>
  )
}
