import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BellRing, FlaskConical, KeyRound, Pencil, Plus, Radio, Rss, Save, Trash2, Tv } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards } from '@/components/app/ui'
import { UserPicker } from '@/components/app/user-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useConfirm } from '@/components/app/confirm'
import { TEST_LABEL, testConfirm } from '@/features/announcements/test-confirm'
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
import { DuplicateButton } from '@/components/app/duplicate-button'
import { copyOf } from '@/lib/utils'
import { FeedsSection } from '@/features/feeds/feeds-section'

export const Route = createFileRoute('/_authenticated/streams')({
  component: StreamsPage,
})

type Platform = 'twitch' | 'youtube' | 'kick'
type Payload = { content: string; embed: AnnouncementEmbed }
type Config = {
  lives: boolean; videos: boolean; shorts: boolean; requireWords: string[]; excludeWords: string[]; endAction: 'edit' | 'delete' | 'none'
  liveRole: { userId: string | null; roleByGuild: Record<string, string> }
}
type Subscription = {
  id: number; platform: Platform; channel: string; displayName: string; targets: AnnouncementTarget[]; payloads: { live: Payload; video: Payload }; config: Config; enabled: boolean
  state: { live: boolean; title: string | null; game: string | null; peakViewers: number; startedAt: number | null; lastVideoAt: number | null; checkedAt: number | null; error: string | null }
}
type History = { id: number; subscriptionId: number; displayName: string; platform: Platform; kind: 'live' | 'video' | 'short' | 'end' | 'test'; title: string | null; url: string | null; channels: number; at: number }
type Credentials = { twitch: { clientId: string; hasSecret: boolean }; kick: { clientId: string; hasSecret: boolean }; youtube: { hasApiKey: boolean } }
type Data = { subscriptions: Subscription[]; history: History[]; credentials: Credentials; guilds: AnnouncementTargetsPayload }

const PLATFORM: Record<Platform, { label: string; color: string; hint: string }> = {
  twitch: { label: 'Twitch', color: '#9146ff', hint: 'Nom de la chaîne (twitch.tv/…)' },
  youtube: { label: 'YouTube', color: '#ff0000', hint: '@nom de la chaîne ou identifiant UC…' },
  kick: { label: 'Kick', color: '#53fc18', hint: 'Nom de la chaîne (kick.com/…)' },
}
const KIND: Record<History['kind'], string> = { live: '🔴 Live', video: '📺 Vidéo', short: '📱 Short', end: '⚫ Fin de live', test: '🧪 Test' }

const DEFAULTS = (platform: Platform): { live: Payload; video: Payload } => ({
  live: { content: '🔴 **{streamer}** est en live !', embed: { ...EMPTY_EMBED, title: '{title}', url: '{url}', description: '🎮 {game}\n👀 {viewers} spectateurs', imageUrl: '{thumbnail}', color: PLATFORM[platform].color, timestamp: true } },
  video: { content: '📺 Nouvelle vidéo de **{streamer}** !', embed: { ...EMPTY_EMBED, title: '{title}', url: '{url}', imageUrl: '{thumbnail}', color: PLATFORM[platform].color, timestamp: true } },
})
const EMPTY_CONFIG: Config = { lives: true, videos: true, shorts: false, requireWords: [], excludeWords: [], endAction: 'edit', liveRole: { userId: null, roleByGuild: {} } }

function PlatformBadge({ platform }: { platform: Platform }) {
  return <span className='rounded px-1.5 py-0.5 text-xs font-semibold text-white' style={{ background: PLATFORM[platform].color, color: platform === 'kick' ? '#000' : '#fff' }}>{PLATFORM[platform].label}</span>
}

