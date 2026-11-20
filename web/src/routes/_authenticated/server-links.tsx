import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FolderPlus, Pencil, Plus, RefreshCw, Save, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, AnnouncementTargetsPayload } from '@/lib/types'
import { ago } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, Notice, GuildIcon } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useConfirm, useDiscardGuard } from '@/components/app/confirm'
import { EmbedFields, EMPTY_EMBED, cleanEmbed } from '@/features/announcements/embed-editor'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { ChannelSelect } from '@/components/app/pickers'
import { EmojiField, EmojiView } from '@/components/app/emoji-picker'
import { SortableBoard, type BoardColumn } from '@/features/takeovers/sortable-board'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ColorPicker } from '@/components/app/color-picker'
import { MarkdownTextarea } from '@/components/app/markdown-toolbar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/server-links')({
  component: ServerLinksPage,
})

type LinkServer = {
  guildId: string
  name: string
  icon: string | null
  isMain: boolean
  listed: boolean
  label: string
  description: string
  emoji: string
  categoryId: number | null
  inviteMode: 'auto' | 'manual'
  inviteChannelId: string | null
  inviteUrl: string | null
  inviteError: string | null
}
type Category = { id: number; name: string; emoji: string; color: string | null }
type Card = { title?: string; url?: string; description?: string; thumbnailUrl?: string | null; color: string }
type SyncResult = { ok: boolean; error?: string }
type Board = {
  id: number
  name: string
  guildId: string
  channelId: string
  enabled: boolean
  payload: { content: string; embed: AnnouncementEmbed }
  layout: 'list' | 'cards'
  line: string
  compact: boolean
  scope: 'all' | 'selected'
  guildIds: string[]
  categoryIds: number[]
  groupByCategory: boolean
  categoryHeader: string
  includeSelf: boolean
  buttons: boolean
  repost: boolean
  messageId: string | null
  error: string | null
  syncedAt: number | null
  updatedAt: number
  result?: SyncResult
}
type Payload = {
  servers: LinkServer[]
  boards: Board[]
  targets: AnnouncementTargetsPayload
  categories: Category[]
  defaults: { line: string; categoryHeader: string; payload: { content: string; embed: Partial<AnnouncementEmbed> } }
}
type PreviewMessage = { content: string; embed: AnnouncementEmbed; cards: Card[] }
type Preview = { messages: PreviewMessage[]; buttons: { label: string; url: string; emoji: string | null }[]; servers: string[] }

const KEY = ['server-links']
const LINE_VARS = [
  ['{name}', 'nom du serveur'],
  ['{invite}', 'lien d’invitation'],
  ['{description}', 'description'],
  ['{emoji}', 'émoji'],
  ['{members}', 'nombre de membres'],
]

