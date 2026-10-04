import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BellRing, Eye, FlaskConical, Music2, Pencil, Plus, Rss, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { EmptyState, Notice, Pill, Section, StatCards } from '@/components/app/ui'
import { VariableButton, type VariableGroup } from '@/components/app/variable-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DuplicateButton } from '@/components/app/duplicate-button'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { EMPTY_EMBED, EmbedFields, cleanEmbed } from '@/features/announcements/embed-editor'
import { TargetsEditor } from '@/features/announcements/targets-editor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { copyOf } from '@/lib/utils'

type Kind = 'rss' | 'tiktok'
type Payload = { content: string; embed: AnnouncementEmbed }
type Config = { intervalMinutes: number; requireWords: string[]; excludeWords: string[] }
type Feed = {
  id: number; kind: Kind; url: string; displayName: string; targets: AnnouncementTarget[]; payload: Payload; config: Config; enabled: boolean
  state: { feedTitle: string | null; checkedAt: number | null; nextCheckAt: number | null; failures: number; error: string | null; lastItemAt: number | null; ready: boolean }
}
type History = { id: number; subscriptionId: number; displayName: string; feedKind: Kind; kind: 'item' | 'test'; title: string | null; url: string | null; channels: number; at: number }
type Data = { subscriptions: Feed[]; history: History[]; variables: VariableGroup[] }
type Preview = { title: string; link: string | null; items: { title: string; link: string | null; image: string | null; author: string; publishedAt: number | null }[] }

