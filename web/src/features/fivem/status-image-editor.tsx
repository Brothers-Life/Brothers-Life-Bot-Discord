import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Loader2, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn, typeInto } from '@/lib/utils'
import { useConfirm } from '@/components/app/confirm'
import { ColorPicker } from '@/components/app/color-picker'
import { VariablePicker, type VariableGroup } from '@/components/app/variable-picker'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ImageInput } from '@/features/uploads/image-input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export type StatusImage = {
  enabled: boolean
  title: string
  background: 'road' | 'car' | 'heli' | 'custom' | 'none'
  backgroundImage: string | null
  darkness: number
  logo: 'brand' | 'custom' | 'none'
  logoImage: string | null
  brackets: boolean
  since: boolean
  stats: { ping: boolean; peak: boolean; fill: boolean }
  gauge: boolean
  chart: boolean
  chartHours: number
}

// Same defaults as the bot (src/core/fivem/statusCard.js)
export const DEFAULT_STATUS_IMAGE: StatusImage = {
  enabled: true, title: '', background: 'road', backgroundImage: null, darkness: 80, logo: 'brand', logoImage: null,
  brackets: true, since: true, stats: { ping: true, peak: true, fill: true }, gauge: true, chart: true, chartHours: 6,
}

const BACKGROUNDS: { value: StatusImage['background']; label: string; thumb?: string }[] = [
  { value: 'road', label: 'Route', thumb: '/brand/sunset-road.webp' },
  { value: 'car', label: 'Voiture', thumb: '/brand/sunset-car.webp' },
  { value: 'heli', label: 'Hélico', thumb: '/brand/sunset-heli.webp' },
  { value: 'custom', label: 'Ton image' },
  { value: 'none', label: 'Uni' },
]
const HOURS = [1, 3, 6, 12, 24]

export type StatusEmbed = {
  enabled: boolean; title: string; description: string; fields: boolean; footer: boolean; thumbnail: boolean; button: boolean; buttonLabel: string
}

// Same defaults as the bot (src/core/fivem/statusEmbed.js)
export const DEFAULT_STATUS_EMBED: StatusEmbed = {
  enabled: true, title: '🎮 {name}', description: '', fields: true, footer: true, thumbnail: true, button: true, buttonLabel: 'Se connecter',
}

const VARIABLES: VariableGroup[] = [{
  title: 'Serveur FiveM',
  items: [
    { key: 'name', label: 'Nom du serveur' },
    { key: 'players', label: 'Joueurs connectés' },
    { key: 'max', label: 'Places du serveur' },
    { key: 'status', label: 'État (En ligne, Hors ligne…)' },
  ],
}]

type LiveStatus = { online: boolean; players: number; max: number; hostname: string | null; list: { id: number; name: string; ping: number | null }[] }
type EditedServer = {
  id: number; name: string; joinCode: string | null; status: LiveStatus | null
  config: { color: string; showPlayers: boolean; image: StatusImage; embed: StatusEmbed }
}

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{([a-z.]+)\}/gi, (match, key: string) => (vars[key] !== undefined ? String(vars[key]) : match))

