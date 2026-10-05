import { useCallback, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Rocket, Save, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { CardDesign, Guild, MessagePayload, OnboardingConfig, OnboardingPayload, OnboardingSection } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, Pill, GuildIcon } from '@/components/app/ui'
import { ChannelSelect, RolesPicker } from '@/components/app/pickers'
import { EmbedFields, EMPTY_EMBED, cleanEmbed } from '@/features/announcements/embed-editor'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { CardEditor } from '@/features/onboarding/card-editor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { EmojiField } from '@/components/app/emoji-picker'
import { VariableButton } from '@/components/app/variable-picker'
import { ButtonStylePicker } from '@/components/app/color-picker'

export const Route = createFileRoute('/_authenticated/onboarding')({
  component: OnboardingPage,
})

const WELCOME_VARIABLES = [{ title: 'Accueil', items: [{ key: 'inviter', label: 'Qui a invité le membre' }, { key: 'avatarUrl', label: 'Avatar (pour les images)' }] }]

function OnboardingPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id
  const currentGuild = active.find((g) => g.id === current)

  return (
    <Page
      title='Bienvenue et arrivées'
      description='Messages de bienvenue, de départ et de boost avec leur carte image, rôles donnés automatiquement et règlement à accepter. Chaque serveur a ses propres réglages.'
      actions={current && (
        <div className='flex items-center gap-2'>
          <Label htmlFor='onb-guild' className='text-muted-foreground'>Serveur</Label>
          <Select value={current} onValueChange={setGuildId}>
            <SelectTrigger id='onb-guild' className='w-60'>
              <span className='flex items-center gap-2 truncate'>
                {currentGuild && <GuildIcon src={currentGuild.icon} name={currentGuild.name} className='size-5' />}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      {current && <OnboardingEditor key={current} guildId={current} />}
    </Page>
  )
}

function OnboardingEditor({ guildId }: { guildId: string }) {
  const { data } = useQuery({ queryKey: ['onboarding', guildId], queryFn: () => api<OnboardingPayload>(`/onboarding/${guildId}`) })
  if (!data) return <Skeleton className='h-96 w-full' />
  return <Editor key={JSON.stringify(data.config)} guildId={guildId} data={data} />
}

function cleanPayload(p: MessagePayload): MessagePayload {
  return { content: p.content, embed: cleanEmbed({ ...EMPTY_EMBED, ...p.embed }) }
}

function Editor({ guildId, data }: { guildId: string; data: OnboardingPayload }) {
  const { can } = useMe()
  const manage = can('onboarding.manage')
  const qc = useQueryClient()
  const [config, setConfig] = useState<OnboardingConfig>(data.config)
  const dirty = JSON.stringify(config) !== JSON.stringify(data.config)

  const renderPreview = useCallback(async (design: CardDesign) => {
    const res = await fetch(`/api/onboarding/${guildId}/card/preview`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'panel' },
      body: JSON.stringify({ design }),
    })
    if (!res.ok) throw new Error('Rendu impossible')
    return res.blob()
  }, [guildId])

  const body = () => ({
    ...config,
    welcome: { ...config.welcome, payload: cleanPayload(config.welcome.payload), dm: { ...config.welcome.dm, payload: cleanPayload(config.welcome.dm.payload) } },
    leave: { ...config.leave, payload: cleanPayload(config.leave.payload) },
    boost: { ...config.boost, payload: cleanPayload(config.boost.payload), end: { ...config.boost.end, payload: cleanPayload(config.boost.end.payload) }, dm: { ...config.boost.dm, payload: cleanPayload(config.boost.dm.payload) } },
    rules: { ...config.rules, payload: cleanPayload(config.rules.payload) },
  })
  const save = useMutation({
    mutationFn: () => api<OnboardingConfig>(`/onboarding/${guildId}`, { method: 'PUT', body: body() }),
    onSuccess: (saved) => {
      toast.success('Accueil enregistré')
      qc.setQueryData<OnboardingPayload>(['onboarding', guildId], (old) => (old ? { ...old, config: saved } : old))
    },
  })
  const test = useMutation({
    mutationFn: (kind: 'welcome' | 'leave' | 'boost') => api(`/onboarding/${guildId}/test`, { method: 'POST', body: { kind } }),
    onSuccess: () => toast.success('Message de test envoyé, avec toi comme membre'),
  })
  const publishRules = useMutation({
    mutationFn: async () => {
      if (dirty) await api(`/onboarding/${guildId}`, { method: 'PUT', body: body() })
      return api<OnboardingConfig>(`/onboarding/${guildId}/rules/publish`, { method: 'POST' })
    },
    onSuccess: (saved) => {
      toast.success('Règlement publié')
      qc.setQueryData<OnboardingPayload>(['onboarding', guildId], (old) => (old ? { ...old, config: saved } : old))
    },
  })

  const set = <K extends keyof OnboardingConfig>(key: K, value: Partial<OnboardingConfig[K]>) => setConfig((c) => ({ ...c, [key]: { ...c[key], ...value } }))

  return (
    <div className='grid gap-4'>
      <Tabs defaultValue='welcome'>
        <div className='flex flex-wrap items-center gap-3'>
          <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
            <TabsTrigger value='welcome'>Bienvenue {config.welcome.enabled && <Dot />}</TabsTrigger>
            <TabsTrigger value='leave'>Départ {config.leave.enabled && <Dot />}</TabsTrigger>
            <TabsTrigger value='boost'>Boosts {config.boost.enabled && <Dot />}</TabsTrigger>
            <TabsTrigger value='rules'>Règlement {config.rules.enabled && <Dot />}</TabsTrigger>
            <TabsTrigger value='autoroles'>Rôles automatiques</TabsTrigger>
          </TabsList>
          {manage && (
            <Button className='ms-auto' onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              <Save /> {dirty ? 'Enregistrer' : 'Enregistré'}
            </Button>
          )}
        </div>

        <TabsContent value='welcome' className='mt-4 grid gap-4'>
          <MessageSection
            title='Message de bienvenue' kind='welcome' section={config.welcome} channels={data.channels} fonts={data.fonts} disabled={!manage}
            onChange={(value) => set('welcome', value)} renderPreview={renderPreview} onTest={() => test.mutate('welcome')} testing={test.isPending} dirty={dirty}
          />
          <Section title='Message privé de bienvenue' actions={<Switch checked={config.welcome.dm.enabled} disabled={!manage} onCheckedChange={(v) => set('welcome', { dm: { ...config.welcome.dm, enabled: v } })} aria-label='Activer le message privé' />}>
            {config.welcome.dm.enabled && (
              <div className='p-4'>
                <PayloadEditor idPrefix='wdm' payload={config.welcome.dm.payload} disabled={!manage} onChange={(payload) => set('welcome', { dm: { ...config.welcome.dm, payload } })} />
              </div>
            )}
          </Section>
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox checked={config.welcome.includeBots} disabled={!manage} onCheckedChange={(v) => set('welcome', { includeBots: v === true })} />
            Souhaiter aussi la bienvenue aux bots
          </label>
        </TabsContent>

        <TabsContent value='leave' className='mt-4 grid gap-4'>
          <MessageSection
            title='Message de départ' kind='leave' section={config.leave} channels={data.channels} fonts={data.fonts} disabled={!manage}
            onChange={(value) => set('leave', value)} renderPreview={renderPreview} onTest={() => test.mutate('leave')} testing={test.isPending} dirty={dirty}
          />
        </TabsContent>

        <TabsContent value='boost' className='mt-4 grid gap-4'>
          <MessageSection
            title='Message de boost' kind='boost' section={config.boost} channels={data.channels} fonts={data.fonts} disabled={!manage}
            onChange={(value) => set('boost', value)} renderPreview={renderPreview} onTest={() => test.mutate('boost')} testing={test.isPending} dirty={dirty}
          />
          <Section title='Pendant le boost'>
            <div className='grid gap-4 p-4'>
              <div className='grid gap-1.5'>
                <Label>Rôles bonus (retirés à la fin du boost)</Label>
                <RolesPicker roles={data.roles} value={config.boost.bonusRoleIds} disabled={!manage} onChange={(ids) => set('boost', { bonusRoleIds: ids })} label='Rôles bonus' />
              </div>
              <label className='flex items-center gap-2 text-sm'>
                <Switch checked={config.boost.dm.enabled} disabled={!manage} onCheckedChange={(v) => set('boost', { dm: { ...config.boost.dm, enabled: v } })} />
                Remercier en message privé
              </label>
              {config.boost.dm.enabled && <PayloadEditor idPrefix='bdm' payload={config.boost.dm.payload} disabled={!manage} onChange={(payload) => set('boost', { dm: { ...config.boost.dm, payload } })} />}
              <label className='flex items-center gap-2 text-sm'>
                <Switch checked={config.boost.end.enabled} disabled={!manage} onCheckedChange={(v) => set('boost', { end: { ...config.boost.end, enabled: v } })} />
                Message quand le boost s’arrête (même salon)
              </label>
              {config.boost.end.enabled && <PayloadEditor idPrefix='bend' payload={config.boost.end.payload} disabled={!manage} onChange={(payload) => set('boost', { end: { ...config.boost.end, payload } })} />}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value='rules' className='mt-4 grid gap-4'>
          <Section
            title='Règlement à accepter'
            description='Le règlement est posté avec un bouton. Le clic donne les rôles « validé » : cache les salons à @everyone et ouvre-les à ce rôle pour que seuls les membres qui ont accepté voient le serveur.'
            actions={
              <div className='flex items-center gap-3'>
                {config.rules.messageId ? <Pill tone='success'>Publié</Pill> : <Pill tone='warning'>Pas encore publié</Pill>}
                {manage && (
                  <Button size='sm' onClick={() => publishRules.mutate()} disabled={!config.rules.channelId || publishRules.isPending}>
                    <Send /> {config.rules.messageId ? 'Mettre à jour' : 'Publier'}
                  </Button>
                )}
              </div>
            }
          >
            <div className='grid gap-4 p-4'>
              <label className='flex items-center gap-2 text-sm font-medium'>
                <Switch checked={config.rules.enabled} disabled={!manage} onCheckedChange={(v) => set('rules', { enabled: v })} />
                Bouton d’acceptation
              </label>
              <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label>Salon</Label>
                  <ChannelSelect channels={data.channels} value={config.rules.channelId} disabled={!manage} onChange={(v) => set('rules', { channelId: v, messageId: v === config.rules.channelId ? config.rules.messageId : null })} label='Salon du règlement' />
                </div>
                <div className='grid grid-cols-[auto_minmax(0,1fr)_8rem] gap-2'>
                  <div className='grid gap-1.5'>
                    <Label htmlFor='r-emoji'>Émoji</Label>
                    <EmojiField id='r-emoji' value={config.rules.buttonEmoji} disabled={!manage} onChange={(v) => set('rules', { buttonEmoji: v })} />
                  </div>
                  <div className='grid gap-1.5'>
                    <Label htmlFor='r-label'>Texte du bouton</Label>
                    <Input id='r-label' value={config.rules.buttonLabel} maxLength={80} disabled={!manage} onChange={(e) => set('rules', { buttonLabel: e.target.value })} />
                  </div>
                  <div className='grid gap-1.5'>
                    <Label>Couleur</Label>
                    <ButtonStylePicker value={config.rules.buttonStyle} disabled={!manage} text={config.rules.buttonLabel || undefined} onChange={(v) => set('rules', { buttonStyle: v })} />
                  </div>
                </div>
                <div className='grid gap-1.5'>
                  <Label>Rôles donnés à l’acceptation</Label>
                  <RolesPicker roles={data.roles} value={config.rules.acceptRoleIds} disabled={!manage} onChange={(ids) => set('rules', { acceptRoleIds: ids })} label='Rôles donnés' />
                </div>
                <div className='grid gap-1.5'>
                  <Label>Rôles retirés à l’acceptation</Label>
                  <RolesPicker roles={data.roles} value={config.rules.removeRoleIds} disabled={!manage} onChange={(ids) => set('rules', { removeRoleIds: ids })} placeholder='Aucun (ex. « Non vérifié »)' label='Rôles retirés' />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='r-age'>Âge minimum du compte Discord (jours)</Label>
                  <Input id='r-age' type='number' min={0} max={3650} value={config.rules.minAccountAgeDays} disabled={!manage} onChange={(e) => set('rules', { minAccountAgeDays: Number(e.target.value) || 0 })} className='w-32' />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='r-ok'>Réponse après acceptation</Label>
                  <Input id='r-ok' value={config.rules.acceptedMessage} maxLength={500} disabled={!manage} onChange={(e) => set('rules', { acceptedMessage: e.target.value })} />
                </div>
              </div>
              <label className='flex items-center gap-2 text-sm'>
                <Checkbox checked={config.rules.autorolesOnAccept} disabled={!manage} onCheckedChange={(v) => set('rules', { autorolesOnAccept: v === true })} />
                Donner les rôles automatiques seulement après l’acceptation
              </label>
              <PayloadEditor idPrefix='rules' payload={config.rules.payload} disabled={!manage} onChange={(payload) => set('rules', { payload })} withPreview />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value='autoroles' className='mt-4'>
          <Section title='Rôles automatiques' description='Donnés à chaque arrivée. Si le règlement est à accepter, les rôles des membres peuvent attendre l’acceptation (onglet Règlement).'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label>Membres</Label>
                <RolesPicker roles={data.roles} value={config.autoroles.humanRoleIds} disabled={!manage} onChange={(ids) => set('autoroles', { humanRoleIds: ids })} label='Rôles des membres' />
              </div>
              <div className='grid gap-1.5'>
                <Label>Bots</Label>
                <RolesPicker roles={data.roles} value={config.autoroles.botRoleIds} disabled={!manage} onChange={(ids) => set('autoroles', { botRoleIds: ids })} label='Rôles des bots' />
              </div>
            </div>
          </Section>
        </TabsContent>
      </Tabs>
      {manage && dirty && (
        <div className='sticky bottom-4 z-10 flex animate-in items-center gap-3 rounded-lg border border-primary/40 bg-card/95 p-3 shadow-lg backdrop-blur fade-in-0 slide-in-from-bottom-2'>
          <span className='text-sm'>Des changements ne sont pas enregistrés.</span>
          <Button variant='ghost' className='ms-auto' onClick={() => setConfig(data.config)}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}><Save /> Enregistrer</Button>
        </div>
      )}
    </div>
  )
}

