import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Copy, Dices, Download, Gift, Plus, Save, Send, Trash2, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, UserAvatar } from '@/components/app/ui'
import { RolesPicker } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TargetsEditor } from '@/features/announcements/targets-editor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/giveaways')({
  component: GiveawaysPage,
})

type Settings = {
  requiredRoleIds: string[]; requiredMode: 'any' | 'all'; blockedRoleIds: string[]; minAccountAgeDays: number; minMemberDays: number
  minMessages: number; minVoiceHours: number; activityDays: number; requiredGuildIds: string[]; noActiveSanction: boolean; noWarnDays: number
  excludeStaff: boolean; excludeRecentWinnersDays: number; bonusRoles: { roleId: string; entries: number }[]; bonusMode: 'sum' | 'max'; maxEntries: number
  winnerRoleId: string | null; winnerRoleDays: number; claimMinutes: number; dmWinners: boolean; winnerMessage: string; color: string; image: string | null
}
type Giveaway = {
  id: number; prize: string; description: string; winnersCount: number; settings: Settings; targets: AnnouncementTarget[]
  status: 'draft' | 'scheduled' | 'open' | 'ended' | 'cancelled'; startsAt: number | null; endsAt: number; endedAt: number | null; updatedAt: number
  participants: number; entries: number
  winners: { userId: string; status: 'winner' | 'rerolled' | 'expired'; drawnAt: number; claimedAt: number | null; user?: { name: string | null; avatar: string | null } }[]
  draw: { at: number; pool: number; skipped: { userId: string; reason: string }[]; picks: { userId: string; entries: number; of: number }[]; method: string; rerolls?: { at: number; replaced: string[]; picks: string[]; reason: string }[] } | null
}
type Participant = { userId: string; guildName: string; entries: number; at: number; eligible: boolean; reason: string | null; user: { name: string | null; avatar: string | null } }