// Close to what Discord shows, from the same settings the bot uses (src/bot/fivemUi.js)
function EmbedMock({ server, embed, color, withImage, showPlayers }: { server: EditedServer; embed: StatusEmbed; color: string; withImage: boolean; showPlayers: boolean }) {
  const st = server.status
  const online = Boolean(st?.online)
  const vars = { name: server.name, players: online && st ? st.players : 0, max: st?.max ?? 0, status: !st ? 'Vérification' : online ? 'En ligne' : 'Hors ligne' }
  const description = embed.description
    ? fill(embed.description, vars)
    : online && st?.hostname && st.hostname !== server.name ? st.hostname : st && !online ? 'Le serveur ne répond pas pour le moment.' : ''
  const players = online && showPlayers && st ? st.list : null
  const pings = st?.list.map((p) => p.ping).filter((p): p is number => typeof p === 'number') ?? []
  const ping = online && pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null
  return (
    <div className='grid gap-2 rounded border-s-4 bg-[#2b2d31] p-3 text-[13px] leading-snug text-[#dbdee1]' style={{ borderInlineStartColor: online ? color : '#ed4245' }}>
      <div className='flex gap-3'>
        <div className='grid min-w-0 flex-1 content-start gap-1'>
          <p className='font-semibold break-words text-white'>{fill(embed.title, vars)}</p>
          {description && <p className='break-words whitespace-pre-wrap'>{description}</p>}
        </div>
        {embed.thumbnail && !withImage && <span className='size-12 shrink-0 rounded-md bg-white/10' title='Logo du serveur Discord' />}
      </div>
      {!withImage && embed.fields && (
        <div className='grid grid-cols-3 gap-2'>
          <div><p className='font-semibold text-white'>📡 Statut</p><p>{!st ? '⏳ Vérification…' : online ? '🟢 En ligne' : '🔴 Hors ligne'}</p></div>
          <div><p className='font-semibold text-white'>👥 Joueurs</p><p>{online && st ? `${st.players} / ${st.max}` : '—'}</p></div>
          {online && <div><p className='font-semibold text-white'>⏱️ En ligne depuis</p><p>il y a un moment</p></div>}
        </div>
      )}
      {players && (
        <div>
          <p className='font-semibold text-white'>👥 Connectés ({players.length})</p>
          {players.length
            ? <div className='grid grid-cols-3 gap-x-3 font-mono text-xs'>{players.slice(0, 30).map((p) => <span key={p.id} className='truncate'>{String(p.id).padStart(3)} {p.name}</span>)}</div>
            : <p className='italic'>Personne pour l’instant.</p>}
          {players.length > 30 && <p className='text-xs'>… et {players.length - 30} autres</p>}
        </div>
      )}
      {embed.footer && <p className='text-xs text-[#b5bac1]'>{ping === null ? 'Mis à jour' : `Ping moyen ${ping} ms · Mis à jour`} · aujourd’hui</p>}
    </div>
  )
}

function EmbedSettings({ server, embed, onChange, showPlayers, onShowPlayers, imageEnabled }: {
  server: EditedServer
  embed: StatusEmbed
  onChange: (embed: StatusEmbed) => void
  showPlayers: boolean
  onShowPlayers: (value: boolean) => void
  imageEnabled: boolean
}) {
  const titleRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const last = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const set = (patch: Partial<StatusEmbed>) => onChange({ ...embed, ...patch })
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
      <Toggle
        label='Embed activé' checked={embed.enabled} onChange={(enabled) => set({ enabled })}
        hint={imageEnabled ? 'Désactivé, le message ne garde que l’image et le bouton.' : 'L’image est désactivée : l’embed reste affiché même si tu le coupes.'}
      />
      <Block title='Textes de l’embed'>
        <div className='grid gap-1.5'>
          <Label htmlFor='se-title'>Titre</Label>
          <Input id='se-title' ref={titleRef} maxLength={200} value={embed.title} onFocus={() => { last.current = titleRef.current }} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor='se-text'>Texte</Label>
          <Textarea id='se-text' ref={textRef} rows={3} maxLength={1000} value={embed.description} placeholder='Vide : le nom affiché par le serveur FiveM' onFocus={() => { last.current = textRef.current }} onChange={(e) => set({ description: e.target.value })} />
          <span className='text-xs text-muted-foreground'>Pendant une maintenance, son annonce remplace ce texte.</span>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <VariablePicker groups={VARIABLES} onPick={(token) => typeInto(last.current ?? titleRef.current!, token)} />
          <span className='text-xs text-muted-foreground'>Insérée dans le dernier champ cliqué.</span>
        </div>
      </Block>
      <Block title='Ce que l’embed affiche'>
        <Toggle label='Liste des joueurs connectés' hint='En colonnes, avec leur numéro en jeu.' checked={showPlayers} onChange={onShowPlayers} />
        <Toggle label='Statut et joueurs en texte' hint={imageEnabled ? 'Seulement quand l’image est désactivée : sinon elle les montre déjà.' : 'Statut, joueurs et durée en ligne.'} checked={embed.fields} onChange={(fields) => set({ fields })} />
        <Toggle label='Logo du serveur Discord en vignette' hint='Seulement quand l’image est désactivée.' checked={embed.thumbnail} onChange={(thumbnail) => set({ thumbnail })} />
        <Toggle label='Pied de l’embed' hint='Ping moyen des joueurs et heure de la mise à jour.' checked={embed.footer} onChange={(footer) => set({ footer })} />
      </Block>
      <Block title='Bouton'>
        <Toggle
          label='Bouton « Se connecter »' checked={embed.button} onChange={(button) => set({ button })}
          hint={server.joinCode ? `Ouvre cfx.re/join/${server.joinCode}` : 'Ajoute d’abord le code cfx.re du serveur (bouton Modifier) pour qu’il apparaisse.'}
        />
        <div className='grid gap-1.5 sm:max-w-72'>
          <Label htmlFor='se-button'>Texte du bouton</Label>
          <Input id='se-button' maxLength={40} disabled={!embed.button} value={embed.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} />
        </div>
      </Block>
    </div>
  )
}

