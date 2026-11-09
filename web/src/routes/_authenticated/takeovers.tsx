import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Send, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, FormDef, Guild } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, UserAvatar, GuildIcon } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { useConfirm } from '@/components/app/confirm'
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

export const Route = createFileRoute('/_authenticated/takeovers')({
  component: TakeoversPage,
})

type Category = 'business' | 'illegal'
type Entry = {
  id: number; userId: string; name: string; avatar: string | null; answers: { id: string; label: string; value: string }[]
  status: 'active' | 'removed'; dmStatus: 'sent' | 'failed' | null; createdAt: number
}
type Takeover = {
  id: number; category: Category; name: string; description: string; mode: 'form' | 'simple'; open: boolean
  interviewAt: number | null; convokedAt: number | null; winnerId: string | null; winnerName: string | null; finishedAt: number | null; entries: Entry[]
}
type CategoryConfig = { panelChannelId: string | null; panelMessageId: string | null; announceChannelId: string | null; convokeMessage: string; announceMessage: string; form: FormDef }
type Config = Record<Category, CategoryConfig>
type Payload = { config: Config; takeovers: Takeover[]; channels: Channel[] }
type Draft = { id?: number; category: Category; name: string; description: string; mode: 'form' | 'simple'; date: string; locked: boolean }

const LABELS: Record<Category, { tab: string; one: string; hint: string }> = {
  business: { tab: 'Entreprises', one: 'entreprise', hint: 'Par exemple « Benny’s » ou « Bahama Mamas ».' },
  illegal: { tab: 'Groupes illégaux', one: 'groupe', hint: 'Par exemple un gang ou une organisation criminelle.' },
}
const CATEGORIES = Object.keys(LABELS) as Category[]

// datetime-local value <-> timestamp
const toInput = (at: number) => new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const fromInput = (v: string) => new Date(v).getTime()

function TakeoversPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id
  const currentGuild = active.find((g) => g.id === current)
  return (
    <Page
      title='Reprises'
      description='Liste les entreprises et groupes illégaux à reprendre. Les joueurs s’inscrivent depuis Discord, reçoivent un MP à la date des entretiens, puis tu annonces qui reprend.'
      actions={current && (
        <div className='flex items-center gap-2'>
          <Label htmlFor='to-guild' className='text-muted-foreground'>Serveur</Label>
          <Select value={current} onValueChange={setGuildId}>
            <SelectTrigger id='to-guild' className='w-60 max-w-full'><span className='flex items-center gap-2 truncate'>{currentGuild && <GuildIcon src={currentGuild.icon} name={currentGuild.name} className='size-5' />}<SelectValue /></span></SelectTrigger>
            <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      {current && <Takeovers key={current} guildId={current} />}
    </Page>
  )
}

function Takeovers({ guildId }: { guildId: string }) {
  const { can } = useMe()
  const { data } = useQuery({ queryKey: ['takeovers', guildId], queryFn: () => api<Payload>(`/takeovers/${guildId}`), refetchInterval: 20_000 })
  if (!data) return <Skeleton className='h-96 w-full' />
  return (
    <Tabs defaultValue='business'>
      <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
        {CATEGORIES.map((c) => <TabsTrigger key={c} value={c}>{LABELS[c].tab} ({data.takeovers.filter((t) => t.category === c && !t.finishedAt).length})</TabsTrigger>)}
        {can('takeovers.manage') && <TabsTrigger value='settings'>Réglages</TabsTrigger>}
      </TabsList>
      {CATEGORIES.map((c) => <TabsContent key={c} value={c} className='mt-4'><TakeoverList data={data} guildId={guildId} category={c} /></TabsContent>)}
      {can('takeovers.manage') && <TabsContent value='settings' className='mt-4'><Settings config={data.config} channels={data.channels} guildId={guildId} /></TabsContent>}
    </Tabs>
  )
}

function statePill(t: Takeover) {
  if (t.finishedAt) return <Pill tone='success'>Reprise par {t.entries.find((e) => e.userId === t.winnerId)?.name ?? t.winnerName ?? t.winnerId}</Pill>
  if (t.convokedAt) return <Pill tone='info'>MP envoyés</Pill>
  return t.open ? <Pill tone='success'>Inscriptions ouvertes</Pill> : <Pill>Inscriptions fermées</Pill>
}

function TakeoverList({ data, guildId, category }: { data: Payload; guildId: string; category: Category }) {
  const { can } = useMe()
  const manage = can('takeovers.manage')
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [editing, setEditing] = useState<Draft | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['takeovers', guildId] })
  const setOpen = useMutation({
    mutationFn: ({ t, open }: { t: Takeover; open: boolean }) => api(`/takeovers/items/${t.id}/open`, { method: 'POST', body: { open } }),
    onSuccess: (_, v) => { toast.success(v.open ? `Inscriptions ouvertes : ${v.t.name}` : `Inscriptions fermées : ${v.t.name}`); refresh() },
  })
  const remove = useMutation({
    mutationFn: (t: Takeover) => api(`/takeovers/items/${t.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Reprise supprimée'); refresh() },
  })
  const askRemove = async (t: Takeover) => {
    if (await confirm({ title: `Supprimer ${t.name} ?`, desc: 'La reprise et la liste de ses inscrits seront effacées.', confirmText: 'Supprimer', destructive: true })) remove.mutate(t)
  }
  const list = data.takeovers.filter((t) => t.category === category)
  const running = list.filter((t) => !t.finishedAt)
  const finished = list.filter((t) => t.finishedAt)
  const viewed = data.takeovers.find((t) => t.id === viewing)
  const row = (t: Takeover) => {
    const count = t.entries.filter((e) => e.status === 'active').length
    return (
      <li key={t.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
        <div className='min-w-48 flex-1'>
          <div className='flex flex-wrap items-center gap-2 font-medium'>{t.name} {statePill(t)}</div>
          <div className='text-xs text-muted-foreground'>
            {t.mode === 'form' ? 'Dossier' : 'Inscription simple'} · {count} inscrit{count > 1 ? 's' : ''}
            {t.finishedAt ? ` · terminée le ${dateTime(t.finishedAt)}` : t.interviewAt && !t.convokedAt ? ` · entretiens le ${dateTime(t.interviewAt)}` : ''}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {manage && !t.finishedAt && (
            <label className='flex items-center gap-2 text-sm'>
              <Switch checked={t.open} disabled={setOpen.isPending || Boolean(t.convokedAt)} onCheckedChange={(open) => setOpen.mutate({ t, open })} aria-label={`Inscriptions ${t.name}`} />
              <span className='hidden sm:inline'>Inscriptions</span>
            </label>
          )}
          <Button size='sm' variant='outline' onClick={() => setViewing(t.id)}><Users /> Inscrits</Button>
          {manage && !t.finishedAt && <Button size='sm' variant='outline' onClick={() => setEditing({ id: t.id, category, name: t.name, description: t.description, mode: t.mode, date: t.interviewAt ? toInput(t.interviewAt) : '', locked: Boolean(t.convokedAt) })}>Modifier</Button>}
          {manage && <Button size='sm' variant='danger-ghost' aria-label={`Supprimer ${t.name}`} onClick={() => void askRemove(t)}><Trash2 /></Button>}
        </div>
      </li>
    )
  }
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <Section title={`À reprendre (${running.length})`} actions={manage && <Button size='sm' onClick={() => setEditing({ category, name: '', description: '', mode: 'simple', date: '', locked: false })}><Plus /> Nouvelle reprise</Button>}>
        {!running.length ? <EmptyState title={`Aucun ${LABELS[category].one} à reprendre`}>{LABELS[category].hint}</EmptyState> : <ul className='divide-y'>{running.map(row)}</ul>}
      </Section>
      {finished.length > 0 && <Section title={`Terminées (${finished.length})`}><ul className='divide-y'>{finished.map(row)}</ul></Section>}
      {editing && <EditDialog draft={editing} guildId={guildId} onClose={() => setEditing(null)} onSaved={refresh} />}
      {viewed && <EntriesDialog takeover={viewed} manage={manage} onClose={() => setViewing(null)} onChanged={refresh} />}
      {dialog}
    </div>
  )
}

function EditDialog({ draft, guildId, onClose, onSaved }: { draft: Draft; guildId: string; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState(draft)
  const save = useMutation({
    mutationFn: () => api(`/takeovers/${guildId}/items`, { method: 'PUT', body: { id: t.id, category: t.category, name: t.name, description: t.description, mode: t.mode, interviewAt: t.date ? fromInput(t.date) : null } }),
    onSuccess: () => { toast.success('Reprise enregistrée'); onSaved(); onClose() },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader><DialogTitle>{t.id ? `Modifier ${draft.name}` : `Nouvelle reprise : ${LABELS[t.category].tab.toLowerCase()}`}</DialogTitle></DialogHeader>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
          <div className='grid gap-1.5'><Label htmlFor='to-name'>Nom</Label><Input id='to-name' maxLength={60} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></div>
          <div className='grid gap-1.5'><Label htmlFor='to-desc'>Description</Label><Textarea id='to-desc' rows={3} maxLength={1000} value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} /></div>
          <div className='grid gap-1.5'>
            <Label htmlFor='to-mode'>Type d’inscription</Label>
            <Select value={t.mode} onValueChange={(mode) => setT({ ...t, mode: mode as Draft['mode'] })}>
              <SelectTrigger id='to-mode'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='simple'>Inscription simple (un clic)</SelectItem>
                <SelectItem value='form'>Dossier (formulaire à remplir)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='to-date'>Date des entretiens (facultatif)</Label>
            <Input id='to-date' type='datetime-local' disabled={t.locked} value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} />
            <p className='text-xs text-muted-foreground'>{t.locked ? 'Les inscrits ont déjà reçu leur MP.' : 'À cette date, les inscriptions se ferment et chaque inscrit reçoit un MP.'}</p>
          </div>
          <p className='text-xs text-muted-foreground'>La reprise est créée inscriptions fermées : ouvre-les depuis la liste quand tu es prêt.</p>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} disabled={!t.name.trim()} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EntriesDialog({ takeover: t, manage, onClose, onChanged }: { takeover: Takeover; manage: boolean; onClose: () => void; onChanged: () => void }) {
  const { confirm, dialog } = useConfirm()
  const [opened, setOpened] = useState<number | null>(null)
  const convoke = useMutation({
    mutationFn: () => api<{ sent: number; failed: number }>(`/takeovers/items/${t.id}/convoke`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`${r.sent} MP envoyé${r.sent > 1 ? 's' : ''}`)
      if (r.failed) toast.warning(`${r.failed} inscrit${r.failed > 1 ? 's n’ont' : ' n’a'} pas pu recevoir le MP (messages privés fermés).`)
      onChanged()
    },
  })
  const removeEntry = useMutation({ mutationFn: (e: Entry) => api(`/takeovers/entries/${e.id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Inscription écartée'); onChanged() } })
  const finish = useMutation({
    mutationFn: (e: Entry) => api(`/takeovers/items/${t.id}/finish`, { method: 'POST', body: { userId: e.userId } }),
    onSuccess: (_, e) => { toast.success(`${e.name} reprend ${t.name} : annonce publiée`); onChanged(); onClose() },
  })
  const askConvoke = async () => {
    if (await confirm({ title: 'Prévenir les inscrits maintenant ?', desc: 'Chaque inscrit reçoit son MP et les inscriptions se ferment définitivement.', confirmText: 'Envoyer les MP' })) convoke.mutate()
  }
  const askFinish = async (e: Entry) => {
    if (await confirm({ title: `${e.name} reprend ${t.name} ?`, desc: 'L’annonce est publiée tout de suite et la reprise se termine. Ce choix est définitif.', confirmText: 'Publier l’annonce' })) finish.mutate(e)
  }
  const askRemove = async (e: Entry) => {
    if (await confirm({ title: `Écarter ${e.name} ?`, desc: 'Cette personne ne pourra plus s’inscrire à cette reprise.', confirmText: 'Écarter', destructive: true })) removeEntry.mutate(e)
  }
  const running = !t.finishedAt
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader><DialogTitle>Inscrits : {t.name}</DialogTitle></DialogHeader>
        {manage && running && !t.convokedAt && t.entries.length > 0 && (
          <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm'>
            <span className='min-w-48 flex-1 text-muted-foreground'>{t.interviewAt ? `MP automatique le ${dateTime(t.interviewAt)}.` : 'Aucune date prévue : le MP part quand tu le décides.'}</span>
            <Button size='sm' variant='outline' loading={convoke.isPending} onClick={() => void askConvoke()}><Send /> Envoyer le MP maintenant</Button>
          </div>
        )}
        {!t.entries.length ? <EmptyState title='Aucun inscrit'>Les inscriptions arrivent depuis le panneau Discord.</EmptyState> : (
          <ul className='divide-y'>
            {t.entries.map((e) => (
              <li key={e.id} className='grid grid-cols-[minmax(0,1fr)] gap-2 py-3'>
                <div className='flex flex-wrap items-center gap-3'>
                  <UserAvatar src={e.avatar} name={e.name} />
                  <div className='min-w-40 flex-1'>
                    <div className='flex flex-wrap items-center gap-2 font-medium'>
                      {e.name}
                      {e.status === 'removed' && <Pill>Écartée</Pill>}
                      {e.dmStatus === 'sent' && <Pill tone='success'>MP reçu</Pill>}
                      {e.dmStatus === 'failed' && <Pill tone='danger'>MP fermés</Pill>}
                      {t.winnerId === e.userId && <Pill tone='success'>Repreneur</Pill>}
                    </div>
                    <div className='text-xs text-muted-foreground'>Inscrit le {dateTime(e.createdAt)}</div>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {e.answers.length > 0 && <Button size='sm' variant='outline' onClick={() => setOpened(opened === e.id ? null : e.id)}>{opened === e.id ? 'Masquer' : 'Dossier'}</Button>}
                    {manage && running && e.status === 'active' && <Button size='sm' variant='success' disabled={finish.isPending} onClick={() => void askFinish(e)}>Désigner</Button>}
                    {manage && running && e.status === 'active' && <Button size='sm' variant='danger-ghost' disabled={removeEntry.isPending} onClick={() => void askRemove(e)}>Écarter</Button>}
                  </div>
                </div>
                {opened === e.id && (
                  <dl className='grid gap-2 rounded-md border p-3 text-sm'>
                    {e.answers.map((a) => <div key={a.id}><dt className='text-xs text-muted-foreground'>{a.label}</dt><dd className='break-words whitespace-pre-wrap'>{a.value || '—'}</dd></div>)}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
        {dialog}
      </DialogContent>
    </Dialog>
  )
}

function Settings({ config, channels, guildId }: { config: Config; channels: Channel[]; guildId: string }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(config)
  const dirty = JSON.stringify(draft) !== JSON.stringify(config)
  const set = (c: Category, patch: Partial<CategoryConfig>) => setDraft({ ...draft, [c]: { ...draft[c], ...patch } })
  const refresh = () => qc.invalidateQueries({ queryKey: ['takeovers', guildId] })
  const save = useMutation({
    mutationFn: () => api<Config>(`/takeovers/${guildId}/config`, { method: 'PUT', body: draft }),
    onSuccess: (saved) => { setDraft(saved); toast.success('Réglages enregistrés'); refresh() },
  })
  const panel = useMutation({
    mutationFn: (category: Category) => api(`/takeovers/${guildId}/panel`, { method: 'POST', body: { category } }),
    onSuccess: () => { toast.success('Panneau publié'); refresh() },
  })
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {CATEGORIES.map((c) => (
        <Section key={c} title={LABELS[c].tab} actions={
          <Button size='sm' variant='outline' disabled={dirty || !config[c].panelChannelId} loading={panel.isPending && panel.variables === c} onClick={() => panel.mutate(c)}><Send /> {config[c].panelMessageId ? 'Republier le panneau' : 'Publier le panneau'}</Button>
        }>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'><Label>Salon du panneau</Label><ChannelSelect label='Salon du panneau' channels={channels} value={draft[c].panelChannelId} onChange={(panelChannelId) => set(c, { panelChannelId })} /></div>
              <div className='grid gap-1.5'><Label>Salon d’annonce du repreneur</Label><ChannelSelect label='Salon d’annonce du repreneur' channels={channels} value={draft[c].announceChannelId} onChange={(announceChannelId) => set(c, { announceChannelId })} /></div>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={`to-convoke-${c}`}>MP envoyé aux inscrits</Label>
              <Textarea id={`to-convoke-${c}`} rows={3} maxLength={1800} value={draft[c].convokeMessage} onChange={(e) => set(c, { convokeMessage: e.target.value })} />
              <p className='text-xs text-muted-foreground'>Variable : {'{nom}'}</p>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={`to-announce-${c}`}>Annonce du repreneur</Label>
              <Textarea id={`to-announce-${c}`} rows={3} maxLength={1800} value={draft[c].announceMessage} onChange={(e) => set(c, { announceMessage: e.target.value })} />
              <p className='text-xs text-muted-foreground'>Variables : {'{nom}'}, {'{repreneur}'}</p>
            </div>
            <div className='grid gap-1.5'>
              <Label>Formulaire du mode Dossier</Label>
              <FormBuilder value={draft[c].form} onChange={(form) => set(c, { form })} allowEmpty={false} />
            </div>
          </div>
        </Section>
      ))}
      <div className='flex flex-wrap items-center justify-end gap-3'>
        {dirty && <span className='text-sm text-muted-foreground'>Enregistre avant de publier un panneau.</span>}
        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
      </div>
    </div>
  )
}