const KIND: Record<Kind, { label: string; color: string; hint: string }> = {
  rss: { label: 'RSS / Atom', color: '#ff9628', hint: 'https://site.fr/feed.xml' },
  tiktok: { label: 'TikTok', color: '#ff0050', hint: 'https://<instance-rsshub>/tiktok/user/@pseudo' },
}
const INTERVALS = [5, 10, 15, 30, 60, 180, 360, 720, 1440]
const minutesText = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`)

const DEFAULTS: Record<Kind, Payload> = {
  rss: { content: '📰 Nouveau sur **{flux.nom}**', embed: { ...EMPTY_EMBED, title: '{item.titre}', url: '{item.lien}', description: '{item.description}', imageUrl: '{item.image}', color: KIND.rss.color, timestamp: true } },
  tiktok: { content: '🎵 Nouvelle vidéo TikTok de **{chaine.nom}** !', embed: { ...EMPTY_EMBED, title: '{video.titre}', url: '{video.lien}', imageUrl: '{video.image}', color: KIND.tiktok.color, timestamp: true } },
}
const SAMPLE: Record<string, string> = {
  'item.titre': 'Mise à jour 2.0 : nouveaux métiers', 'video.titre': 'Course-poursuite sur le serveur', 'item.description': 'Les nouveautés de la semaine et les corrections.',
  'item.auteur': 'Staff BRL', 'chaine.nom': 'brothers.life', 'flux.nom': 'Actus BRL', 'flux.titre': 'Actus BRL', 'item.date': '05/10/2026 18:00', server: 'Brothers Life',
}
const SAMPLE_IMAGE = 'https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg'
const fill = (t: string) => t.replace(/\{([a-z.]+)\}/gi, (m, k: string) => SAMPLE[k] ?? m)
const isImageVar = (v: string | null) => v === '{item.image}' || v === '{video.image}'

function KindBadge({ kind }: { kind: Kind }) {
  return <span className='rounded px-1.5 py-0.5 text-xs font-semibold text-white' style={{ background: KIND[kind].color }}>{KIND[kind].label}</span>
}

export function FeedsSection({ guilds, manage }: { guilds: AnnouncementTargetsPayload; manage: boolean }) {
  const qc = useQueryClient()
  const { data, dataUpdatedAt } = useQuery({ queryKey: ['feeds'], queryFn: () => api<Data>('/feeds'), refetchInterval: 30_000 })
  const [editing, setEditing] = useState<Partial<Feed> | null>(null)
  const [deleting, setDeleting] = useState<Feed | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['feeds'] })
  const toggle = useMutation({ mutationFn: (f: Feed) => api(`/feeds/${f.id}`, { method: 'PUT', body: { enabled: !f.enabled } }), onSuccess: refresh })
  const test = useMutation({
    mutationFn: (f: Feed) => api<{ sent: number; total: number }>(`/feeds/${f.id}/test`, { method: 'POST' }),
    onSuccess: (r) => { if (r.sent === r.total) toast.success('Exemple envoyé'); else toast.warning(`Exemple envoyé dans ${r.sent} salon(s) sur ${r.total}`); refresh() },
  })
  const remove = useMutation({ mutationFn: (f: Feed) => api(`/feeds/${f.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Flux supprimé'); setDeleting(null); refresh() } })

  if (!data) return <Skeleton className='h-96 w-full' />
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <StatCards items={[
        { label: 'Flux suivis', value: data.subscriptions.length, icon: Rss, tone: 'accent' },
        { label: 'Comptes TikTok', value: data.subscriptions.filter((f) => f.kind === 'tiktok').length, icon: Music2, tone: 'info' },
        { label: 'Publications (24 h)', value: data.history.filter((h) => h.kind === 'item' && dataUpdatedAt - h.at < 86_400_000).length, icon: BellRing, tone: 'info' },
        { label: 'Flux en erreur', value: data.subscriptions.filter((f) => f.state.error).length, icon: AlertTriangle, tone: data.subscriptions.some((f) => f.state.error) ? 'warning' : 'neutral' },
      ]} />
      <Section
        title={`${data.subscriptions.length} flux suivi${data.subscriptions.length > 1 ? 's' : ''}`}
        description='Chaque flux est relu à son rythme (5 min minimum). À l’ajout, ce qu’il contient déjà n’est pas annoncé ; ensuite chaque nouvelle publication est annoncée une seule fois (3 au plus par relecture). En cas d’erreur, le délai double jusqu’à 6 h.'
        actions={manage && <Button size='sm' onClick={() => setEditing({})}><Plus /> Ajouter un flux</Button>}
      >
        {!data.subscriptions.length ? <EmptyState title='Aucun flux suivi' icon={Rss}>Ajoute un flux RSS / Atom (blog, site d’actualité, forum…) ou un compte TikTok.</EmptyState> : (
          <ul className='divide-y'>
            {data.subscriptions.map((f) => (
              <li key={f.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                <span className='grid size-10 shrink-0 place-items-center rounded-full bg-muted'>
                  {f.kind === 'tiktok' ? <Music2 className='size-5' style={{ color: KIND.tiktok.color }} /> : <Rss className='size-5' style={{ color: KIND.rss.color }} />}
                </span>
                <div className='min-w-0 flex-1 basis-52'>
                  <div className='flex flex-wrap items-center gap-2 font-medium'>
                    {f.displayName} <KindBadge kind={f.kind} />
                    {f.state.error ? <Pill tone='danger'>Erreur{f.state.failures > 1 ? ` ×${f.state.failures}` : ''}</Pill> : f.state.ready ? <Pill tone='success'>OK</Pill> : <Pill>En attente</Pill>}
                    {!f.enabled && <Pill tone='warning'>En pause</Pill>}
                  </div>
                  <div className='truncate text-xs text-muted-foreground'>
                    <a href={f.url} target='_blank' rel='noreferrer' className='hover:underline'>{f.url}</a>
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {f.targets.length} salon(s) · toutes les {minutesText(f.config.intervalMinutes)}
                    {f.state.lastItemAt ? ` · dernière publication ${ago(f.state.lastItemAt)}` : ''}
                    {f.state.checkedAt ? ` · vérifié ${ago(f.state.checkedAt)}` : ' · pas encore vérifié'}
                    {f.state.error && f.state.nextCheckAt ? ` · nouvel essai ${dateTime(f.state.nextCheckAt)}` : ''}
                  </div>
                  {f.state.error && <div className='text-xs text-destructive'>{f.state.error}</div>}
                </div>
                {manage && (
                  <div className='flex items-center gap-2'>
                    <Switch checked={f.enabled} onCheckedChange={() => toggle.mutate(f)} aria-label={`Activer ${f.displayName}`} />
                    <Button size='sm' variant='outline' onClick={() => test.mutate(f)} disabled={test.isPending}><FlaskConical /> Tester</Button>
                    <Button size='icon' variant='ghost' aria-label={`Modifier ${f.displayName}`} onClick={() => setEditing(f)}><Pencil /></Button>
                    <DuplicateButton name={f.displayName} onClick={() => setEditing(copyOf(f))} />
                    <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${f.displayName}`} onClick={() => setDeleting(f)}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title='Historique des flux'>
        {!data.history.length ? <EmptyState title='Rien d’envoyé pour l’instant' /> : (
          <ul className='divide-y text-sm'>
            {data.history.map((h) => (
              <li key={h.id} className='flex flex-wrap items-center gap-2 px-4 py-2'>
                <span className='w-24 shrink-0'>{h.kind === 'test' ? '🧪 Test' : '📰 Publication'}</span>
                <KindBadge kind={h.feedKind} />
                <span className='font-medium'>{h.displayName}</span>
                <span className='min-w-0 flex-1 basis-40 truncate text-muted-foreground'>{h.url ? <a href={h.url} target='_blank' rel='noreferrer' className='hover:underline'>{h.title}</a> : h.title}</span>
                <span className='text-xs text-muted-foreground'>{h.channels} salon(s) · {dateTime(h.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing && <FeedDialog initial={editing} guilds={guilds} variables={data.variables} onClose={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Ne plus suivre ${deleting?.displayName} ?`} desc='Les messages déjà envoyés restent sur Discord.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  )
}

function FeedDialog({ initial, guilds, variables, onClose }: { initial: Partial<Feed>; guilds: AnnouncementTargetsPayload; variables: VariableGroup[]; onClose: () => void }) {
  const isNew = !initial.id
  const [kind, setKind] = useState<Kind>(initial.kind ?? 'rss')
  const [url, setUrl] = useState(initial.url ?? '')
  const [displayName, setDisplayName] = useState(initial.displayName ?? '')
  const [targets, setTargets] = useState<AnnouncementTarget[]>(initial.targets ?? [])
  const [payload, setPayload] = useState<Payload>(() => initial.payload ? { ...initial.payload, embed: { ...EMPTY_EMBED, ...initial.payload.embed } } : DEFAULTS.rss)
  const [interval, setIntervalMinutes] = useState(initial.config?.intervalMinutes ?? 15)
  const [require, setRequire] = useState((initial.config?.requireWords ?? []).join(', '))
  const [exclude, setExclude] = useState((initial.config?.excludeWords ?? []).join(', '))
  const [preview, setPreview] = useState<Preview | null>(null)
  const varsBox = useRef<HTMLDivElement>(null)
  const roles = new Map(guilds.flatMap((g) => g.roles.map((r) => [r.id, r.name] as const)))
  const split = (t: string) => t.split(',').map((w) => w.trim()).filter(Boolean)
  const check = useMutation({ mutationFn: () => api<Preview>('/feeds/preview', { method: 'POST', body: { url } }), onSuccess: setPreview })
  const save = useMutation({
    mutationFn: () => {
      const body = { kind, url, displayName, targets, payload: { ...payload, embed: cleanEmbed(payload.embed) }, config: { intervalMinutes: interval, requireWords: split(require), excludeWords: split(exclude) } }
      return isNew ? api('/feeds', { method: 'POST', body }) : api(`/feeds/${initial.id}`, { method: 'PUT', body })
    },
    onSuccess: () => { toast.success(isNew ? 'Flux ajouté' : 'Flux modifié'); onClose() },
  })
  const e = payload.embed
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader><DialogTitle>{isNew ? 'Suivre un flux' : `Modifier ${initial.displayName}`}</DialogTitle></DialogHeader>
        <Tabs defaultValue='general'>
          <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
            <TabsTrigger value='general'>Flux</TabsTrigger>
            <TabsTrigger value='targets'>Salons ({targets.length})</TabsTrigger>
            <TabsTrigger value='message'>Message</TabsTrigger>
          </TabsList>
          <TabsContent value='general' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]'>
              <div className='grid gap-1.5'>
                <Label>Type</Label>
                <Select value={kind} disabled={!isNew} onValueChange={(v) => { setKind(v as Kind); if (isNew) { setPayload(DEFAULTS[v as Kind]); setIntervalMinutes(v === 'tiktok' ? 30 : 15) } }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='rss'>Flux RSS / Atom</SelectItem>
                    <SelectItem value='tiktok'>TikTok (via RSS)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='fd-url'>Adresse du flux</Label>
                <div className='flex gap-2'>
                  <Input id='fd-url' value={url} maxLength={500} onChange={(ev) => { setUrl(ev.target.value); setPreview(null) }} placeholder={KIND[kind].hint} />
                  <Button type='button' variant='outline' onClick={() => check.mutate()} disabled={!url.trim() || check.isPending}><Eye /> Vérifier</Button>
                </div>
              </div>
            </div>
            {kind === 'tiktok' && (
              <Notice tone='info' title='TikTok passe par un flux RSS'>
                TikTok n’a pas d’API publique pour lire les vidéos d’un compte, et ses pages demandent des requêtes signées qui changent souvent.
                Le bot lit donc un flux RSS du compte, fourni par un service comme RSSHub (route <code>/tiktok/user/@pseudo</code>, sur une instance publique ou que tu héberges).
                Si l’instance tombe ou est bloquée par TikTok, le flux passe en erreur ici.
              </Notice>
            )}
            {preview && (
              <div className='rounded-lg border p-3 text-sm'>
                <p className='font-medium'>✅ {preview.title || 'Flux sans titre'} · {preview.items.length} publication(s) lue(s)</p>
                <ul className='mt-2 grid gap-1 text-muted-foreground'>
                  {preview.items.map((i, n) => <li key={n} className='truncate'>• {i.title || '(sans titre)'}{i.publishedAt ? ` · ${dateTime(i.publishedAt)}` : ''}</li>)}
                </ul>
              </div>
            )}
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <div className='grid gap-1.5'>
                <Label htmlFor='fd-name'>Nom affiché</Label>
                <Input id='fd-name' value={displayName} maxLength={100} onChange={(ev) => setDisplayName(ev.target.value)} placeholder='Titre du flux par défaut' />
              </div>
              <div className='grid gap-1.5'>
                <Label>Relire toutes les</Label>
                <Select value={String(interval)} onValueChange={(v) => setIntervalMinutes(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[...new Set([...INTERVALS, interval])].sort((a, b) => a - b).map((m) => <SelectItem key={m} value={String(m)}>{minutesText(m)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='fd-require'>Doit contenir un de ces mots</Label>
                <Input id='fd-require' value={require} onChange={(ev) => setRequire(ev.target.value)} placeholder='RP, event (vide = tout)' />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='fd-exclude'>Ignorer si contient</Label>
                <Input id='fd-exclude' value={exclude} onChange={(ev) => setExclude(ev.target.value)} placeholder='sponsorisé, test' />
              </div>
            </div>
          </TabsContent>
          <TabsContent value='targets' className='mt-4'>
            <TargetsEditor guilds={guilds} targets={targets} onChange={setTargets} disabled={false} />
          </TabsContent>
          <TabsContent value='message' className='mt-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]'>
              <div className='grid content-start gap-4' ref={varsBox}>
                <div className='grid gap-1.5'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <Label htmlFor='fd-content'>Texte</Label>
                    <VariableButton scope='server' container={varsBox} extra={variables} />
                  </div>
                  <Textarea id='fd-content' rows={2} maxLength={2000} value={payload.content} onChange={(ev) => setPayload({ ...payload, content: ev.target.value })} />
                  <span className='text-xs text-muted-foreground'>{'{item.lien}'}, {'{item.image}'}, {'{video.lien}'}, {'{video.image}'} et {'{flux.lien}'} marchent aussi dans les champs de lien et d’image.</span>
                </div>
                <EmbedFields embed={e} onChange={(patch) => setPayload({ ...payload, embed: { ...e, ...patch } })} idPrefix='fd' />
              </div>
              <div className='lg:sticky lg:top-0 lg:self-start'>
                <DiscordPreview
                  content={fill(payload.content)}
                  embed={{ ...e, title: fill(e.title), description: fill(e.description), url: e.url ? 'https://example.com' : null, imageUrl: isImageVar(e.imageUrl) ? SAMPLE_IMAGE : e.imageUrl, thumbnailUrl: isImageVar(e.thumbnailUrl) ? SAMPLE_IMAGE : e.thumbnailUrl }}
                  target={targets[0]} roles={roles}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={!url.trim() || !targets.length || save.isPending}><Save /> {save.isPending ? 'Lecture du flux…' : 'Enregistrer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
