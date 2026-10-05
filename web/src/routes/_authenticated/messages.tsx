import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Save, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, AnnouncementTargetsPayload } from '@/lib/types'
import { ago } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SeeAlso, useConfirm, useDiscardGuard } from '@/components/app/confirm'
import { MESSAGES_SEE_ALSO, others } from '@/features/navigation/see-also'
import { publishConfirm } from '@/features/announcements/test-confirm'
import { EmbedFields, EMPTY_EMBED, cleanEmbed } from '@/features/announcements/embed-editor'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { ChannelTargets, type ChannelTarget } from '@/features/messages/channel-targets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { VariableButton } from '@/components/app/variable-picker'
import { DuplicateButton } from '@/components/app/duplicate-button'

export const Route = createFileRoute('/_authenticated/messages')({
  component: MessagesPage,
})

type LiveMessage = {
  id: number
  name: string
  payload: { content: string; embed: AnnouncementEmbed }
  refreshMinutes: number
  variables: Record<string, string>
  repost: boolean
  updatedAt: number
  refreshedAt: number | null
  targets: { id: number; guildId: string; channelId: string; messageId: string | null; error: string | null; updatedAt: number | null }[]
}
type Draft = { name: string; content: string; embed: AnnouncementEmbed; refreshMinutes: number; variables: [string, string][]; repost: boolean; targets: ChannelTarget[] }

const REFRESH = [
  { value: 0, label: 'Jamais (message fixe)' },
  { value: 1, label: 'Toutes les minutes' },
  { value: 5, label: 'Toutes les 5 minutes' },
  { value: 15, label: 'Toutes les 15 minutes' },
  { value: 60, label: 'Toutes les heures' },
  { value: 1440, label: 'Une fois par jour' },
]
const COUNTER_LABELS: Record<string, string> = {
  members: 'Membres', humans: 'Humains', bots: 'Bots', voice: 'En vocal', boosts: 'Boosts', staff: 'Staff',
  'network.members': 'Membres du réseau', 'network.voice': 'En vocal sur le réseau', 'network.servers': 'Serveurs du réseau',
  'tickets.open': 'Tickets ouverts', 'sanctions.today': 'Sanctions du jour', date: 'Date', time: 'Heure',
  'fivem.players': 'Joueurs FiveM', 'fivem.max': 'Places FiveM', 'fivem.status': 'État du serveur FiveM',
}
const BUILT_IN = ['members', 'humans', 'bots', 'voice', 'boosts', 'staff', 'network.members', 'network.voice', 'network.servers', 'tickets.open', 'sanctions.today', 'date', 'time', 'fivem.players', 'fivem.max', 'fivem.status']

function toDraft(m: LiveMessage | null): Draft {
  return {
    name: m?.name ?? '',
    content: m?.payload.content ?? '',
    embed: { ...EMPTY_EMBED, ...m?.payload.embed },
    refreshMinutes: m?.refreshMinutes ?? 0,
    variables: Object.entries(m?.variables ?? {}),
    repost: m?.repost ?? true,
    targets: m?.targets.map((t) => ({ guildId: t.guildId, channelId: t.channelId })) ?? [],
  }
}