// The real picture drawn by the bot, a moment after the last change
function usePreview(serverId: number, body: string) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/fivem/${serverId}/image/preview`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'panel' },
          body,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null) as { error?: { message?: string } } | null
          throw new Error(data?.error?.message ?? 'Aperçu impossible pour le moment.')
        }
        const blob = await res.blob()
        if (cancelled) return
        if (current.current) URL.revokeObjectURL(current.current)
        current.current = URL.createObjectURL(blob)
        setUrl(current.current)
        setError(null)
      }
      catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Aperçu impossible pour le moment.')
      }
      finally {
        if (!cancelled) setLoading(false)
      }
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [serverId, body])
  useEffect(() => () => {
    if (current.current) URL.revokeObjectURL(current.current)
  }, [])
  return { url, loading, error }
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('flex items-start gap-3 text-sm', disabled && 'opacity-50')}>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className='mt-0.5' />
      <span className='grid gap-0.5'>
        <span>{label}</span>
        {hint && <span className='text-xs text-muted-foreground'>{hint}</span>}
      </span>
    </label>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className='grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border p-4'>
      <legend className='px-1 text-sm font-medium'>{title}</legend>
      {children}
    </fieldset>
  )
}

export function StatusMessageDialog({ server, onClose }: { server: EditedServer; onClose: () => void }) {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [image, setImage] = useState<StatusImage>(server.config.image)
  const [color, setColor] = useState(server.config.color)
  const [embed, setEmbed] = useState<StatusEmbed>(server.config.embed)
  const [showPlayers, setShowPlayers] = useState(server.config.showPlayers)
  const set =(patch: Partial<StatusImage>) => setImage((current) => ({ ...current, ...patch }))
  const setStat = (key: keyof StatusImage['stats'], value: boolean) => setImage((current) => ({ ...current, stats: { ...current.stats, [key]: value } }))
  const body = JSON.stringify({ image, color })
  const preview = usePreview(server.id, body)
  const all = (v: { image: StatusImage; embed: StatusEmbed; color: string; showPlayers: boolean }) => JSON.stringify(v)
  const dirty = all({ image, embed, color, showPlayers }) !== all({ image: server.config.image, embed: server.config.embed, color: server.config.color, showPlayers: server.config.showPlayers })
  const missing = (image.background === 'custom' && !image.backgroundImage) || (image.logo === 'custom' && !image.logoImage)
  const empty = !image.enabled && !embed.enabled

  const save = useMutation({
    mutationFn: () => api(`/fivem/${server.id}`, { method: 'PUT', body: { config: { image, embed, color, showPlayers } } }),
    onSuccess: () => {
      toast.success('Message de statut enregistré : il est déjà à jour sur Discord')
      void qc.invalidateQueries({ queryKey: ['fivem'] })
      onClose()
    },
  })
  const close = async () => {
    if (!dirty || await confirm({ title: 'Abandonner les changements ?', desc: 'Le message de statut garde ses réglages enregistrés.', confirmText: 'Abandonner', destructive: true })) onClose()
  }
  const reset = async () => {
    if (await confirm({ title: 'Revenir aux réglages par défaut ?', desc: 'L’image, l’embed et la couleur reprennent leur valeur d’origine. Rien n’est enregistré tant que tu ne cliques pas sur Enregistrer.', confirmText: 'Réinitialiser' })) {
      setImage(DEFAULT_STATUS_IMAGE)
      setEmbed(DEFAULT_STATUS_EMBED)
      setShowPlayers(true)
      setColor('#ff9628')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle>Message de statut : {server.name}</DialogTitle>
          <DialogDescription>L’image part au-dessus de l’embed dans chaque message de statut, mis à jour toutes les minutes. Tu peux garder les deux, ou un seul.</DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]'>
          <div className='grid content-start gap-2 lg:sticky lg:top-0 lg:order-2'>
            <p className='text-sm font-medium'>Aperçu du message</p>
            <div className='grid gap-2 rounded-lg border bg-[#313338] p-3'>
              {image.enabled && (
                <div className='relative overflow-hidden rounded-md'>
                  {preview.url
                    ? <img src={preview.url} alt={`Aperçu de l’image de statut de ${server.name}`} className='block w-full' />
                    : <div className='flex aspect-[2/1] items-center justify-center bg-black/30 text-sm text-white/70'><ImageIcon className='me-2 size-4' /> Rendu en cours…</div>}
                  {preview.loading && preview.url && <Loader2 className='absolute end-3 top-3 size-5 animate-spin text-white drop-shadow' aria-label='Rendu en cours' />}
                </div>
              )}
              {(embed.enabled || !image.enabled) && <EmbedMock server={server} embed={embed} color={color} withImage={image.enabled} showPlayers={showPlayers} />}
              {embed.button && server.joinCode && <span className='justify-self-start rounded bg-[#4e5058] px-4 py-1.5 text-sm font-medium text-white'>🎮 {embed.buttonLabel || 'Se connecter'} ↗</span>}
            </div>
            {preview.error && <p className='text-sm text-destructive'>{preview.error}</p>}
            <p className='text-xs text-muted-foreground'>L’image est le rendu réel du bot. L’embed est une simulation fidèle, avec les joueurs actuels du serveur.</p>
          </div>

          <Tabs defaultValue='image' className='grid content-start gap-4'>
            <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
              <TabsTrigger value='image'>Image</TabsTrigger>
              <TabsTrigger value='embed'>Embed</TabsTrigger>
            </TabsList>
            <TabsContent value='embed' className='mt-0'>
              <EmbedSettings server={server} embed={embed} onChange={setEmbed} showPlayers={showPlayers} onShowPlayers={setShowPlayers} imageEnabled={image.enabled} />
            </TabsContent>
            <TabsContent value='image' className='mt-0 grid grid-cols-[minmax(0,1fr)] content-start gap-4'>
            <Toggle label='Image activée' hint='Désactivée, le message ne garde que l’embed, avec le statut et les joueurs en texte.' checked={image.enabled} onChange={(enabled) => set({ enabled })} />

            <Block title='Texte de l’image'>
              <div className='grid gap-1.5'>
                <Label htmlFor='si-title'>Titre</Label>
                <Input id='si-title' maxLength={40} value={image.title} placeholder={server.name} onChange={(e) => set({ title: e.target.value })} />
                <span className='text-xs text-muted-foreground'>Vide : le nom du serveur.</span>
              </div>
              <Toggle label='Durée en ligne' hint='« depuis 3 h 12 » à côté de l’état du serveur.' checked={image.since} onChange={(since) => set({ since })} />
            </Block>

            <Block title='Fond'>
              <div className='grid grid-cols-3 gap-2 sm:grid-cols-5' role='radiogroup' aria-label='Fond de l’image'>
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b.value} type='button' role='radio' aria-checked={image.background === b.value} onClick={() => set({ background: b.value })}
                    className={cn('grid gap-1 rounded-md border p-1 text-xs transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', image.background === b.value && 'border-primary ring-1 ring-primary')}
                  >
                    {b.thumb
                      ? <img src={b.thumb} alt='' className='aspect-video w-full rounded object-cover' />
                      : <span className={cn('flex aspect-video w-full items-center justify-center rounded', b.value === 'none' ? 'bg-[#0d0907]' : 'bg-muted')}>{b.value === 'custom' && <ImageIcon className='size-4 text-muted-foreground' />}</span>}
                    <span>{b.label}</span>
                  </button>
                ))}
              </div>
              {image.background === 'custom' && (
                <div className='grid gap-1.5'>
                  <Label htmlFor='si-bg'>Ton image de fond</Label>
                  <ImageInput id='si-bg' value={image.backgroundImage} onChange={(backgroundImage) => set({ backgroundImage })} />
                  <span className='text-xs text-muted-foreground'>Format large conseillé (1200 × 600 ou plus).</span>
                </div>
              )}
              <div className='grid gap-1.5'>
                <Label htmlFor='si-dark'>Assombrissement : {image.darkness} %</Label>
                <input id='si-dark' type='range' min={30} max={100} step={5} value={image.darkness} onChange={(e) => set({ darkness: Number(e.target.value) })} className='w-full accent-[var(--primary)]' />
                <span className='text-xs text-muted-foreground'>Plus c’est sombre, plus les textes ressortent.</span>
              </div>
            </Block>

            <Block title='Logo et couleur'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label htmlFor='si-logo'>Logo</Label>
                  <Select value={image.logo} onValueChange={(logo) => set({ logo: logo as StatusImage['logo'] })}>
                    <SelectTrigger id='si-logo'><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='brand'>Logo Brothers Life</SelectItem>
                      <SelectItem value='custom'>Mon logo</SelectItem>
                      <SelectItem value='none'>Aucun</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='si-color'>Couleur</Label>
                  <ColorPicker id='si-color' value={color} onChange={setColor} />
                  <span className='text-xs text-muted-foreground'>Aussi la couleur de l’embed.</span>
                </div>
              </div>
              {image.logo === 'custom' && (
                <div className='grid gap-1.5'>
                  <Label htmlFor='si-logo-image'>Ton logo</Label>
                  <ImageInput id='si-logo-image' value={image.logoImage} onChange={(logoImage) => set({ logoImage })} />
                  <span className='text-xs text-muted-foreground'>Affiché en rond : une image carrée rend le mieux.</span>
                </div>
              )}
              <Toggle label='Coins décoratifs' hint='Les crochets aux quatre coins, comme sur le panel.' checked={image.brackets} onChange={(brackets) => set({ brackets })} />
            </Block>

            <Block title='Ce qui est affiché'>
              <div className='grid gap-3 sm:grid-cols-2'>
                <Toggle label='Ping moyen' checked={image.stats.ping} onChange={(v) => setStat('ping', v)} />
                <Toggle label='Pic de joueurs' checked={image.stats.peak} onChange={(v) => setStat('peak', v)} />
                <Toggle label='Remplissage' checked={image.stats.fill} onChange={(v) => setStat('fill', v)} />
                <Toggle label='Jauge des joueurs' checked={image.gauge} onChange={(gauge) => set({ gauge })} />
                <Toggle label='Courbe de fréquentation' checked={image.chart} onChange={(chart) => set({ chart })} />
              </div>
              <div className='grid gap-1.5 sm:max-w-60'>
                <Label htmlFor='si-hours'>Durée de la courbe et du pic</Label>
                <Select value={String(image.chartHours)} onValueChange={(v) => set({ chartHours: Number(v) })}>
                  <SelectTrigger id='si-hours'><SelectValue /></SelectTrigger>
                  <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={String(h)}>{h} heure{h > 1 ? 's' : ''}</SelectItem>)}</SelectContent>
                </Select>
                <span className='text-xs text-muted-foreground'>La courbe repart de zéro quand le bot redémarre.</span>
              </div>
            </Block>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className='gap-2 sm:justify-between'>
          <Button variant='ghost' onClick={() => void reset()}><RotateCcw /> Réglages par défaut</Button>
          <div className='flex flex-wrap justify-end gap-2'>
            <Button variant='outline' onClick={() => void close()}>Annuler</Button>
            <Button loading={save.isPending} disabled={!dirty || missing || empty} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
          </div>
        </DialogFooter>
        {missing && <p className='text-end text-xs text-muted-foreground'>Choisis ton image, ou une autre option, pour enregistrer.</p>}
        {empty && <p className='text-end text-xs text-destructive'>Garde au moins l’image ou l’embed : sinon le message serait vide.</p>}
        {dialog}
      </DialogContent>
    </Dialog>
  )
}