function ServerLinksPage() {
  const { can } = useMe()
  const manage = can('serverlinks.manage')
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api<Payload>('/server-links'), refetchInterval: 60_000 })
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  const [dirty, setDirty] = useState(false)
  const { guard, dialog } = useDiscardGuard(dirty)
  const select = (id: number | 'new' | null) => { if (id !== selected) void guard(() => { setDirty(false); setSelected(id) }) }
  const current = selected === 'new' ? null : data?.boards.find((b) => b.id === selected) ?? null
  const listed = data?.servers.filter((s) => s.listed).length ?? 0

  return (
    <Page
      title='Liens entre serveurs'
      description='Relie les Discord du réseau entre eux : chaque serveur a son invitation, et un message tenu à jour dans le salon de ton choix présente les autres serveurs avec leur lien.'
      actions={manage && <Button onClick={() => select('new')}><Plus /> Nouveau message</Button>}
    >
      {!data ? <Skeleton className='h-64' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <ServersBoard data={data} manage={manage} />

          {manage && !listed && <Notice tone='warning' title='Aucun serveur affiché'>Active « Affiché » sur au moins un serveur ci-dessus : sans ça, les messages n’ont aucun lien à montrer.</Notice>}

          <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
            <Section title='Messages de liens'>
              {!data.boards.length ? <EmptyState title='Aucun message'>Crée un message « Nos autres serveurs » dans le salon de ton choix.</EmptyState> : (
                <ul className='divide-y'>
                  {data.boards.map((b) => {
                    const g = data.targets.find((x) => x.id === b.guildId)
                    return (
                      <li key={b.id}>
                        <button type='button' onClick={() => select(b.id)} className={cn('w-full px-4 py-3 text-start transition-colors hover:bg-accent/40', selected === b.id && 'bg-primary/10')}>
                          <div className='flex flex-wrap items-center gap-2 font-medium'>
                            {b.name}
                            {!b.enabled ? <Pill>Désactivé</Pill> : b.error ? <Pill tone='danger'>Erreur</Pill> : b.messageId ? <Pill tone='success'>En ligne</Pill> : <Pill>Pas encore posté</Pill>}
                          </div>
                          <div className='text-xs text-muted-foreground'>{g?.name ?? 'Serveur inconnu'} · #{g?.channels.find((c) => c.id === b.channelId)?.name ?? 'salon inconnu'}</div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>
            {selected !== null
              ? <BoardEditor key={`${selected}-${current?.updatedAt ?? 0}`} board={current} data={data} manage={manage} onDirty={setDirty} onSaved={(id) => { setDirty(false); setSelected(id) }} onDeleted={() => { setDirty(false); setSelected(null) }} />
              : <div className='grid place-items-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground'>Choisis un message ou crées-en un.</div>}
          </div>
        </div>
      )}
      {dialog}
    </Page>
  )
}

type ServerDraft = { listed: boolean; label: string; description: string; emoji: string; categoryId: number | null; inviteMode: 'auto' | 'manual'; inviteChannelId: string | null; inviteUrl: string }
type CategoryDraft = { id?: number; name: string; emoji: string; color: string | null }

const serverDraft = (server: LinkServer): ServerDraft => ({
  listed: server.listed,
  label: server.label,
  description: server.description,
  emoji: server.emoji,
  categoryId: server.categoryId,
  inviteMode: server.inviteMode,
  inviteChannelId: server.inviteChannelId,
  inviteUrl: server.inviteMode === 'manual' ? server.inviteUrl ?? '' : '',
})

function useReport() {
  const qc = useQueryClient()
  return (results: SyncResult[], label: string) => {
    const failed = results.filter((r) => !r.ok).length
    if (failed) toast.warning(`${label}, mais ${failed} message(s) en échec`)
    else toast.success(label)
    qc.invalidateQueries({ queryKey: KEY })
  }
}

// Categories as columns, servers as rows: drag a server into a category, drag a category to reorder it.
// The board works with numbers: a server is its index in the list.
function ServersBoard({ data, manage }: { data: Payload; manage: boolean }) {
  const qc = useQueryClient()
  const report = useReport()
  const { confirm, dialog } = useConfirm()
  const { servers, categories } = data
  const [editing, setEditing] = useState<LinkServer | null>(null)
  const [editingCategory, setEditingCategory] = useState<CategoryDraft | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: KEY })
  const arrange = useMutation({
    mutationFn: (columns: BoardColumn[]) => api('/server-links/layout', { method: 'PUT', body: { groups: columns.map((c) => ({ id: c.id, items: c.items.map((i) => servers[i].guildId) })) } }),
    onSuccess: refresh,
  })
  const toggle = useMutation({
    mutationFn: ({ server, listed }: { server: LinkServer; listed: boolean }) => api<{ results: SyncResult[] }>(`/server-links/servers/${server.guildId}`, { method: 'PUT', body: { ...serverDraft(server), listed } }),
    onSuccess: (r, { listed }) => report(r.results, listed ? 'Serveur affiché, messages mis à jour' : 'Serveur retiré des messages'),
  })
  const removeCategory = useMutation({
    mutationFn: (c: Category) => api(`/server-links/categories/${c.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Catégorie supprimée'); refresh() },
  })
  const indexes = servers.map((_, i) => i)
  const columns: BoardColumn[] = [
    ...categories.map((c) => ({ id: c.id, items: indexes.filter((i) => servers[i].categoryId === c.id) })),
    { id: null, items: indexes.filter((i) => servers[i].categoryId === null) },
  ]
  const header = (id: number | null, handle: ReactNode) => {
    if (id === null && !categories.length) return null
    const category = categories.find((c) => c.id === id)
    const count = servers.filter((x) => x.categoryId === id).length
    return (
      <div className='flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1.5'>
        {handle}
        <div className='flex min-w-32 flex-1 items-center gap-2 px-1 font-medium'>
          {category?.color && <span className='size-3 rounded-full' style={{ backgroundColor: category.color }} />}
          {category?.emoji && <EmojiView value={category.emoji} className='size-5' />}
          <span className='truncate'>{category?.name ?? 'Sans catégorie'}</span>
          <span className='text-xs font-normal text-muted-foreground'>{count} serveur{count > 1 ? 's' : ''}</span>
        </div>
        {manage && category && (
          <div className='flex items-center gap-1'>
            <Button size='sm' variant='ghost' aria-label={`Modifier la catégorie ${category.name}`} onClick={() => setEditingCategory(category)}><Pencil /></Button>
            <Button size='sm' variant='danger-ghost' aria-label={`Supprimer la catégorie ${category.name}`} onClick={async () => {
              if (await confirm({ title: `Supprimer la catégorie ${category.name} ?`, desc: 'Ses serveurs restent, sans catégorie.', confirmText: 'Supprimer', destructive: true })) removeCategory.mutate(category)
            }}><Trash2 /></Button>
          </div>
        )}
      </div>
    )
  }
  const row = (server: LinkServer) => (
    <div className='flex flex-wrap items-center gap-3 px-3 py-3'>
      <GuildIcon src={server.icon} name={server.name} />
      <div className='min-w-40 flex-1'>
        <div className='flex flex-wrap items-center gap-2 font-medium'>
          {server.emoji && <EmojiView value={server.emoji} className='size-5' />}
          <span className='truncate'>{server.label || server.name}</span>
          {server.isMain && <Pill tone='accent'>Principal</Pill>}
          {server.inviteError && <Pill tone='danger'>Invitation en erreur</Pill>}
        </div>
        {server.inviteUrl ? (
          <button type='button' className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground' onClick={() => { void navigator.clipboard.writeText(server.inviteUrl!); toast.success('Lien copié') }}>
            <Copy className='size-3' /> {server.inviteUrl}
          </button>
        ) : <div className='text-xs text-muted-foreground'>{server.listed ? 'Pas encore d’invitation' : 'Non affiché dans les messages'}</div>}
        {server.inviteError && <div className='text-xs text-destructive'>{server.inviteError}</div>}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <label className='flex items-center gap-2 text-sm'>
          <Switch checked={server.listed} disabled={!manage || toggle.isPending} onCheckedChange={(listed) => toggle.mutate({ server, listed })} aria-label={`Affiché : ${server.name}`} />
          <span className='hidden sm:inline'>Affiché</span>
        </label>
        {manage && <Button size='sm' variant='outline' onClick={() => setEditing(server)}>Modifier</Button>}
      </div>
    </div>
  )

  return (
    <Section
      title={`Serveurs du réseau (${servers.length})`}
      description='Range les serveurs par catégories (légal, illégal, staff…) en les glissant, dans l’ordre que tu veux : les messages suivent cet ordre. Un serveur non affiché n’apparaît dans aucun message.'
      actions={manage && <Button size='sm' variant='outline' onClick={() => setEditingCategory({ name: '', emoji: '', color: null })}><FolderPlus /> Nouvelle catégorie</Button>}
    >
      {!servers.length ? <EmptyState title='Aucun serveur dans le réseau' /> : (
        <SortableBoard
          columns={columns}
          editable={manage}
          onChange={(next) => arrange.mutateAsync(next)}
          columnLabel={(id) => categories.find((c) => c.id === id)?.name ?? ''}
          itemLabel={(i) => servers[i]?.name ?? ''}
          renderHeader={header}
          renderItem={(i) => (servers[i] ? row(servers[i]) : null)}
          empty={manage ? 'Glisse un serveur ici' : 'Aucun serveur'}
        />
      )}
      {editing && <ServerDialog key={editing.guildId} server={editing} data={data} onClose={() => setEditing(null)} />}
      {editingCategory && <CategoryDialog draft={editingCategory} onClose={() => setEditingCategory(null)} onSaved={refresh} />}
      {dialog}
    </Section>
  )
}

function ServerDialog({ server, data, onClose }: { server: LinkServer; data: Payload; onClose: () => void }) {
  const report = useReport()
  const [d, setD] = useState<ServerDraft>(() => serverDraft(server))
  const set = (patch: Partial<ServerDraft>) => setD((prev) => ({ ...prev, ...patch }))
  const channels = data.targets.find((g) => g.id === server.guildId)?.channels ?? []
  const save = useMutation({
    mutationFn: () => api<{ results: SyncResult[] }>(`/server-links/servers/${server.guildId}`, { method: 'PUT', body: d }),
    onSuccess: (r) => { report(r.results, 'Serveur enregistré, messages mis à jour'); onClose() },
  })
  const renew = useMutation({
    mutationFn: () => api<{ results: SyncResult[] }>(`/server-links/servers/${server.guildId}/invite`, { method: 'POST' }),
    onSuccess: (r) => { report(r.results, 'Nouvelle invitation créée'); onClose() },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader><DialogTitle className='flex items-center gap-2'><GuildIcon src={server.icon} name={server.name} className='size-7' /> {server.name}</DialogTitle></DialogHeader>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
          <label className='flex items-center gap-2 text-sm font-medium sm:col-span-2'><Switch checked={d.listed} onCheckedChange={(v) => set({ listed: v })} /> Affiché dans les messages des autres serveurs</label>
          <div className='grid gap-1.5'>
            <Label htmlFor='sl-label'>Nom affiché</Label>
            <Input id='sl-label' value={d.label} maxLength={80} placeholder={server.name} onChange={(e) => set({ label: e.target.value })} />
          </div>
          <EmojiField value={d.emoji} onChange={(emoji) => set({ emoji })} />
          <div className='grid gap-1.5 sm:col-span-2'>
            <Label htmlFor='sl-description'>Description</Label>
            <Input id='sl-description' value={d.description} maxLength={300} placeholder='Le serveur de…' onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className='grid gap-1.5'>
            <Label>Catégorie</Label>
            <Select value={d.categoryId === null ? 'none' : String(d.categoryId)} disabled={!data.categories.length} onValueChange={(v) => set({ categoryId: v === 'none' ? null : Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='none'>Sans catégorie</SelectItem>
                {data.categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label>Invitation</Label>
            <Select value={d.inviteMode} onValueChange={(v) => set({ inviteMode: v as 'auto' | 'manual' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='auto'>Créée par le bot (permanente)</SelectItem>
                <SelectItem value='manual'>Lien saisi à la main</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='sm:col-span-2'>
            {d.inviteMode === 'auto'
              ? <ChannelSelect label='Salon de l’invitation' channels={channels} value={d.inviteChannelId} noneLabel='Choisi par le bot' onChange={(id) => set({ inviteChannelId: id })} />
              : (
                <div className='grid gap-1.5'>
                  <Label htmlFor='sl-invite'>Lien d’invitation</Label>
                  <Input id='sl-invite' value={d.inviteUrl} maxLength={200} placeholder='https://discord.gg/…' onChange={(e) => set({ inviteUrl: e.target.value })} />
                </div>
              )}
          </div>
        </div>
        <DialogFooter>
          {server.inviteMode === 'auto' && server.inviteUrl && <Button variant='outline' className='sm:mr-auto' loading={renew.isPending} onClick={() => renew.mutate()}><RefreshCw /> Nouvelle invitation</Button>}
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CategoryDialog({ draft, onClose, onSaved }: { draft: CategoryDraft; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState(draft)
  const save = useMutation({
    mutationFn: () => api(c.id ? `/server-links/categories/${c.id}` : '/server-links/categories', { method: c.id ? 'PUT' : 'POST', body: { name: c.name, emoji: c.emoji, color: c.color } }),
    onSuccess: () => { toast.success('Catégorie enregistrée'); onSaved(); onClose() },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader><DialogTitle>{c.id ? `Modifier ${draft.name}` : 'Nouvelle catégorie'}</DialogTitle></DialogHeader>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
          <div className='grid gap-1.5'>
            <Label htmlFor='sl-cat-name'>Nom</Label>
            <Input id='sl-cat-name' maxLength={60} placeholder='Par exemple « Entreprises légales »' value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          </div>
          <EmojiField label='Émoji (facultatif)' value={c.emoji} onChange={(emoji) => setC({ ...c, emoji })} />
          <ColorPicker label='Couleur des cartes de cette catégorie' value={c.color ?? '#ff9628'} onChange={(color) => setC({ ...c, color })} />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} disabled={!c.name.trim()} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Draft = {
  name: string
  guildId: string
  channelId: string | null
  enabled: boolean
  content: string
  embed: AnnouncementEmbed
  layout: 'list' | 'cards'
  line: string
  compact: boolean
  scope: 'all' | 'selected'
  guildIds: string[]
  categoryIds: number[]
  groupByCategory: boolean
  categoryHeader: string
  includeSelf: boolean
  buttons: boolean
  repost: boolean
}

function toDraft(b: Board | null, data: Payload): Draft {
  const payload = b?.payload ?? data.defaults.payload
  return {
    name: b?.name ?? '',
    guildId: b?.guildId ?? data.targets.find((g) => g.isMain)?.id ?? data.targets[0]?.id ?? '',
    channelId: b?.channelId ?? null,
    enabled: b?.enabled ?? true,
    content: payload.content ?? '',
    embed: { ...EMPTY_EMBED, ...payload.embed },
    line: b?.line ?? data.defaults.line,
    compact: b?.compact ?? false,
    scope: b?.scope ?? 'all',
    guildIds: b?.guildIds ?? [],
    layout: b?.layout ?? 'cards',
    categoryIds: b?.categoryIds ?? [],
    groupByCategory: b?.groupByCategory ?? true,
    categoryHeader: b?.categoryHeader ?? data.defaults.categoryHeader,
    includeSelf: b?.includeSelf ?? false,
    buttons: b?.buttons ?? true,
    repost: b?.repost ?? true,
  }
}

function BoardEditor({ board, data, manage, onSaved, onDeleted, onDirty }: { board: Board | null; data: Payload; manage: boolean; onSaved: (id: number) => void; onDeleted: () => void; onDirty: (dirty: boolean) => void }) {
  const qc = useQueryClient()
  const [initial] = useState<Draft>(() => toDraft(board, data))
  const [d, setD] = useState<Draft>(initial)
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  const [deleting, setDeleting] = useState(false)
  const lineRef = useRef<HTMLTextAreaElement>(null)
  const guild = data.targets.find((g) => g.id === d.guildId)
  const body = () => ({
    name: d.name,
    guildId: d.guildId,
    channelId: d.channelId,
    enabled: d.enabled,
    payload: { content: d.content, embed: cleanEmbed(d.embed) },
    line: d.line,
    compact: d.compact,
    scope: d.scope,
    guildIds: d.guildIds,
    layout: d.layout,
    categoryIds: d.categoryIds,
    groupByCategory: d.groupByCategory,
    categoryHeader: d.categoryHeader,
    includeSelf: d.includeSelf,
    buttons: d.buttons,
    repost: d.repost,
  })

  // The preview is rendered by the server (real servers, real links), a moment after the last keystroke
  const [previewBody, setPreviewBody] = useState(() => JSON.stringify(body()))
  const serialized = JSON.stringify(body())
  useEffect(() => {
    const timer = setTimeout(() => setPreviewBody(serialized), 500)
    return () => clearTimeout(timer)
  }, [serialized])
  const preview = useQuery({
    queryKey: ['server-links-preview', previewBody, data.servers],
    queryFn: () => {
      const { channelId: _channel, ...rest } = JSON.parse(previewBody)
      return api<Preview>('/server-links/preview', { method: 'POST', body: rest })
    },
    enabled: manage && Boolean(d.guildId),
    retry: false,
    placeholderData: (prev) => prev,
  })

  const done = (b: Board, label: string) => {
    if (b.result && !b.result.ok) toast.warning(`${label}, mais l’envoi a échoué : ${b.result.error}`)
    else toast.success(label)
    qc.invalidateQueries({ queryKey: KEY })
    onSaved(b.id)
  }
  const save = useMutation({
    mutationFn: () => (board
      ? api<Board>(`/server-links/boards/${board.id}`, { method: 'PUT', body: body() })
      : api<Board>('/server-links/boards', { method: 'POST', body: body() })),
    onSuccess: (b) => done(b, board ? 'Enregistré et mis à jour sur Discord' : 'Message publié'),
  })
  const republish = useMutation({
    mutationFn: () => api<Board>(`/server-links/boards/${board!.id}/publish`, { method: 'POST' }),
    onSuccess: (b) => done(b, 'Message mis à jour sur Discord'),
  })
  const remove = useMutation({
    mutationFn: () => api(`/server-links/boards/${board!.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Message supprimé'); qc.invalidateQueries({ queryKey: KEY }); onDeleted() },
  })
  const insertVar = (token: string) => {
    const el = lineRef.current
    const at = el?.selectionStart ?? d.line.length
    set({ line: d.line.slice(0, at) + token + d.line.slice(el?.selectionEnd ?? at) })
  }
  const shown = preview.data

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]'>
      <div className='grid content-start gap-6'>
        <Section title={board ? board.name : 'Nouveau message'} actions={board && manage && (
          <div className='flex gap-2'>
            <Button size='sm' variant='outline' disabled={republish.isPending || dirty || !board.enabled} onClick={() => republish.mutate()}><Send /> Mettre à jour</Button>
            <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(true)}><Trash2 /> Supprimer</Button>
          </div>
        )}>
          <div className='grid gap-4 p-4'>
            {board?.error && <Notice tone='danger' title='Dernier envoi en échec'>{board.error}</Notice>}
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3'>
              <div className='grid gap-1.5'>
                <Label htmlFor='sl-name'>Nom interne</Label>
                <Input id='sl-name' value={d.name} maxLength={100} disabled={!manage} placeholder='Nos autres serveurs' onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div className='grid gap-1.5'>
                <Label>Serveur</Label>
                <Select value={d.guildId} disabled={!manage} onValueChange={(v) => set({ guildId: v, channelId: null })}>
                  <SelectTrigger><SelectValue placeholder='Choisir' /></SelectTrigger>
                  <SelectContent>{data.targets.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ChannelSelect label='Salon' channels={guild?.channels ?? []} value={d.channelId} disabled={!manage} noneLabel='Choisir' onChange={(id) => set({ channelId: id })} />
            </div>
            <label className='flex items-center gap-2 text-sm'><Switch checked={d.enabled} disabled={!manage} onCheckedChange={(v) => set({ enabled: v })} /> Message actif (désactivé : il est retiré du salon)</label>
            {board?.syncedAt && <div className='text-xs text-muted-foreground'>Dernière vérification {ago(board.syncedAt)}</div>}
          </div>
        </Section>

        <Section title='Serveurs affichés' description='Le serveur où le message est posté n’est pas listé, sauf si tu le demandes.'>
          <div className='grid gap-3 p-4'>
            <Select value={d.scope} disabled={!manage} onValueChange={(v) => set({ scope: v as 'all' | 'selected' })}>
              <SelectTrigger className='sm:w-80'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>Tous les serveurs affichés (suit le réseau)</SelectItem>
                <SelectItem value='selected'>Seulement ceux que je choisis</SelectItem>
              </SelectContent>
            </Select>
            {d.scope === 'selected' && (
              <ul className='grid gap-2 sm:grid-cols-2'>
                {data.servers.map((s) => (
                  <li key={s.guildId}>
                    <label className='flex items-center gap-2 text-sm'>
                      <Checkbox checked={d.guildIds.includes(s.guildId)} disabled={!manage} onCheckedChange={(v) => set({ guildIds: v ? [...d.guildIds, s.guildId] : d.guildIds.filter((id) => id !== s.guildId) })} />
                      <span className='truncate'>{s.label || s.name}</span>
                      {!s.listed && <Pill tone='warning'>Non affiché</Pill>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {data.categories.length > 0 && (
              <div className='grid gap-2'>
                <Label>Catégories affichées {d.categoryIds.length === 0 && <span className='font-normal text-muted-foreground'>(toutes)</span>}</Label>
                <ul className='flex flex-wrap gap-x-4 gap-y-2'>
                  {data.categories.map((c) => (
                    <li key={c.id}>
                      <label className='flex items-center gap-2 text-sm'>
                        <Checkbox checked={d.categoryIds.includes(c.id)} disabled={!manage} onCheckedChange={(v) => set({ categoryIds: v ? [...d.categoryIds, c.id] : d.categoryIds.filter((id) => id !== c.id) })} />
                        {c.emoji} {c.name}
                      </label>
                    </li>
                  ))}
                </ul>
                <label className='flex items-center gap-2 text-sm'><Switch checked={d.groupByCategory} disabled={!manage} onCheckedChange={(v) => set({ groupByCategory: v })} /> Regrouper les serveurs par catégorie, avec un titre</label>
                {d.groupByCategory && (
                  <div className='grid gap-1.5 sm:w-80'>
                    <Label htmlFor='sl-header'>Titre d’une catégorie</Label>
                    <Input id='sl-header' value={d.categoryHeader} maxLength={200} disabled={!manage} onChange={(e) => set({ categoryHeader: e.target.value })} />
                    <p className='text-xs text-muted-foreground'>{'{category}'} = nom, {'{emoji}'} = émoji. Vide : pas de titre.</p>
                  </div>
                )}
              </div>
            )}
            <label className='flex items-center gap-2 text-sm'><Switch checked={d.includeSelf} disabled={!manage} onCheckedChange={(v) => set({ includeSelf: v })} /> Lister aussi le serveur du message</label>
            <label className='flex items-center gap-2 text-sm'><Switch checked={d.buttons} disabled={!manage} onCheckedChange={(v) => set({ buttons: v })} /> Un bouton « rejoindre » par serveur sous le message (25 au plus)</label>
          </div>
        </Section>

        <Section title='Contenu du message' description={d.layout === 'cards' ? 'Le message d’en-tête, suivi d’une carte par serveur. {count} = nombre de serveurs.' : '{links} est remplacé par la liste des serveurs, {count} par leur nombre.'}>
          <div className='grid gap-4 p-4'>
            <div className='grid gap-1.5 sm:w-96'>
              <Label>Présentation</Label>
              <Select value={d.layout} disabled={!manage} onValueChange={(v) => set({ layout: v as 'list' | 'cards' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='cards'>Cartes avec le logo de chaque Discord</SelectItem>
                  <SelectItem value='list'>Liste de liens, sans logo</SelectItem>
                </SelectContent>
              </Select>
              {d.layout === 'cards' && <p className='text-xs text-muted-foreground'>Une carte par serveur : logo, nom cliquable, description. Discord limite à 10 cartes par message : au-delà, le bot continue dans un message suivant.</p>}
            </div>
            {d.layout === 'list' && (
              <div className='grid gap-1.5'>
                <Label htmlFor='sl-line'>Une ligne par serveur</Label>
                <Textarea id='sl-line' ref={lineRef} rows={3} maxLength={400} value={d.line} disabled={!manage} onChange={(e) => set({ line: e.target.value })} />
                <div className='flex flex-wrap gap-1.5'>
                  {LINE_VARS.map(([token, label]) => (
                    <button key={token} type='button' disabled={!manage} title={label} onClick={() => insertVar(token)} className='rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground'>{token}</button>
                  ))}
                </div>
                <label className='flex items-center gap-2 text-sm'><Switch checked={d.compact} disabled={!manage} onCheckedChange={(v) => set({ compact: v })} /> Liste serrée (sans ligne vide entre les serveurs)</label>
              </div>
            )}
            <div className='grid gap-1.5'>
              <Label htmlFor='sl-content'>Texte au-dessus de l’embed</Label>
              <MarkdownTextarea id='sl-content' rows={2} maxLength={2000} value={d.content} disabled={!manage} onChange={(e) => set({ content: e.target.value })} />
            </div>
            <label className='flex items-center gap-2 text-sm font-medium'><Switch checked={d.embed.enabled} disabled={!manage} onCheckedChange={(v) => set({ embed: { ...d.embed, enabled: v } })} /> Embed</label>
            {d.embed.enabled && <EmbedFields idPrefix='sl' embed={d.embed} disabled={!manage} onChange={(patch) => set({ embed: { ...d.embed, ...patch } })} />}
            <label className='flex items-center gap-2 text-sm'><Switch checked={d.repost} disabled={!manage} onCheckedChange={(v) => set({ repost: v })} /> Reposter le message s’il est supprimé à la main sur Discord</label>
          </div>
        </Section>

        {manage && (
          <div className='flex justify-end'>
            <Button disabled={!d.name.trim() || !d.guildId || !d.channelId || save.isPending || (Boolean(board) && !dirty)} onClick={() => save.mutate()}>
              {board ? <><Save /> Enregistrer et mettre à jour</> : <><Send /> Publier dans #{guild?.channels.find((c) => c.id === d.channelId)?.name ?? '…'}</>}
            </Button>
          </div>
        )}
      </div>
      <div className='xl:sticky xl:top-20 xl:self-start'>
        <h3 className='mb-2 text-sm font-semibold'>Aperçu</h3>
        {preview.error ? <Notice tone='warning'>{(preview.error as Error).message}</Notice>
          : shown ? (
            <div className='grid gap-2'>
              {shown.messages.map((m, i) => {
                const last = i === shown.messages.length - 1
                const hasBody = Boolean(m.content) || (m.embed.enabled && Boolean(m.embed.title || m.embed.description || m.embed.imageUrl || m.embed.authorName || m.embed.fields?.length))
                return (
                  <div key={i} className='grid gap-1'>
                    {(hasBody || (last && !m.cards.length)) && <DiscordPreview content={m.content} embed={m.embed} roles={new Map()} extras={{ buttons: last && !m.cards.length ? shown.buttons : [] }} />}
                    {m.cards.map((c, j) => (
                      <div key={j} className='flex items-start gap-3 rounded border-l-4 bg-[#2b2d31] p-3 text-sm text-[#dbdee1]' style={{ borderLeftColor: c.color }}>
                        <div className='min-w-0 flex-1'>
                          {c.title && <div className='font-semibold text-[#00a8fc]'>{c.title}</div>}
                          {c.description && <div className='whitespace-pre-wrap break-words text-xs'>{c.description.replace(/[_*]{2}/g, '')}</div>}
                        </div>
                        {c.thumbnailUrl && <img src={c.thumbnailUrl} alt='' className='size-12 rounded' />}
                      </div>
                    ))}
                    {last && m.cards.length > 0 && shown.buttons.length > 0 && (
                      <div className='flex flex-wrap gap-2'>
                        {shown.buttons.map((b, j) => <span key={j} className='rounded bg-[#4e5058] px-3 py-1 text-xs font-medium text-white'>{b.label}</span>)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : <Skeleton className='h-40' />}
        {shown && <p className='mt-2 text-xs text-muted-foreground'>{shown.servers.length} serveur{shown.servers.length > 1 ? 's' : ''} listé{shown.servers.length > 1 ? 's' : ''}. Le message suit tout seul les changements du réseau et des invitations.</p>}
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title='Supprimer ce message ?' desc='Il est aussi supprimé du salon Discord.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </div>
  )
}
