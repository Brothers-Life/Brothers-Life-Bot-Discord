import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Loader2, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/app/confirm'
import { ColorPicker } from '@/components/app/color-picker'
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

type EditedServer = { id: number; name: string; config: { color: string; image: StatusImage } }

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

export function StatusImageDialog({ server, onClose }: { server: EditedServer; onClose: () => void }) {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [image, setImage] = useState<StatusImage>(server.config.image)
  const [color, setColor] = useState(server.config.color)
  const set = (patch: Partial<StatusImage>) => setImage((current) => ({ ...current, ...patch }))
  const setStat = (key: keyof StatusImage['stats'], value: boolean) => setImage((current) => ({ ...current, stats: { ...current.stats, [key]: value } }))
  const body = JSON.stringify({ image, color })
  const preview = usePreview(server.id, body)
  const dirty = body !== JSON.stringify({ image: server.config.image, color: server.config.color })
  const missing = (image.background === 'custom' && !image.backgroundImage) || (image.logo === 'custom' && !image.logoImage)

  const save = useMutation({
    mutationFn: () => api(`/fivem/${server.id}`, { method: 'PUT', body: { config: { image, color } } }),
    onSuccess: () => {
      toast.success(image.enabled ? 'Image enregistrée : les messages de statut sont déjà à jour' : 'Image désactivée : les messages reprennent l’embed classique')
      void qc.invalidateQueries({ queryKey: ['fivem'] })
      onClose()
    },
  })
  const close = async () => {
    if (!dirty || await confirm({ title: 'Abandonner les changements ?', desc: 'L’image garde ses réglages enregistrés.', confirmText: 'Abandonner', destructive: true })) onClose()
  }
  const reset = async () => {
    if (await confirm({ title: 'Revenir aux réglages par défaut ?', desc: 'Fond, logo, blocs et couleur reprennent leur valeur d’origine. Rien n’est enregistré tant que tu ne cliques pas sur Enregistrer.', confirmText: 'Réinitialiser' })) {
      setImage({ ...DEFAULT_STATUS_IMAGE, enabled: image.enabled })
      setColor('#ff9628')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle>Image de statut : {server.name}</DialogTitle>
          <DialogDescription>L’image part au-dessus de l’embed dans chaque message de statut et se met à jour toutes les minutes.</DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]'>
          <div className='grid content-start gap-2 lg:sticky lg:top-0 lg:order-2'>
            <div className='relative overflow-hidden rounded-lg border bg-muted/40'>
              {preview.url
                ? <img src={preview.url} alt={`Aperçu de l’image de statut de ${server.name}`} className={cn('block w-full transition-opacity', !image.enabled && 'opacity-40')} />
                : <div className='flex aspect-[2/1] items-center justify-center text-sm text-muted-foreground'><ImageIcon className='me-2 size-4' /> Rendu en cours…</div>}
              {preview.loading && preview.url && <Loader2 className='absolute end-3 top-3 size-5 animate-spin text-white drop-shadow' aria-label='Rendu en cours' />}
            </div>
            {preview.error && <p className='text-sm text-destructive'>{preview.error}</p>}
            <p className='text-xs text-muted-foreground'>
              {image.enabled ? 'Rendu réel, avec les joueurs et la courbe actuels du serveur.' : 'Image désactivée : les messages gardent l’embed classique (statut et joueurs en texte).'}
            </p>
          </div>

          <div className='grid grid-cols-[minmax(0,1fr)] content-start gap-4'>
            <Toggle label='Image activée' hint='Désactivée, les messages de statut reprennent l’embed classique.' checked={image.enabled} onChange={(enabled) => set({ enabled })} />

            <Block title='Texte'>
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
          </div>
        </div>

        <DialogFooter className='gap-2 sm:justify-between'>
          <Button variant='ghost' onClick={() => void reset()}><RotateCcw /> Réglages par défaut</Button>
          <div className='flex flex-wrap justify-end gap-2'>
            <Button variant='outline' onClick={() => void close()}>Annuler</Button>
            <Button loading={save.isPending} disabled={!dirty || missing} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
          </div>
        </DialogFooter>
        {missing && <p className='text-end text-xs text-muted-foreground'>Choisis ton image, ou une autre option, pour enregistrer.</p>}
        {dialog}
      </DialogContent>
    </Dialog>
  )
}