function Dot() {
  return <span aria-label='activé' className='ms-1 inline-block size-1.5 rounded-full bg-success' />
}

function PayloadEditor({ payload, onChange, disabled, idPrefix, withPreview = false }: {
  payload: MessagePayload
  onChange: (p: MessagePayload) => void
  disabled: boolean
  idPrefix: string
  withPreview?: boolean
}) {
  const embed = { ...EMPTY_EMBED, ...payload.embed }
  const box = useRef<HTMLDivElement>(null)
  const editor = (
    <div className='grid gap-3' ref={box}>
      <div className='grid gap-1.5'>
        <Label htmlFor={`${idPrefix}-content`}>Texte</Label>
        <Textarea id={`${idPrefix}-content`} rows={2} maxLength={2000} value={payload.content} disabled={disabled} onChange={(e) => onChange({ ...payload, content: e.target.value })} />
        <div className='flex flex-wrap items-center gap-2'>
          <VariableButton container={box} extra={WELCOME_VARIABLES} disabled={disabled} />
          <span className='text-xs text-muted-foreground'>Insérée dans le dernier champ cliqué (texte, titre, champs de l’embed…).</span>
        </div>
      </div>
      <label className='flex items-center gap-2 text-sm font-medium'>
        <Switch checked={embed.enabled} disabled={disabled} onCheckedChange={(v) => onChange({ ...payload, embed: { ...embed, enabled: v } })} /> Embed
      </label>
      {embed.enabled && <EmbedFields idPrefix={idPrefix} embed={embed} disabled={disabled} onChange={(patch) => onChange({ ...payload, embed: { ...embed, ...patch } })} />}
    </div>
  )
  if (!withPreview) return editor
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]'>
      {editor}
      <div className='xl:sticky xl:top-20 xl:self-start'><DiscordPreview content={payload.content} embed={embed} roles={new Map()} /></div>
    </div>
  )
}