function MessagesPage() {
  const { can } = useMe()
  const { data: list } = useQuery({ queryKey: ['live-messages'], queryFn: () => api<LiveMessage[]>('/messages'), refetchInterval: 30_000 })
  const guilds = useQuery({ queryKey: ['messages-targets'], queryFn: () => api<AnnouncementTargetsPayload>('/messages/targets') })
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  const [dirty, setDirty] = useState(false)
  const { guard, dialog } = useDiscardGuard(dirty)
  const select = (id: number | 'new' | null) => { if (id !== selected) void guard(() => { setDirty(false); setSelected(id) }) }
  const current = selected === 'new' ? null : list?.find((m) => m.id === selected) ?? null

  return (
    <Page
      title='Messages dynamiques'
      description='Un message posté dans un ou plusieurs salons du réseau et modifiable d’ici sans le renvoyer. Avec des variables, il se met à jour tout seul : membres, vocal, joueurs FiveM, date…'
      actions={can('messages.manage') && <Button onClick={() => select('new')}><Plus /> Nouveau message</Button>}
    >
      <SeeAlso links={others(MESSAGES_SEE_ALSO, '/messages')}>Ici : un message qui reste en place et se met à jour tout seul (compteurs, variables).</SeeAlso>
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
        <Section title='Messages'>
          {!list ? <Skeleton className='m-4 h-24' /> : !list.length ? <EmptyState title='Aucun message'>Crée par exemple un tableau « Infos du serveur » avec le nombre de membres en direct.</EmptyState> : (
            <ul className='divide-y'>
              {list.map((m) => (
                <li key={m.id}>
                  <button type='button' onClick={() => select(m.id)} className={cn('w-full px-4 py-3 text-start transition-colors hover:bg-accent/40', selected === m.id && 'bg-primary/10')}>
                    <div className='flex items-center gap-2 font-medium'>
                      {m.name}
                      {m.refreshMinutes > 0 && <RefreshCw className='size-3 text-success' aria-label='dynamique' />}
                      {m.targets.some((t) => t.error) && <Pill tone='danger'>Erreur</Pill>}
                    </div>
                    <div className='text-xs text-muted-foreground'>{m.targets.length} salon{m.targets.length > 1 ? 's' : ''} · modifié {ago(m.updatedAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {selected !== null && guilds.data
          ? <Editor key={`${selected}-${current?.updatedAt ?? 0}`} message={current} guilds={guilds.data} onDirty={setDirty} onSaved={(id) => { setDirty(false); setSelected(id) }} onDeleted={() => { setDirty(false); setSelected(null) }} />
          : <div className='grid place-items-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground'>Choisis un message ou crées-en un.</div>}
      </div>
      {dialog}
    </Page>
  )
}

function Editor({ message, guilds, onSaved, onDeleted, onDirty }: { message: LiveMessage | null; guilds: AnnouncementTargetsPayload; onSaved: (id: number) => void; onDeleted: () => void; onDirty: (dirty: boolean) => void }) {
  const { can } = useMe()
  const manage = can('messages.manage')
  const qc = useQueryClient()
  const [initial] = useState<Draft>(() => toDraft(message))
  const [d, setD] = useState<Draft>(initial)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  const { confirm, dialog } = useConfirm()
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))
  const body = () => ({
    name: d.name,
    payload: { content: d.content, embed: cleanEmbed(d.embed) },
    refreshMinutes: d.refreshMinutes,
    variables: Object.fromEntries(d.variables.filter(([k]) => k.trim())),
    repost: d.repost,
    targets: d.targets,
  })
  const firstGuild = d.targets[0]?.guildId ?? guilds[0]?.id
  const preview = useQuery({ queryKey: ['messages-vars', firstGuild], queryFn: () => api<Record<string, string | number>>(`/messages/variables/${firstGuild}`), enabled: Boolean(firstGuild) })
  const vars: Record<string, string | number> = { ...preview.data, ...Object.fromEntries(d.variables.map(([k, v]) => [`var.${k}`, v])) }
  const fill = (text: string) => text.replace(/\{([a-z.]+)\}/gi, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))

  const done = (m: LiveMessage & { results?: { ok: boolean; error?: string }[] }, label: string) => {
    const failed = m.results?.filter((r) => !r.ok).length ?? 0
    if (failed) toast.warning(`${label}, mais en échec dans ${failed} salon(s)`)
    else toast.success(label)
    qc.invalidateQueries({ queryKey: ['live-messages'] })
    onSaved(m.id)
  }
  const save = useMutation({
    mutationFn: async () => {
      if (message) return api<LiveMessage>(`/messages/${message.id}`, { method: 'PUT', body: body() })
      const created = await api<LiveMessage>('/messages', { method: 'POST', body: body() })
      return api<LiveMessage>(`/messages/${created.id}/publish`, { method: 'POST' })
    },
    onSuccess: (m) => done(m, message ? 'Enregistré et mis à jour partout' : 'Message publié'),
  })
  // A copy that is not published: retouch its channels and text, then save to post it
  const duplicate = useMutation({
    mutationFn: () => api<LiveMessage>('/messages', { method: 'POST', body: { ...body(), name: `${d.name} (copie)` } }),
    onSuccess: (m) => { toast.success('Copie créée : choisis ses salons puis enregistre pour la publier'); qc.invalidateQueries({ queryKey: ['live-messages'] }); onSaved(m.id) },
  })
  const republish = useMutation({
    mutationFn: () => api<LiveMessage>(`/messages/${message!.id}/publish`, { method: 'POST' }),
    onSuccess: (m) => done(m, 'Message renvoyé dans chaque salon'),
  })
  const remove = useMutation({
    mutationFn: () => api(`/messages/${message!.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Message supprimé partout'); qc.invalidateQueries({ queryKey: ['live-messages'] }); onDeleted() },
  })
  const varsBox = useRef<HTMLDivElement>(null)

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]'>
      <div className='grid content-start gap-6' ref={varsBox}>
        <Section title={message ? message.name : 'Nouveau message'} actions={message && manage && (
          <div className='flex gap-2'>
            <Button size='sm' variant='outline' disabled={republish.isPending} onClick={async () => {
              if (await confirm(publishConfirm(message.targets, guilds, { title: 'Renvoyer ce message ?', what: 'Le bot poste une nouvelle fois la version enregistrée du message (les changements non enregistrés ne sont pas pris en compte)', confirmText: 'Renvoyer' }))) republish.mutate()
            }}><Send /> Renvoyer</Button>
            <DuplicateButton text loading={duplicate.isPending} onClick={() => duplicate.mutate()} />
            <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(true)}><Trash2 /> Supprimer</Button>
          </div>
        )}>
          <div className='grid gap-4 p-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label htmlFor='lm-name'>Nom interne</Label>
                <Input id='lm-name' value={d.name} maxLength={100} disabled={!manage} onChange={(e) => set({ name: e.target.value })} placeholder='Infos du serveur' />
              </div>
              <div className='grid gap-1.5'>
                <Label>Mise à jour des variables</Label>
                <Select value={String(d.refreshMinutes)} disabled={!manage} onValueChange={(v) => set({ refreshMinutes: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REFRESH.map((r) => <SelectItem key={r.value} value={String(r.value)}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='lm-content'>Texte</Label>
              <Textarea id='lm-content' rows={3} maxLength={2000} value={d.content} disabled={!manage} onChange={(e) => set({ content: e.target.value })} />
              <VariableButton scope='server' container={varsBox} disabled={!manage} extra={[
                { title: 'Compteurs', items: BUILT_IN.map((key) => ({ key, label: COUNTER_LABELS[key] ?? key })) },
                ...(d.variables.some(([k]) => k) ? [{ title: 'Variables libres', items: d.variables.filter(([k]) => k).map(([k, v]) => ({ key: `var.${k}`, label: v || 'vide' })) }] : []),
              ]} />
            </div>
            <label className='flex items-center gap-2 text-sm font-medium'><Switch checked={d.embed.enabled} disabled={!manage} onCheckedChange={(v) => set({ embed: { ...d.embed, enabled: v } })} /> Embed</label>
            {d.embed.enabled && <EmbedFields idPrefix='lm' embed={d.embed} disabled={!manage} onChange={(patch) => set({ embed: { ...d.embed, ...patch } })} />}
          </div>
        </Section>

        <Section title='Variables libres' description='Des valeurs que tu changes d’ici en un clic, sans toucher au message (ex. {var.event} = prochain événement).'>
          <div className='grid gap-2 p-4'>
            {d.variables.map(([k, v], i) => (
              <div key={i} className='grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[12rem_1fr_auto]'>
                <Input value={k} placeholder='event' aria-label='Nom' disabled={!manage} onChange={(e) => set({ variables: d.variables.map((x, j) => (j === i ? [e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''), x[1]] : x)) })} />
                <Input value={v} placeholder='Soirée casino samedi 21h' aria-label='Valeur' disabled={!manage} onChange={(e) => set({ variables: d.variables.map((x, j) => (j === i ? [x[0], e.target.value] : x)) })} />
                <Button size='icon' variant='ghost' aria-label='Supprimer' disabled={!manage} onClick={() => set({ variables: d.variables.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            ))}
            {manage && <Button size='sm' variant='outline' className='justify-self-start' onClick={() => set({ variables: [...d.variables, ['', '']] })}><Plus /> Variable</Button>}
          </div>
        </Section>

        <Section title='Où il est affiché'>
          <div className='grid gap-4 p-4'>
            <ChannelTargets guilds={guilds} value={d.targets} disabled={!manage} onChange={(targets) => set({ targets })} />
            <label className='flex items-center gap-2 text-sm'><Switch checked={d.repost} disabled={!manage} onCheckedChange={(v) => set({ repost: v })} /> Reposter le message s’il est supprimé à la main sur Discord</label>
            {message && (
              <ul className='grid gap-1 text-xs'>
                {message.targets.map((t) => {
                  const g = guilds.find((x) => x.id === t.guildId)
                  return (
                    <li key={t.id} className='flex items-center gap-2'>
                      {t.error ? <Pill tone='danger'>Erreur</Pill> : t.messageId ? <Pill tone='success'>À jour</Pill> : <Pill>Pas encore posté</Pill>}
                      <span>{g?.name} · #{g?.channels.find((c) => c.id === t.channelId)?.name}</span>
                      {t.error && <span className='text-destructive'>{t.error}</span>}
                      {t.updatedAt && <span className='text-muted-foreground'>{ago(t.updatedAt)}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Section>
        {manage && (
          <div className='flex justify-end'>
            <Button disabled={!d.name.trim() || !d.targets.length || save.isPending} onClick={async () => {
              if (message || await confirm(publishConfirm(d.targets, guilds, { title: 'Publier ce message ?', what: `Le bot publie « ${d.name} »` }))) save.mutate()
            }}>
              {message ? <><Save /> Enregistrer et mettre à jour partout</> : <><Send /> Publier</>}
            </Button>
          </div>
        )}
      </div>
      <div className='xl:sticky xl:top-20 xl:self-start'>
        <h3 className='mb-2 text-sm font-semibold'>Aperçu (valeurs actuelles)</h3>
        <DiscordPreview content={fill(d.content)} embed={{ ...d.embed, title: fill(d.embed.title), description: fill(d.embed.description), fields: d.embed.fields.map((f) => ({ ...f, name: fill(f.name), value: fill(f.value) })) }} roles={new Map()} />
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title='Supprimer ce message ?' desc='Il est aussi supprimé de chaque salon Discord.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
      {dialog}
    </div>
  )
}