function StreamsPage() {
  const { can } = useMe()
  const manage = can('notifications.manage')
  const qc = useQueryClient()
  const { data, dataUpdatedAt } = useQuery({ queryKey: ['streams'], queryFn: () => api<Data>('/streams'), refetchInterval: 30_000 })
  const [editing, setEditing] = useState<Partial<Subscription> | null>(null)
  const [deleting, setDeleting] = useState<Subscription | null>(null)
  const [tab, setTab] = useState('channels')
  const { confirm, dialog } = useConfirm()
  const refresh = () => qc.invalidateQueries({ queryKey: ['streams'] })
  const toggle = useMutation({ mutationFn: (s: Subscription) => api(`/streams/${s.id}`, { method: 'PUT', body: { enabled: !s.enabled } }), onSuccess: refresh })
  const test = useMutation({
    mutationFn: (s: Subscription) => api<{ sent: number; total: number }>(`/streams/${s.id}/test`, { method: 'POST' }),
    onSuccess: (r) => { if (r.sent === r.total) toast.success('Essai envoyé, sans mention'); else toast.warning(`Essai envoyé dans ${r.sent} salon(s) sur ${r.total}`); refresh() },
  })
  const runTest = async (s: Subscription) => {
    if (await confirm(testConfirm(s.targets, data?.guilds ?? [], `un exemple d’annonce de live de ${s.displayName}`))) test.mutate(s)
  }
  const remove = useMutation({ mutationFn: (s: Subscription) => api(`/streams/${s.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Abonnement supprimé'); setDeleting(null); refresh() } })

  return (
    <Page
      title='Streams, vidéos et flux'
      description='Le bot annonce les lives Twitch, Kick et YouTube, les nouvelles vidéos et Shorts YouTube, les vidéos TikTok et les nouveautés de n’importe quel flux RSS dans les salons que tu choisis. Un live n’est annoncé qu’une fois, et le message est mis à jour à la fin.'
      actions={manage && tab === 'channels' && <Button onClick={() => setEditing({})}><Plus /> Ajouter une chaîne</Button>}
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
            <TabsTrigger value='channels'><Tv /> Chaînes (Twitch, Kick, YouTube)</TabsTrigger>
            <TabsTrigger value='feeds'><Rss /> Flux RSS et TikTok</TabsTrigger>
          </TabsList>
          <TabsContent value='feeds' className='mt-4'>
            <FeedsSection guilds={data.guilds} manage={manage} />
          </TabsContent>
          <TabsContent value='channels' className='mt-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
              <StatCards items={[
                { label: 'Chaînes suivies', value: data.subscriptions.length, icon: Tv, tone: 'accent' },
                { label: 'En live maintenant', value: data.subscriptions.filter((s) => s.state.live).length, icon: Radio, tone: 'danger' },
                { label: 'Notifications (24 h)', value: data.history.filter((h) => h.kind !== 'end' && h.kind !== 'test' && dataUpdatedAt - h.at < 86_400_000).length, icon: BellRing, tone: 'info' },
                { label: 'Chaînes en erreur', value: data.subscriptions.filter((s) => s.state.error).length, icon: AlertTriangle, tone: data.subscriptions.some((s) => s.state.error) ? 'warning' : 'neutral' },
              ]} />
              <Section title={`${data.subscriptions.length} chaîne${data.subscriptions.length > 1 ? 's' : ''} suivie${data.subscriptions.length > 1 ? 's' : ''}`}>
                {!data.subscriptions.length ? <EmptyState title='Aucune chaîne suivie'>Ajoute une chaîne Twitch, YouTube ou Kick à annoncer.</EmptyState> : (
                  <ul className='divide-y'>
                    {data.subscriptions.map((s) => (
                      <li key={s.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                        <span className='relative grid size-10 shrink-0 place-items-center rounded-full bg-muted'>
                          <Radio className='size-5' style={{ color: PLATFORM[s.platform].color }} />
                          {s.state.live && <span className='absolute -end-0.5 -top-0.5 size-3 animate-pulse rounded-full bg-destructive ring-2 ring-card' aria-label='En live' />}
                        </span>
                        <div className='min-w-52 flex-1'>
                          <div className='flex flex-wrap items-center gap-2 font-medium'>
                            {s.displayName} <PlatformBadge platform={s.platform} />
                            {s.state.live ? <Pill tone='danger'>En live{s.state.peakViewers ? ` · ${s.state.peakViewers} max` : ''}</Pill> : <Pill>Hors ligne</Pill>}
                            {!s.enabled && <Pill tone='warning'>En pause</Pill>}
                          </div>
                          <div className='truncate text-xs text-muted-foreground'>
                            {s.state.live && s.state.title ? `${s.state.title}${s.state.game ? ` · ${s.state.game}` : ''} · depuis ${ago(s.state.startedAt)}` : `${s.targets.length} salon(s)`}
                            {s.state.lastVideoAt ? ` · dernière vidéo ${ago(s.state.lastVideoAt)}` : ''}
                            {s.state.checkedAt ? ` · vérifié ${ago(s.state.checkedAt)}` : ' · pas encore vérifié'}
                          </div>
                          {s.state.error && <div className='text-xs text-destructive'>{s.state.error}</div>}
                        </div>
                        {manage && (
                          <div className='flex items-center gap-2'>
                            <Switch checked={s.enabled} onCheckedChange={() => toggle.mutate(s)} aria-label={`Activer ${s.displayName}`} />
                            <Button size='sm' variant='outline' onClick={() => void runTest(s)} disabled={test.isPending || !s.targets.length}><FlaskConical /> {TEST_LABEL}</Button>
                            <Button size='icon' variant='ghost' aria-label={`Modifier ${s.displayName}`} onClick={() => setEditing(s)}><Pencil /></Button>
                            <DuplicateButton name={s.displayName} onClick={() => setEditing(copyOf(s))} />
                            <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${s.displayName}`} onClick={() => setDeleting(s)}><Trash2 /></Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {manage && <CredentialsSection key={JSON.stringify(data.credentials)} credentials={data.credentials} />}

              <Section title='Historique'>
                {!data.history.length ? <EmptyState title='Rien d’envoyé pour l’instant' /> : (
                  <ul className='divide-y text-sm'>
                    {data.history.map((h) => (
                      <li key={h.id} className='flex flex-wrap items-center gap-2 px-4 py-2'>
                        <span className='w-28 shrink-0'>{KIND[h.kind]}</span>
                        <PlatformBadge platform={h.platform} />
                        <span className='font-medium'>{h.displayName}</span>
                        <span className='min-w-0 flex-1 truncate text-muted-foreground'>{h.url ? <a href={h.url} target='_blank' rel='noreferrer' className='hover:underline'>{h.title}</a> : h.title}</span>
                        <span className='text-xs text-muted-foreground'>{h.channels} salon(s) · {dateTime(h.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </TabsContent>
        </Tabs>
      )}
      {editing && data && <SubscriptionDialog initial={editing} guilds={data.guilds} onClose={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Ne plus suivre ${deleting?.displayName} ?`} desc='Les messages déjà envoyés restent sur Discord.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
      {dialog}
    </Page>
  )
}

function CredentialsSection({ credentials: c }: { credentials: Credentials }) {
  const qc = useQueryClient()
  const [twitch, setTwitch] = useState({ clientId: c.twitch.clientId, clientSecret: '' })
  const [kick, setKick] = useState({ clientId: c.kick.clientId, clientSecret: '' })
  const [youtubeApiKey, setYoutubeApiKey] = useState('')
  const save = useMutation({
    mutationFn: () => api('/streams/credentials', { method: 'PUT', body: { twitch, kick, youtubeApiKey } }),
    onSuccess: () => {
      toast.success('Clés enregistrées')
      // Secrets are never shown again: drop them from the form once saved
      setTwitch((t) => ({ ...t, clientSecret: '' }))
      setKick((k) => ({ ...k, clientSecret: '' }))
      setYoutubeApiKey('')
      qc.invalidateQueries({ queryKey: ['streams'] })
    },
  })
  const secret = (has: boolean) => (has ? '•••••••• (enregistré, vide = inchangé)' : 'Secret')
  return (
    <Section
      title='Clés des plateformes'
      description='Twitch et Kick demandent une application développeur (ID client et secret). YouTube marche sans clé ; une clé API YouTube Data détecte les lives de façon plus fiable. Les secrets ne sont jamais réaffichés.'
      actions={<Button size='sm' onClick={() => save.mutate()} disabled={save.isPending}><KeyRound /> Enregistrer</Button>}
    >
      <div className='grid grid-cols-[minmax(0,1fr)] gap-5 p-4 lg:grid-cols-3'>
        <fieldset className='grid content-start gap-2'>
          <legend className='mb-1 flex items-center gap-2 text-sm font-medium'><PlatformBadge platform='twitch' /> dev.twitch.tv</legend>
          <Input value={twitch.clientId} onChange={(e) => setTwitch({ ...twitch, clientId: e.target.value })} placeholder='ID client' aria-label='ID client Twitch' />
          <Input type='password' autoComplete='off' value={twitch.clientSecret} onChange={(e) => setTwitch({ ...twitch, clientSecret: e.target.value })} placeholder={secret(c.twitch.hasSecret)} aria-label='Secret Twitch' />
        </fieldset>
        <fieldset className='grid content-start gap-2'>
          <legend className='mb-1 flex items-center gap-2 text-sm font-medium'><PlatformBadge platform='kick' /> kick.com/settings/developer</legend>
          <Input value={kick.clientId} onChange={(e) => setKick({ ...kick, clientId: e.target.value })} placeholder='ID client' aria-label='ID client Kick' />
          <Input type='password' autoComplete='off' value={kick.clientSecret} onChange={(e) => setKick({ ...kick, clientSecret: e.target.value })} placeholder={secret(c.kick.hasSecret)} aria-label='Secret Kick' />
        </fieldset>
        <fieldset className='grid content-start gap-2'>
          <legend className='mb-1 flex items-center gap-2 text-sm font-medium'><PlatformBadge platform='youtube' /> facultatif</legend>
          <Input type='password' autoComplete='off' value={youtubeApiKey} onChange={(e) => setYoutubeApiKey(e.target.value)} placeholder={c.youtube.hasApiKey ? '•••••••• (enregistrée, vide = inchangée)' : 'Clé API YouTube Data'} aria-label='Clé API YouTube' />
        </fieldset>
      </div>
    </Section>
  )
}

function PayloadEditor({ value, onChange, idPrefix, guilds, target }: { value: Payload; onChange: (p: Payload) => void; idPrefix: string; guilds: AnnouncementTargetsPayload; target?: AnnouncementTarget }) {
  const roles = new Map(guilds.flatMap((g) => g.roles.map((r) => [r.id, r.name] as const)))
  const sample = (t: string) => t.replaceAll('{streamer}', 'BRL_TV').replaceAll('{title}', 'Soirée RP sur le serveur').replaceAll('{game}', 'Grand Theft Auto V').replaceAll('{viewers}', '128')
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]'>
      <div className='grid content-start gap-4'>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${idPrefix}-content`}>Texte</Label>
          <Textarea id={`${idPrefix}-content`} rows={2} maxLength={2000} value={value.content} onChange={(e) => onChange({ ...value, content: e.target.value })} />
          <span className='text-xs text-muted-foreground'>Variables : {'{streamer} {title} {game} {viewers} {url} {thumbnail}'} (les deux dernières marchent aussi dans les champs d’image et de lien), aussi en français : {'{chaine.nom} {video.titre} {video.lien} {video.image}'}, et celles du serveur : {'{server} {date} {time}'}.</span>
        </div>
        <EmbedFields embed={value.embed} onChange={(patch) => onChange({ ...value, embed: { ...value.embed, ...patch } })} idPrefix={idPrefix} />
      </div>
      <div className='lg:sticky lg:top-0 lg:self-start'>
        <DiscordPreview
          content={sample(value.content)}
          embed={{ ...value.embed, title: sample(value.embed.title), description: sample(value.embed.description), url: value.embed.url ? 'https://twitch.tv' : null, imageUrl: value.embed.imageUrl === '{thumbnail}' ? 'https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg' : value.embed.imageUrl }}
          target={target} roles={roles}
        />
      </div>
    </div>
  )
}

function SubscriptionDialog({ initial, guilds, onClose }: { initial: Partial<Subscription>; guilds: AnnouncementTargetsPayload; onClose: () => void }) {
  const isNew = !initial.id
  const [platform, setPlatform] = useState<Platform>(initial.platform ?? 'twitch')
  const [channel, setChannel] = useState(initial.channel ?? '')
  const [displayName, setDisplayName] = useState(initial.displayName ?? '')
  const [targets, setTargets] = useState<AnnouncementTarget[]>(initial.targets ?? [])
  const [payloads, setPayloads] = useState(() => initial.payloads
    ? { live: { ...initial.payloads.live, embed: { ...EMPTY_EMBED, ...initial.payloads.live.embed } }, video: { ...initial.payloads.video, embed: { ...EMPTY_EMBED, ...initial.payloads.video.embed } } }
    : DEFAULTS('twitch'))
  const [config, setConfig] = useState<Config>(initial.config ?? EMPTY_CONFIG)
  const [require, setRequire] = useState((initial.config?.requireWords ?? []).join(', '))
  const [exclude, setExclude] = useState((initial.config?.excludeWords ?? []).join(', '))
  const set = (patch: Partial<Config>) => setConfig({ ...config, ...patch })
  const split = (t: string) => t.split(',').map((w) => w.trim()).filter(Boolean)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        platform, channel, displayName, targets,
        payloads: { live: { ...payloads.live, embed: cleanEmbed(payloads.live.embed) }, video: { ...payloads.video, embed: cleanEmbed(payloads.video.embed) } },
        config: { ...config, requireWords: split(require), excludeWords: split(exclude) },
      }
      return isNew ? api('/streams', { method: 'POST', body }) : api(`/streams/${initial.id}`, { method: 'PUT', body })
    },
    onSuccess: () => { toast.success(isNew ? 'Chaîne ajoutée' : 'Chaîne modifiée'); onClose() },
  })
  const youtube = platform === 'youtube'
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader><DialogTitle>{isNew ? 'Suivre une chaîne' : `Modifier ${initial.displayName}`}</DialogTitle></DialogHeader>
        <Tabs defaultValue='general'>
          <TabsList className='flex-wrap'>
            <TabsTrigger value='general'>Chaîne</TabsTrigger>
            <TabsTrigger value='targets'>Salons ({targets.length})</TabsTrigger>
            <TabsTrigger value='live'>Message de live</TabsTrigger>
            {youtube && <TabsTrigger value='video'>Message de vidéo</TabsTrigger>}
            <TabsTrigger value='role'>Rôle en live</TabsTrigger>
          </TabsList>
          <TabsContent value='general' className='mt-4 grid gap-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3'>
              <div className='grid gap-1.5'>
                <Label>Plateforme</Label>
                <Select value={platform} disabled={!isNew} onValueChange={(v) => { setPlatform(v as Platform); if (isNew) setPayloads(DEFAULTS(v as Platform)) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(PLATFORM) as Platform[]).map((p) => <SelectItem key={p} value={p}>{PLATFORM[p].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='st-channel'>Chaîne</Label>
                <Input id='st-channel' value={channel} maxLength={200} onChange={(e) => setChannel(e.target.value)} placeholder={PLATFORM[platform].hint} />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='st-name'>Nom affiché</Label>
                <Input id='st-name' value={displayName} maxLength={100} onChange={(e) => setDisplayName(e.target.value)} placeholder='Nom de la chaîne par défaut' />
              </div>
            </div>
            <div className='flex flex-wrap gap-6'>
              <label className='flex items-center gap-2 text-sm'><Switch checked={config.lives} onCheckedChange={(v) => set({ lives: v })} /> Annoncer les lives</label>
              {youtube && <label className='flex items-center gap-2 text-sm'><Switch checked={config.videos} onCheckedChange={(v) => set({ videos: v })} /> Nouvelles vidéos</label>}
              {youtube && <label className='flex items-center gap-2 text-sm'><Switch checked={config.shorts} onCheckedChange={(v) => set({ shorts: v })} /> Shorts</label>}
            </div>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3'>
              <div className='grid gap-1.5'>
                <Label htmlFor='st-require'>Le titre doit contenir un de ces mots</Label>
                <Input id='st-require' value={require} onChange={(e) => setRequire(e.target.value)} placeholder='RP, event (vide = tout)' />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='st-exclude'>Ignorer si le titre contient</Label>
                <Input id='st-exclude' value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder='rediffusion, test' />
              </div>
              <div className='grid gap-1.5'>
                <Label>À la fin du live</Label>
                <Select value={config.endAction} onValueChange={(v) => set({ endAction: v as Config['endAction'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='edit'>Modifier le message (durée, pic)</SelectItem>
                    <SelectItem value='delete'>Supprimer le message</SelectItem>
                    <SelectItem value='none'>Ne rien faire</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
          <TabsContent value='targets' className='mt-4'>
            <TargetsEditor guilds={guilds} targets={targets} onChange={setTargets} disabled={false} />
          </TabsContent>
          <TabsContent value='live' className='mt-4'>
            <PayloadEditor idPrefix='live' value={payloads.live} onChange={(live) => setPayloads({ ...payloads, live })} guilds={guilds} target={targets[0]} />
          </TabsContent>
          {youtube && (
            <TabsContent value='video' className='mt-4'>
              <PayloadEditor idPrefix='video' value={payloads.video} onChange={(video) => setPayloads({ ...payloads, video })} guilds={guilds} target={targets[0]} />
            </TabsContent>
          )}
          <TabsContent value='role' className='mt-4 grid gap-4'>
            <p className='text-sm text-muted-foreground'>Pendant ses lives, le membre Discord qui possède la chaîne reçoit un rôle, retiré à la fin.</p>
            <div className='grid gap-1.5 sm:max-w-sm'>
              <Label>Membre Discord du streamer</Label>
              <UserPicker value={config.liveRole.userId ?? ''} onChange={(id) => set({ liveRole: { ...config.liveRole, userId: id || null } })} />
            </div>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2'>
              {guilds.map((g) => (
                <div key={g.id} className='grid min-w-0 gap-1'>
                  <span className='truncate text-xs text-muted-foreground'>{g.name}</span>
                  <Select value={config.liveRole.roleByGuild[g.id] ?? 'none'} onValueChange={(v) => { const roleByGuild = { ...config.liveRole.roleByGuild }; if (v === 'none') delete roleByGuild[g.id]; else roleByGuild[g.id] = v; set({ liveRole: { ...config.liveRole, roleByGuild } }) }}>
                    <SelectTrigger aria-label={`Rôle en live sur ${g.name}`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value='none'>Aucun</SelectItem>{g.roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={!channel.trim() || !targets.length || save.isPending}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