function MessageSection({ title, kind, section, channels, fonts, disabled, onChange, renderPreview, onTest, testing, dirty }: {
  title: string
  kind: 'welcome' | 'leave' | 'boost'
  section: OnboardingSection
  channels: OnboardingPayload['channels']
  fonts: string[]
  disabled: boolean
  onChange: (value: Partial<OnboardingSection>) => void
  renderPreview: (design: CardDesign) => Promise<Blob>
  onTest: () => void
  testing: boolean
  dirty: boolean
}) {
  const embed = { ...EMPTY_EMBED, ...section.payload.embed }
  return (
    <>
      <Section
        title={title}
        actions={
          <div className='flex items-center gap-3'>
            {!disabled && section.enabled && section.channelId && (
              <Button size='sm' variant='outline' onClick={onTest} disabled={testing || dirty} title={dirty ? 'Enregistre d’abord' : undefined}>
                <Rocket /> Tester
              </Button>
            )}
            <Switch checked={section.enabled} disabled={disabled} onCheckedChange={(v) => onChange({ enabled: v })} aria-label={`Activer : ${title}`} />
          </div>
        }
      >
        {section.enabled && (
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_24rem]'>
            <div className='grid content-start gap-4'>
              <div className='grid gap-1.5 sm:max-w-sm'>
                <Label>Salon</Label>
                <ChannelSelect channels={channels} value={section.channelId} disabled={disabled} onChange={(v) => onChange({ channelId: v })} label={`Salon : ${title}`} />
              </div>
              <PayloadEditor idPrefix={kind} payload={section.payload} disabled={disabled} onChange={(payload) => onChange({ payload })} />
            </div>
            <div className='xl:sticky xl:top-20 xl:self-start'>
              <h3 className='mb-2 text-sm font-semibold'>Aperçu</h3>
              <DiscordPreview content={section.payload.content} embed={section.card.enabled && embed.enabled ? { ...embed, imageUrl: null } : embed} roles={new Map()} />
              {section.card.enabled && <p className='mt-2 text-xs text-muted-foreground'>{embed.enabled ? 'La carte image devient la grande image de l’embed.' : 'La carte image est jointe au message.'}</p>}
            </div>
          </div>
        )}
      </Section>
      {section.enabled && (
        <Section
          title='Carte image'
          description='Une image générée pour chaque membre, avec son avatar et son pseudo.'
          actions={<Switch checked={section.card.enabled} disabled={disabled} onCheckedChange={(v) => onChange({ card: { ...section.card, enabled: v } })} aria-label='Activer la carte image' />}
        >
          {section.card.enabled && (
            <div className='p-4'>
              <CardEditor design={section.card.design} fonts={fonts} renderPreview={renderPreview} onChange={(design) => onChange({ card: { ...section.card, design } })} />
            </div>
          )}
        </Section>
      )}
    </>
  )
}
