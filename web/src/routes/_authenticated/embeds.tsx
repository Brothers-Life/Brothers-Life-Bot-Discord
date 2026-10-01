import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Braces, Copy, FilePlus2, Link2, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, Channel } from '@/lib/types'
import { cn } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { EMPTY_EMBED, EmbedFields, cleanEmbed } from '@/features/announcements/embed-editor'
import { DiscordPreview } from '@/features/announcements/discord-preview'

export const Route = createFileRoute('/_authenticated/embeds')({
  component: EmbedsPage,
})

type ButtonDraft = { label: string; url: string; emoji: string | null }
type Built = { content: string; embeds: AnnouncementEmbed[]; buttons: ButtonDraft[] }
type Saved = { id: number; name: string; guildId: string | null; channelId: string | null; messageId: string | null; payload: Built; updatedAt: number }
type Payload = { messages: Saved[]; guilds: { id: string; name: string; channels: Channel[] }[] }

const NEW_EMBED = (): AnnouncementEmbed => ({ ...EMPTY_EMBED, color: '#ff9628' })

// The JSON Discord (and tools like Discohook) use for a message
type DiscordEmbed = { title?: string; url?: string; description?: string; color?: number; author?: { name?: string; icon_url?: string }; thumbnail?: { url?: string }; image?: { url?: string }; footer?: { text?: string; icon_url?: string }; timestamp?: string; fields?: { name: string; value: string; inline?: boolean }[] }
function toDiscord(b: Built) {
  return {
    content: b.content || undefined,
    embeds: b.embeds.map((e): DiscordEmbed => ({
      title: e.title || undefined, url: e.url || undefined, description: e.description || undefined, color: Number.parseInt(e.color.slice(1), 16),
      author: e.authorName ? { name: e.authorName, icon_url: e.authorIconUrl || undefined } : undefined,
      thumbnail: e.thumbnailUrl ? { url: e.thumbnailUrl } : undefined, image: e.imageUrl ? { url: e.imageUrl } : undefined,
      footer: e.footerText ? { text: e.footerText, icon_url: e.footerIconUrl || undefined } : undefined,
      timestamp: e.timestamp ? new Date().toISOString() : undefined, fields: e.fields.length ? e.fields : undefined,
    })),
    components: b.buttons.length ? [{ type: 1, components: b.buttons.map((x) => ({ type: 2, style: 5, label: x.label || undefined, url: x.url, emoji: x.emoji ? { name: x.emoji } : undefined })) }] : undefined,
  }
}
function fromDiscord(text: string): Built {
  const raw = JSON.parse(text)
  const message = raw.messages?.[0]?.data ?? raw
  const embeds = (message.embeds ?? []).slice(0, 10).map((d: DiscordEmbed): AnnouncementEmbed => ({
    ...NEW_EMBED(), title: d.title ?? '', url: d.url ?? null, description: d.description ?? '',
    color: typeof d.color === 'number' ? `#${d.color.toString(16).padStart(6, '0')}` : '#ff9628',
    authorName: d.author?.name ?? '', authorIconUrl: d.author?.icon_url ?? null, thumbnailUrl: d.thumbnail?.url ?? null, imageUrl: d.image?.url ?? null,
    footerText: d.footer?.text ?? '', footerIconUrl: d.footer?.icon_url ?? null, timestamp: Boolean(d.timestamp),
    fields: (d.fields ?? []).map((f) => ({ name: f.name, value: f.value, inline: Boolean(f.inline) })),
  }))
  const buttons = (message.components ?? []).flatMap((row: { components?: { style?: number; label?: string; url?: string; emoji?: { name?: string } }[] }) => row.components ?? [])
    .filter((c: { style?: number; url?: string }) => c.style === 5 && c.url).map((c: { label?: string; url?: string; emoji?: { name?: string } }) => ({ label: c.label ?? '', url: c.url!, emoji: c.emoji?.name ?? null }))
  return { content: message.content ?? '', embeds, buttons }
}

function EmbedsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['embeds'], queryFn: () => api<Payload>('/embeds') })
  const [open, setOpen] = useState<number | 'new' | null>(null)
  const current = typeof open === 'number' ? data?.messages.find((m) => m.id === open) : undefined
  const where = (m: Saved) => {
    const guild = data?.guilds.find((g) => g.id === m.guildId)
    const channel = guild?.channels.find((c) => c.id === m.channelId)
    return m.messageId ? `#${channel?.name ?? 'salon'} · ${guild?.name ?? ''}` : 'Pas encore posté'
  }

  return (
    <Page title='Créateur d’embeds' description='Compose des messages avec plusieurs embeds et des boutons-liens, poste-les dans n’importe quel salon, puis modifie-les quand tu veux : le message posté se met à jour. Aussi avec /embed sur Discord.'>
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
          <Section title='Messages' actions={<Button size='sm' onClick={() => setOpen('new')}><FilePlus2 /> Nouveau</Button>}>
            {!data.messages.length ? <EmptyState title='Aucun message' icon={Braces}>Crée ton premier embed : règlement, infos, liens utiles…</EmptyState> : (
              <ul className='divide-y'>
                {data.messages.map((m) => (
                  <li key={m.id}>
                    <button type='button' onClick={() => setOpen(m.id)} aria-current={open === m.id ? 'page' : undefined} className='grid w-full gap-0.5 px-4 py-2.5 text-start transition-colors hover:bg-accent/40 aria-[current=page]:bg-primary/10'>
                      <span className='flex items-center gap-2 truncate font-medium'>
                        <span className='size-2.5 shrink-0 rounded-full' style={{ background: m.payload.embeds[0]?.color ?? 'var(--muted-foreground)' }} aria-hidden />{m.name}
                      </span>
                      <span className='truncate text-xs text-muted-foreground'>{where(m)} · {m.payload.embeds.length} embed{m.payload.embeds.length > 1 ? 's' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {open === null ? <EmptyState title='Choisis un message ou crée-en un' icon={Braces} /> : (
            <Editor key={String(open)} saved={current} guilds={data.guilds} onSaved={(id) => setOpen(id)} onDeleted={() => setOpen(null)} />
          )}
        </div>
      )}
    </Page>
  )
}

function Editor({ saved, guilds, onSaved, onDeleted }: { saved?: Saved; guilds: Payload['guilds']; onSaved: (id: number) => void; onDeleted: () => void }) {
  const { can } = useMe()
  const manage = can('embeds.manage')
  const qc = useQueryClient()
  const [name, setName] = useState(saved?.name ?? '')
  const [b, setB] = useState<Built>(saved?.payload ?? { content: '', embeds: [NEW_EMBED()], buttons: [] })
  const [tab, setTab] = useState(0)
  const [guildId, setGuildId] = useState(saved?.guildId ?? guilds[0]?.id ?? '')
  const [channelId, setChannelId] = useState<string | null>(saved?.channelId ?? null)
  const [json, setJson] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const embed = b.embeds[tab]
  const refresh = () => qc.invalidateQueries({ queryKey: ['embeds'] })
  const body = () => ({ ...(saved ? { id: saved.id } : {}), name, payload: { ...b, embeds: b.embeds.map(cleanEmbed) } })

  const save = useMutation({
    mutationFn: () => api<Saved>('/embeds', { method: 'POST', body: body() }),
    onSuccess: (s) => { toast.success(s.messageId ? 'Enregistré et mis à jour sur Discord' : 'Enregistré'); refresh(); onSaved(s.id) },
  })
  const post = useMutation({
    mutationFn: async () => {
      const s = await api<Saved>('/embeds', { method: 'POST', body: body() })
      return api<Saved>(`/embeds/${s.id}/post`, { method: 'POST', body: { guildId, channelId } })
    },
    onSuccess: (s) => { toast.success('Posté sur Discord'); refresh(); onSaved(s.id) },
  })
  const remove = useMutation({ mutationFn: () => api(`/embeds/${saved!.id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Supprimé (et retiré de Discord)'); refresh(); onDeleted() } })

  const setEmbed = (patch: Partial<AnnouncementEmbed>) => setB((prev) => ({ ...prev, embeds: prev.embeds.map((e, i) => (i === tab ? { ...e, ...patch } : e)) }))
  const moveEmbed = (by: number) => {
    const embeds = [...b.embeds]
    ;[embeds[tab], embeds[tab + by]] = [embeds[tab + by], embeds[tab]]
    setB({ ...b, embeds })
    setTab(tab + by)
  }
  const setButton = (i: number, patch: Partial<ButtonDraft>) => setB((prev) => ({ ...prev, buttons: prev.buttons.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const sameChannel = saved?.messageId && saved.channelId === channelId

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
      <Section
        title={saved ? 'Modifier' : 'Nouveau message'}
        actions={manage && (
          <div className='flex flex-wrap gap-2'>
            <Button size='sm' variant='ghost' onClick={() => setJson(JSON.stringify(toDiscord(b), null, 2))}><Braces /> JSON</Button>
            {saved && <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(true)}><Trash2 /></Button>}
            <Button size='sm' variant='outline' loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
          </div>
        )}
      >
        <div className='grid gap-5 p-4'>
          <div className='grid gap-1.5'><Label htmlFor='emb-name'>Nom (pour le retrouver)</Label><Input id='emb-name' value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder='Règlement, liens utiles…' disabled={!manage} /></div>
          <div className='grid gap-1.5'><Label htmlFor='emb-content'>Texte au-dessus des embeds</Label><Textarea id='emb-content' rows={2} maxLength={2000} value={b.content} onChange={(e) => setB({ ...b, content: e.target.value })} disabled={!manage} /></div>

          <div className='grid gap-3 rounded-lg border p-3'>
            <div className='flex flex-wrap items-center gap-1.5' role='tablist' aria-label='Embeds'>
              {b.embeds.map((e, i) => (
                <button key={i} type='button' role='tab' aria-selected={i === tab} onClick={() => setTab(i)} className='flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm aria-selected:border-primary aria-selected:bg-primary/10'>
                  <span className='size-2 rounded-full' style={{ background: e.color }} aria-hidden />{e.title ? e.title.slice(0, 18) : `Embed ${i + 1}`}
                </button>
              ))}
              {manage && b.embeds.length < 10 && <Button size='sm' variant='ghost' className='h-8' onClick={() => { setB({ ...b, embeds: [...b.embeds, NEW_EMBED()] }); setTab(b.embeds.length) }}><Plus /> Embed</Button>}
              {manage && embed && (
                <div className='ms-auto flex gap-1'>
                  <Button size='icon' variant='ghost' className='size-8' aria-label='Avancer' disabled={tab === 0} onClick={() => moveEmbed(-1)}><ArrowUp /></Button>
                  <Button size='icon' variant='ghost' className='size-8' aria-label='Reculer' disabled={tab === b.embeds.length - 1} onClick={() => moveEmbed(1)}><ArrowDown /></Button>
                  <Button size='icon' variant='ghost' className='size-8' aria-label='Dupliquer' disabled={b.embeds.length >= 10} onClick={() => { setB({ ...b, embeds: [...b.embeds.slice(0, tab + 1), { ...embed }, ...b.embeds.slice(tab + 1)] }); setTab(tab + 1) }}><Copy /></Button>
                  <Button size='icon' variant='danger-ghost' className='size-8' aria-label='Supprimer cet embed' onClick={() => { setB({ ...b, embeds: b.embeds.filter((_, i) => i !== tab) }); setTab(Math.max(0, tab - 1)) }}><X /></Button>
                </div>
              )}
            </div>
            {embed ? <EmbedFields embed={embed} idPrefix={`emb-${tab}`} disabled={!manage} onChange={setEmbed} /> : <p className='text-sm text-muted-foreground'>Aucun embed : le message n’aura que du texte.</p>}
          </div>

          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-2'>
              <Label>Boutons-liens</Label>
              {manage && b.buttons.length < 25 && <Button size='sm' variant='ghost' onClick={() => setB({ ...b, buttons: [...b.buttons, { label: '', url: 'https://', emoji: null }] })}><Link2 /> Bouton</Button>}
            </div>
            {b.buttons.map((x, i) => (
              <div key={i} className='grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.5fr)_auto]'>
                <Input aria-label='Émoji' value={x.emoji ?? ''} placeholder='🔗' maxLength={64} onChange={(e) => setButton(i, { emoji: e.target.value || null })} disabled={!manage} />
                <Input aria-label='Texte du bouton' value={x.label} placeholder='Site web' maxLength={80} onChange={(e) => setButton(i, { label: e.target.value })} disabled={!manage} />
                <Input aria-label='Lien' value={x.url} placeholder='https://…' onChange={(e) => setButton(i, { url: e.target.value })} disabled={!manage} />
                <Button size='icon' variant='danger-ghost' aria-label='Retirer le bouton' onClick={() => setB({ ...b, buttons: b.buttons.filter((_, j) => j !== i) })} disabled={!manage}><X /></Button>
              </div>
            ))}
          </div>

          {manage && (
            <div className='grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end'>
              <div className='grid gap-1.5'>
                <Label>Serveur</Label>
                <Select value={guildId} onValueChange={(v) => { setGuildId(v); setChannelId(null) }}>
                  <SelectTrigger aria-label='Serveur'><SelectValue /></SelectTrigger>
                  <SelectContent>{guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className='grid gap-1.5'>
                <Label>Salon</Label>
                <ChannelSelect channels={guilds.find((g) => g.id === guildId)?.channels ?? []} value={channelId} onChange={setChannelId} label='Salon' noneLabel='Choisir un salon' />
              </div>
              <Button loading={post.isPending} disabled={!channelId} onClick={() => post.mutate()}><Send /> {sameChannel ? 'Mettre à jour' : saved?.messageId ? 'Déplacer ici' : 'Poster'}</Button>
            </div>
          )}
          {saved?.messageId && <p className='text-xs text-muted-foreground'>Posté · dernière modification le {dateTime(saved.updatedAt)}. Enregistrer met aussi à jour le message sur Discord.</p>}
        </div>
      </Section>

      <Section title='Aperçu' description={b.embeds.length > 1 ? `Embed ${tab + 1} sur ${b.embeds.length} (les autres suivent en dessous sur Discord).` : undefined}>
        <div className={cn('grid gap-2 p-4')}>
          <DiscordPreview content={b.content} embed={embed ?? { ...NEW_EMBED(), enabled: false }} roles={new Map()} extras={{ buttons: b.buttons }} />
          {b.embeds.length > 1 && <div className='flex flex-wrap gap-1'>{b.embeds.map((e, i) => <Pill key={i} tone={i === tab ? 'accent' : 'neutral'}>{e.title || `Embed ${i + 1}`}</Pill>)}</div>}
        </div>
      </Section>

      {json !== null && (
        <Dialog open onOpenChange={(o) => !o && setJson(null)}>
          <DialogContent className='sm:max-w-2xl'>
            <DialogHeader>
              <DialogTitle>JSON du message</DialogTitle>
              <DialogDescription>Le format de Discord (compatible Discohook). Colle un JSON ici puis « Importer » pour remplacer le message.</DialogDescription>
            </DialogHeader>
            <Textarea rows={16} value={json} onChange={(e) => setJson(e.target.value)} className='font-mono text-xs' aria-label='JSON' />
            <DialogFooter>
              <Button variant='outline' onClick={() => { navigator.clipboard.writeText(json).then(() => toast.success('Copié')) }}><Copy /> Copier</Button>
              <Button onClick={() => {
                try {
                  const next = fromDiscord(json)
                  setB(next.embeds.length || next.content ? next : b)
                  setTab(0)
                  setJson(null)
                  toast.success('Importé')
                }
                catch {
                  toast.error('JSON illisible')
                }
              }}>Importer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Supprimer « ${saved?.name ?? ''} » ?`} desc='Le message posté sur Discord est supprimé aussi.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </div>
  )
}