const STATUS = {
  draft: { label: 'Brouillon', tone: 'neutral' }, scheduled: { label: 'Programmé', tone: 'accent' }, open: { label: 'En cours', tone: 'success' },
  ended: { label: 'Terminé', tone: 'neutral' }, cancelled: { label: 'Annulé', tone: 'danger' },
} as const
const DEFAULT_SETTINGS: Settings = {
  requiredRoleIds: [], requiredMode: 'any', blockedRoleIds: [], minAccountAgeDays: 0, minMemberDays: 0, minMessages: 0, minVoiceHours: 0, activityDays: 30,
  requiredGuildIds: [], noActiveSanction: true, noWarnDays: 0, excludeStaff: false, excludeRecentWinnersDays: 0, bonusRoles: [], bonusMode: 'sum', maxEntries: 10,
  winnerRoleId: null, winnerRoleDays: 0, claimMinutes: 0, dmWinners: true, winnerMessage: 'Bravo {winners} ! Vous gagnez **{prize}** 🎉', color: '#e5484d', image: null,
}
const toLocal = (at: number | null) => (at ? new Date(at - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const fromLocal = (value: string) => (value ? new Date(value).getTime() : null)

function GiveawaysPage() {
  const { can } = useMe()
  const { data: list } = useQuery({ queryKey: ['giveaways'], queryFn: () => api<Giveaway[]>('/giveaways'), refetchInterval: 10_000 })
  const guilds = useQuery({ queryKey: ['giveaways-targets'], queryFn: () => api<AnnouncementTargetsPayload>('/giveaways/targets') })
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  return (
    <Page
      title='Giveaways'
      description='Des lots à gagner, avec conditions d’entrée, entrées bonus par rôle, tirage vérifiable, réclamation et relance automatique si un gagnant ne se manifeste pas.'
      actions={can('giveaways.manage') && <Button onClick={() => setSelected('new')}><Plus /> Nouveau giveaway</Button>}
    >
      <div className='grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]'>
        <Section title='Giveaways'>
          {!list ? <Skeleton className='m-4 h-24' /> : !list.length ? <EmptyState title='Aucun giveaway'>Lance le premier, ou utilise /giveaway creer.</EmptyState> : (
            <ul className='divide-y'>
              {list.map((g) => (
                <li key={g.id}>
                  <button type='button' onClick={() => setSelected(g.id)} className={cn('w-full px-4 py-3 text-start transition-colors hover:bg-accent/40', selected === g.id && 'bg-primary/10')}>
                    <div className='flex items-center gap-2'>
                      <Gift className='size-4 shrink-0 text-primary' />
                      <span className='min-w-0 flex-1 truncate font-medium'>{g.prize}</span>
                      <Pill tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Pill>
                    </div>
                    <div className='text-xs text-muted-foreground'>#{g.id} · {g.participants} participant{g.participants > 1 ? 's' : ''} · {g.status === 'open' ? `fin ${dateTime(g.endsAt)}` : g.status === 'ended' ? `terminé ${dateTime(g.endedAt)}` : dateTime(g.endsAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {selected !== null && guilds.data
          ? <Detail key={`${selected}-${list?.find((g) => g.id === selected)?.updatedAt ?? 0}`} id={selected === 'new' ? null : selected} guilds={guilds.data} onSaved={setSelected} onDeleted={() => setSelected(null)} />
          : <div className='grid place-items-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground'>Choisis un giveaway ou crées-en un.</div>}
      </div>
    </Page>
  )
}

function Detail({ id, guilds, onSaved, onDeleted }: { id: number | null; guilds: AnnouncementTargetsPayload; onSaved: (id: number) => void; onDeleted: () => void }) {
  const { data } = useQuery({ queryKey: ['giveaway', id], queryFn: () => api<Giveaway>(`/giveaways/${id}`), enabled: id !== null, refetchInterval: 5000 })
  if (id !== null && !data) return <Skeleton className='h-96 w-full' />
  if (!data) return <Form giveaway={null} guilds={guilds} onSaved={onSaved} onDeleted={onDeleted} />
  return (
    <Tabs defaultValue={data.status === 'draft' ? 'settings' : 'overview'}>
      <TabsList>
        <TabsTrigger value='overview'>Suivi</TabsTrigger>
        <TabsTrigger value='participants'>Participants ({data.participants})</TabsTrigger>
        <TabsTrigger value='settings'>Réglages</TabsTrigger>
      </TabsList>
      <TabsContent value='overview' className='mt-4'><Overview g={data} onSaved={onSaved} /></TabsContent>
      <TabsContent value='participants' className='mt-4'><Participants id={data.id} /></TabsContent>
      <TabsContent value='settings' className='mt-4'><Form key={data.updatedAt} giveaway={data} guilds={guilds} onSaved={onSaved} onDeleted={onDeleted} /></TabsContent>
    </Tabs>
  )
}

function Overview({ g, onSaved }: { g: Giveaway; onSaved: (id: number) => void }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'end' | 'cancel' | 'reroll' | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['giveaways'] }); qc.invalidateQueries({ queryKey: ['giveaway', g.id] }) }
  const act = useMutation({
    mutationFn: (kind: 'end' | 'cancel' | 'reroll') => api(`/giveaways/${g.id}/${kind}`, { method: 'POST', body: { confirm: true } }),
    onSuccess: (_, kind) => { toast.success({ end: 'Tirage effectué', cancel: 'Giveaway annulé', reroll: 'Nouveau gagnant tiré' }[kind]); setConfirm(null); refresh() },
  })
  const duplicate = useMutation({ mutationFn: () => api<Giveaway>(`/giveaways/${g.id}/duplicate`, { method: 'POST' }), onSuccess: (d) => { toast.success('Dupliqué'); qc.invalidateQueries({ queryKey: ['giveaways'] }); onSaved(d.id) } })
  const winners = g.winners.filter((w) => w.status === 'winner')
  return (
    <div className='grid gap-6'>
      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='rounded-lg border bg-card p-4'><div className='text-xs text-muted-foreground'>Participants</div><div className='text-2xl font-semibold tabular-nums'>{g.participants}</div></div>
        <div className='rounded-lg border bg-card p-4'><div className='text-xs text-muted-foreground'>Entrées (avec bonus)</div><div className='text-2xl font-semibold tabular-nums'>{g.entries}</div></div>
        <div className='rounded-lg border bg-card p-4'><div className='text-xs text-muted-foreground'>{g.status === 'open' ? 'Fin' : 'Statut'}</div><div className='text-lg font-semibold'>{g.status === 'open' ? dateTime(g.endsAt) : STATUS[g.status].label}</div></div>
      </div>
      {can('giveaways.manage') && (
        <div className='flex flex-wrap gap-2'>
          {g.status === 'open' && <Button onClick={() => setConfirm('end')}><Dices /> Tirer au sort maintenant</Button>}
          {g.status === 'ended' && <Button variant='outline' onClick={() => setConfirm('reroll')}><Dices /> Un gagnant de plus</Button>}
          {(g.status === 'open' || g.status === 'scheduled' || g.status === 'draft') && <Button variant='ghost' className='text-destructive' onClick={() => setConfirm('cancel')}><Ban /> Annuler</Button>}
          <Button variant='outline' onClick={() => duplicate.mutate()}><Copy /> Dupliquer</Button>
          <Button variant='outline' asChild><a href={`/api/giveaways/${g.id}/export`}><Download /> CSV</a></Button>
        </div>
      )}
      <Section title={`Gagnants (${winners.length}/${g.winnersCount})`}>
        {!g.winners.length ? <EmptyState title='Pas encore de tirage'>Le tirage a lieu à la fin, ou avec « Tirer au sort maintenant ».</EmptyState> : (
          <ul className='divide-y'>
            {g.winners.map((w) => (
              <li key={`${w.userId}${w.drawnAt}`} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', w.status !== 'winner' && 'opacity-60')}>
                <UserAvatar src={w.user?.avatar} name={w.user?.name ?? w.userId} />
                <div className='min-w-40 flex-1'>
                  <div className='flex items-center gap-2 font-medium'>{w.status === 'winner' && <Trophy className='size-4 text-warning' />}{w.user?.name ?? w.userId}</div>
                  <div className='text-xs text-muted-foreground'>Tiré le {dateTime(w.drawnAt)}{w.claimedAt ? ` · réclamé le ${dateTime(w.claimedAt)}` : ''}</div>
                </div>
                {w.status === 'winner' && (g.settings.claimMinutes ? (w.claimedAt ? <Pill tone='success'>Réclamé</Pill> : <Pill tone='warning'>En attente</Pill>) : <Pill tone='success'>Gagnant</Pill>)}
                {w.status === 'rerolled' && <Pill>Remplacé</Pill>}
                {w.status === 'expired' && <Pill tone='danger'>Non réclamé</Pill>}
                {w.status === 'winner' && g.status === 'ended' && can('giveaways.manage') && (
                  <Button size='sm' variant='ghost' onClick={() => api(`/giveaways/${g.id}/reroll`, { method: 'POST', body: { confirm: true, userId: w.userId } }).then(() => { toast.success('Gagnant remplacé'); refresh() }).catch((e: Error) => toast.error(e.message))}>
                    <X /> Remplacer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {g.draw && (
        <Section title='Journal du tirage' description={g.draw.method}>
          <div className='grid gap-2 p-4 text-sm'>
            <p>Tirage le {dateTime(g.draw.at)} parmi {g.draw.pool} participant(s) éligible(s).</p>
            {g.draw.picks.map((p, i) => <p key={i} className='text-muted-foreground'>#{i + 1} : {p.userId} ({p.entries} entrée(s) sur {p.of})</p>)}
            {g.draw.skipped.length > 0 && <p className='text-muted-foreground'>{g.draw.skipped.length} écarté(s) au tirage : {g.draw.skipped.slice(0, 5).map((s) => s.reason).join(' · ')}</p>}
            {g.draw.rerolls?.map((r, i) => <p key={i} className='text-muted-foreground'>Relance le {dateTime(r.at)} ({r.reason === 'expired' ? 'lot non réclamé' : 'manuelle'}) : {r.picks.join(', ') || 'personne'}</p>)}
          </div>
        </Section>
      )}
      <ConfirmDialog
        open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}
        title={{ end: 'Tirer au sort maintenant ?', cancel: 'Annuler ce giveaway ?', reroll: 'Tirer un gagnant de plus ?' }[confirm ?? 'end']}
        desc={{ end: 'Le giveaway se termine et les gagnants sont annoncés dans chaque salon.', cancel: 'Personne ne gagnera ; le message indique que le giveaway est annulé.', reroll: 'Un nouveau gagnant est tiré parmi ceux qui n’ont pas encore gagné.' }[confirm ?? 'end']}
        confirmText='Confirmer' destructive={confirm === 'cancel'} isLoading={act.isPending}
        handleConfirm={() => confirm && act.mutate(confirm)}
      />
    </div>
  )
}

function Participants({ id }: { id: number }) {
  const { data } = useQuery({ queryKey: ['giveaway-participants', id], queryFn: () => api<Participant[]>(`/giveaways/${id}/participants`) })
  if (!data) return <Skeleton className='h-60 w-full' />
  if (!data.length) return <EmptyState title='Aucun participant pour l’instant' />
  return (
    <Section title={`${data.length} participant${data.length > 1 ? 's' : ''}`}>
      <ul className='divide-y'>
        {data.map((p) => (
          <li key={p.userId} className='flex flex-wrap items-center gap-3 px-4 py-2.5'>
            <UserAvatar src={p.user.avatar} name={p.user.name ?? p.userId} className='size-8' />
            <div className='min-w-40 flex-1'>
              <div className='text-sm font-medium'>{p.user.name ?? p.userId}</div>
              <div className='text-xs text-muted-foreground'>{p.guildName} · inscrit le {dateTime(p.at)}</div>
            </div>
            {p.entries > 1 && <Pill tone='accent'>×{p.entries}</Pill>}
            {p.eligible ? <Pill tone='success'>Éligible</Pill> : <Pill tone='danger'>{p.reason}</Pill>}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Form({ giveaway, guilds, onSaved, onDeleted }: { giveaway: Giveaway | null; guilds: AnnouncementTargetsPayload; onSaved: (id: number) => void; onDeleted: () => void }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const editable = can('giveaways.manage') && (!giveaway || !['ended', 'cancelled'].includes(giveaway.status))
  const started = Boolean(giveaway && giveaway.status === 'open')
  const [prize, setPrize] = useState(giveaway?.prize ?? '')
  const [description, setDescription] = useState(giveaway?.description ?? '')
  const [winnersCount, setWinnersCount] = useState(giveaway?.winnersCount ?? 1)
  const [s, setS] = useState<Settings>({ ...DEFAULT_SETTINGS, ...giveaway?.settings })
  const [targets, setTargets] = useState<AnnouncementTarget[]>(giveaway?.targets ?? [])
  const [startsAt, setStartsAt] = useState(toLocal(giveaway?.startsAt ?? null))
  // Lazy initial value: tomorrow at the same time for a new giveaway
  const [endsAt, setEndsAt] = useState(() => toLocal(giveaway?.endsAt ?? Date.now() + 86_400_000))
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }))
  const allRoles = guilds.flatMap((g) => g.roles.map((r) => ({ ...r, name: guilds.length > 1 ? `${r.name} (${g.name})` : r.name, position: 0, editable: true, dangerous: false })))
  const body = () => ({ prize, description, winnersCount, settings: { ...s, image: s.image || null }, targets, startsAt: fromLocal(startsAt), endsAt: fromLocal(endsAt) })
  const after = (g: Giveaway, label: string) => { toast.success(label); qc.invalidateQueries({ queryKey: ['giveaways'] }); qc.invalidateQueries({ queryKey: ['giveaway', g.id] }); onSaved(g.id) }
  const saveThen = () => (giveaway ? api<Giveaway>(`/giveaways/${giveaway.id}`, { method: 'PUT', body: body() }) : api<Giveaway>('/giveaways', { method: 'POST', body: body() }))
  const save = useMutation({ mutationFn: saveThen, onSuccess: (g) => after(g, 'Enregistré') })
  const publish = useMutation({ mutationFn: async () => api<Giveaway>(`/giveaways/${(await saveThen()).id}/publish`, { method: 'POST' }), onSuccess: (g) => after(g, g.status === 'scheduled' ? 'Giveaway programmé' : 'Giveaway lancé') })
  const remove = useMutation({ mutationFn: () => api(`/giveaways/${giveaway!.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Supprimé'); qc.invalidateQueries({ queryKey: ['giveaways'] }); onDeleted() } })

  const num = (label: string, value: number, onChange: (n: number) => void, id: string, hint?: string) => (
    <div className='grid gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type='number' min={0} value={value} disabled={!editable} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
    </div>
  )

  return (
    <div className='grid gap-6'>
      <Section title={giveaway ? 'Réglages' : 'Nouveau giveaway'} actions={giveaway && can('giveaways.manage') && <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setDeleting(true)}><Trash2 /> Supprimer</Button>}>
        <div className='grid gap-4 p-4'>
          <div className='grid gap-4 sm:grid-cols-[1fr_8rem_6rem]'>
            <div className='grid gap-1.5'><Label htmlFor='g-prize'>Lot</Label><Input id='g-prize' value={prize} maxLength={200} disabled={!editable} onChange={(e) => setPrize(e.target.value)} placeholder='Voiture de sport en jeu' /></div>
            <div className='grid gap-1.5'><Label htmlFor='g-w'>Gagnants</Label><Input id='g-w' type='number' min={1} max={50} value={winnersCount} disabled={!editable} onChange={(e) => setWinnersCount(Number(e.target.value) || 1)} /></div>
            <div className='grid gap-1.5'><Label htmlFor='g-c'>Couleur</Label><Input id='g-c' type='color' className='h-9 p-1' value={s.color} disabled={!editable} onChange={(e) => set({ color: e.target.value })} /></div>
          </div>
          <div className='grid gap-1.5'><Label htmlFor='g-desc'>Description</Label><Textarea id='g-desc' rows={3} maxLength={2000} value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className='grid gap-1.5'><Label htmlFor='g-img'>Image (adresse https)</Label><Input id='g-img' value={s.image ?? ''} placeholder='https://…' disabled={!editable} onChange={(e) => set({ image: e.target.value })} /></div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'><Label htmlFor='g-start'>Début (vide = au lancement)</Label><Input id='g-start' type='datetime-local' value={startsAt} disabled={!editable || started} onChange={(e) => setStartsAt(e.target.value)} /></div>
            <div className='grid gap-1.5'><Label htmlFor='g-end'>Fin</Label><Input id='g-end' type='datetime-local' value={endsAt} disabled={!editable} onChange={(e) => setEndsAt(e.target.value)} /></div>
          </div>
        </div>
      </Section>

      <Section title='Conditions pour participer' description='Si une condition manque, le membre voit exactement laquelle. Elles sont revérifiées au moment du tirage.'>
        <div className='grid gap-4 p-4'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label>Rôles requis</Label>
              <RolesPicker roles={allRoles} value={s.requiredRoleIds} disabled={!editable} onChange={(ids) => set({ requiredRoleIds: ids })} placeholder='Tout le monde' label='Rôles requis' />
              {s.requiredRoleIds.length > 1 && (
                <Select value={s.requiredMode} disabled={!editable} onValueChange={(v) => set({ requiredMode: v as 'any' | 'all' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value='any'>Au moins un</SelectItem><SelectItem value='all'>Tous</SelectItem></SelectContent>
                </Select>
              )}
            </div>
            <div className='grid content-start gap-1.5'><Label>Rôles exclus</Label><RolesPicker roles={allRoles} value={s.blockedRoleIds} disabled={!editable} onChange={(ids) => set({ blockedRoleIds: ids })} placeholder='Aucun' label='Rôles exclus' /></div>
          </div>
          <div className='grid gap-4 sm:grid-cols-3'>
            {num('Âge du compte (jours)', s.minAccountAgeDays, (n) => set({ minAccountAgeDays: n }), 'g-age')}
            {num('Ancienneté sur le serveur (jours)', s.minMemberDays, (n) => set({ minMemberDays: n }), 'g-seniority')}
            {num('Pas d’avertissement depuis (jours)', s.noWarnDays, (n) => set({ noWarnDays: n }), 'g-warn')}
            {num('Messages minimum', s.minMessages, (n) => set({ minMessages: n }), 'g-msg')}
            {num('Heures de vocal minimum', s.minVoiceHours, (n) => set({ minVoiceHours: n }), 'g-voice')}
            {num('…sur les derniers (jours)', s.activityDays, (n) => set({ activityDays: n || 30 }), 'g-days')}
            {num('Gagnants récents exclus (jours)', s.excludeRecentWinnersDays, (n) => set({ excludeRecentWinnersDays: n }), 'g-recent')}
          </div>
          <div className='grid gap-2 text-sm'>
            <label className='flex items-center gap-2'><Checkbox checked={s.noActiveSanction} disabled={!editable} onCheckedChange={(v) => set({ noActiveSanction: v === true })} /> Aucune sanction en cours</label>
            <label className='flex items-center gap-2'><Checkbox checked={s.excludeStaff} disabled={!editable} onCheckedChange={(v) => set({ excludeStaff: v === true })} /> Le staff ne participe pas</label>
          </div>
          {guilds.length > 1 && (
            <fieldset>
              <legend className='mb-2 text-sm font-medium'>Être aussi membre de</legend>
              <div className='flex flex-wrap gap-3'>
                {guilds.map((g) => (
                  <label key={g.id} className='flex items-center gap-2 text-sm'>
                    <Checkbox checked={s.requiredGuildIds.includes(g.id)} disabled={!editable} onCheckedChange={() => set({ requiredGuildIds: s.requiredGuildIds.includes(g.id) ? s.requiredGuildIds.filter((x) => x !== g.id) : [...s.requiredGuildIds, g.id] })} />
                    {g.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </Section>

      <Section title='Chances et récompenses'>
        <div className='grid gap-4 p-4'>
          <fieldset className='grid gap-2'>
            <legend className='mb-1 text-sm font-medium'>Entrées bonus par rôle</legend>
            {s.bonusRoles.map((b, i) => (
              <div key={i} className='grid gap-2 sm:grid-cols-[1fr_8rem_auto]'>
                <Select value={b.roleId} disabled={!editable} onValueChange={(v) => set({ bonusRoles: s.bonusRoles.map((x, j) => (j === i ? { ...x, roleId: v } : x)) })}>
                  <SelectTrigger aria-label='Rôle bonus'><SelectValue placeholder='Rôle' /></SelectTrigger>
                  <SelectContent>{allRoles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type='number' min={2} max={50} value={b.entries} aria-label='Entrées' disabled={!editable} onChange={(e) => set({ bonusRoles: s.bonusRoles.map((x, j) => (j === i ? { ...x, entries: Number(e.target.value) || 2 } : x)) })} />
                <Button size='icon' variant='ghost' aria-label='Retirer' disabled={!editable} onClick={() => set({ bonusRoles: s.bonusRoles.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            ))}
            {editable && s.bonusRoles.length < 10 && <Button size='sm' variant='outline' className='justify-self-start' onClick={() => set({ bonusRoles: [...s.bonusRoles, { roleId: '', entries: 2 }] })}><Plus /> Rôle bonus</Button>}
            <div className='flex flex-wrap items-end gap-3'>
              <div className='grid gap-1.5'>
                <Label>Plusieurs bonus</Label>
                <Select value={s.bonusMode} disabled={!editable} onValueChange={(v) => set({ bonusMode: v as 'sum' | 'max' })}>
                  <SelectTrigger className='w-56'><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value='sum'>Se cumulent</SelectItem><SelectItem value='max'>Seul le plus fort compte</SelectItem></SelectContent>
                </Select>
              </div>
              <div className='grid gap-1.5'><Label htmlFor='g-maxe'>Entrées maximum</Label><Input id='g-maxe' type='number' className='w-28' min={1} max={100} value={s.maxEntries} disabled={!editable} onChange={(e) => set({ maxEntries: Number(e.target.value) || 1 })} /></div>
            </div>
          </fieldset>
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='grid gap-1.5'>
              <Label>Rôle donné aux gagnants</Label>
              <Select value={s.winnerRoleId ?? 'none'} disabled={!editable} onValueChange={(v) => set({ winnerRoleId: v === 'none' ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='none'>Aucun</SelectItem>{allRoles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {num('…pendant (jours, 0 = pour de bon)', s.winnerRoleDays, (n) => set({ winnerRoleDays: n }), 'g-rdays')}
            {num('Délai pour réclamer (minutes)', s.claimMinutes, (n) => set({ claimMinutes: n }), 'g-claim', '0 = pas de réclamation ; sinon relance automatique')}
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='g-msg-w'>Annonce des gagnants</Label>
            <Input id='g-msg-w' value={s.winnerMessage} maxLength={1000} disabled={!editable} onChange={(e) => set({ winnerMessage: e.target.value })} />
            <p className='text-xs text-muted-foreground'>{'{winners}'} = mentions des gagnants, {'{prize}'} = le lot</p>
          </div>
          <label className='flex items-center gap-2 text-sm'><Checkbox checked={s.dmWinners} disabled={!editable} onCheckedChange={(v) => set({ dmWinners: v === true })} /> Prévenir les gagnants en message privé</label>
        </div>
      </Section>

      <Section title='Publication'>
        <div className='p-4'><TargetsEditor guilds={guilds} targets={targets} onChange={setTargets} disabled={!editable || started} /></div>
      </Section>

      {editable && (
        <div className='flex flex-wrap justify-end gap-2'>
          <Button variant='outline' onClick={() => save.mutate()} disabled={!prize.trim() || !endsAt || save.isPending}><Save /> Enregistrer</Button>
          {(!giveaway || giveaway.status === 'draft') && <Button onClick={() => publish.mutate()} disabled={!prize.trim() || !endsAt || !targets.length || publish.isPending}><Send /> {startsAt ? 'Programmer' : 'Lancer'}</Button>}
        </div>
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title='Supprimer ce giveaway ?' desc='Ses messages sont supprimés de Discord, avec les participations.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </div>
  )
}
