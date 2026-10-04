import { Plus, SmilePlus, X } from 'lucide-react'
import type { AnnouncementOptions } from '@/lib/types'
import { imageUrl } from '@/features/uploads/upload'
import { ImageInput, UploadButton } from '@/features/uploads/image-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { EmojiField, EmojiPicker, EmojiView } from '@/components/app/emoji-picker'

export const EMPTY_OPTIONS: AnnouncementOptions = { autoDeleteHours: 0, pin: false, thread: { enabled: false, name: '' }, reactions: [], buttons: [], gallery: [], attachments: [] }

// Empty gallery slots and half-filled buttons are dropped before saving
export function cleanOptions(o: AnnouncementOptions): AnnouncementOptions {
  return { ...o, gallery: o.gallery.filter(Boolean), buttons: o.buttons.filter((b) => b.label.trim() || b.url.trim()).map((b) => ({ ...b, emoji: b.emoji || null })) }
}

export function OptionsEditor({ value: o, onChange, disabled }: { value: AnnouncementOptions; onChange: (o: AnnouncementOptions) => void; disabled?: boolean }) {
  const set = (patch: Partial<AnnouncementOptions>) => onChange({ ...o, ...patch })
  const addReaction = (r: string) => {
    if (r && !o.reactions.includes(r) && o.reactions.length < 10) set({ reactions: [...o.reactions, r] })
  }
  return (
    <div className='grid gap-6'>
      <div className='grid gap-2'>
        <Label>Galerie <span className='font-normal text-muted-foreground'>(jusqu’à 3 images affichées avec la grande image de l’embed)</span></Label>
        {o.gallery.map((src, i) => (
          <ImageInput key={i} value={src} disabled={disabled} onChange={(v) => set({ gallery: v ? o.gallery.map((x, j) => (j === i ? v : x)) : o.gallery.filter((_, j) => j !== i) })} />
        ))}
        {!disabled && o.gallery.length < 3 && (
          <Button type='button' variant='outline' size='sm' className='justify-self-start' onClick={() => set({ gallery: [...o.gallery, ''] })}><Plus /> Image de galerie</Button>
        )}
      </div>

      <div className='grid gap-2'>
        <Label>Images en pièce jointe <span className='font-normal text-muted-foreground'>(affichées sous le message)</span></Label>
        <div className='flex flex-wrap items-center gap-2'>
          {o.attachments.map((src, i) => (
            <span key={src + i} className='relative'>
              <img src={imageUrl(src) ?? undefined} alt='' className='size-16 rounded border object-cover' />
              {!disabled && (
                <button type='button' aria-label='Retirer la pièce jointe' className='absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-destructive text-white' onClick={() => set({ attachments: o.attachments.filter((_, j) => j !== i) })}>
                  <X className='size-3' />
                </button>
              )}
            </span>
          ))}
          {!disabled && o.attachments.length < 10 && <UploadButton onUploaded={(src) => set({ attachments: [...o.attachments, src] })} label='Ajouter une image' />}
        </div>
      </div>

      <div className='grid gap-2'>
        <Label>Boutons liens <span className='font-normal text-muted-foreground'>({o.buttons.length}/5)</span></Label>
        {o.buttons.map((b, i) => {
          const patch = (p: Partial<typeof b>) => set({ buttons: o.buttons.map((x, j) => (j === i ? { ...x, ...p } : x)) })
          return (
            <div key={i} className='grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 sm:grid-cols-[auto_1fr_1.5fr_auto]'>
              <EmojiField value={b.emoji} placeholder='🔗' label={`Émoji du bouton ${i + 1}`} disabled={disabled} onChange={(v) => patch({ emoji: v })} />
              <Input value={b.label} maxLength={80} placeholder='Texte' aria-label={`Texte du bouton ${i + 1}`} disabled={disabled} onChange={(e) => patch({ label: e.target.value })} />
              <Input value={b.url} placeholder='https://…' aria-label={`Lien du bouton ${i + 1}`} className='col-span-2 sm:col-span-1' disabled={disabled} onChange={(e) => patch({ url: e.target.value })} />
              <Button type='button' size='icon' variant='ghost' aria-label={`Supprimer le bouton ${i + 1}`} disabled={disabled} onClick={() => set({ buttons: o.buttons.filter((_, j) => j !== i) })}><X /></Button>
            </div>
          )
        })}
        {!disabled && o.buttons.length < 5 && (
          <Button type='button' variant='outline' size='sm' className='justify-self-start' onClick={() => set({ buttons: [...o.buttons, { label: '', url: '', emoji: null }] })}><Plus /> Bouton</Button>
        )}
      </div>

      <div className='grid gap-2'>
        <Label>Réactions ajoutées par le bot</Label>
        <div className='flex flex-wrap items-center gap-2'>
          {o.reactions.map((r) => (
            <span key={r} className='flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm'>
              <EmojiView value={r} />
              {!disabled && <button type='button' aria-label={`Retirer ${r}`} onClick={() => set({ reactions: o.reactions.filter((x) => x !== r) })}><X className='size-3' /></button>}
            </span>
          ))}
          {!disabled && o.reactions.length < 10 && (
            <EmojiPicker onSelect={addReaction}>
              <Button type='button' variant='outline' size='sm'><SmilePlus /> Ajouter une réaction</Button>
            </EmojiPicker>
          )}
        </div>
      </div>

      <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
        <label className='flex items-center gap-2 text-sm'><Switch checked={o.pin} disabled={disabled} onCheckedChange={(v) => set({ pin: v })} /> Épingler le message</label>
        <label className='flex items-center gap-2 text-sm'><Switch checked={o.thread.enabled} disabled={disabled} onCheckedChange={(v) => set({ thread: { ...o.thread, enabled: v } })} /> Ouvrir un fil de discussion</label>
        {o.thread.enabled && (
          <div className='grid gap-1.5 sm:col-span-2'>
            <Label htmlFor='opt-thread'>Nom du fil</Label>
            <Input id='opt-thread' value={o.thread.name} maxLength={100} placeholder='Titre de l’embed par défaut' disabled={disabled} onChange={(e) => set({ thread: { ...o.thread, name: e.target.value } })} />
          </div>
        )}
        <div className='grid gap-1.5'>
          <Label htmlFor='opt-delete'>Supprimer automatiquement après (heures)</Label>
          <Input id='opt-delete' type='number' min={0} max={720} value={o.autoDeleteHours} disabled={disabled} onChange={(e) => set({ autoDeleteHours: Math.max(0, Math.min(720, Number(e.target.value) || 0)) })} />
          <span className='text-xs text-muted-foreground'>0 = jamais</span>
        </div>
      </div>
    </div>
  )
}
