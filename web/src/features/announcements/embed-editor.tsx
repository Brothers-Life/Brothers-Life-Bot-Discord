import { Plus, X } from 'lucide-react'
import type { AnnouncementEmbed } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ImageInput } from '@/features/uploads/image-input'

export const EMPTY_EMBED: AnnouncementEmbed = {
  enabled: true, title: '', url: null, description: '', color: '#d6a249', authorName: '', authorIconUrl: null,
  thumbnailUrl: null, imageUrl: null, footerText: '', footerIconUrl: null, timestamp: false, fields: [],
}

// Empty strings of optional URLs become null, as the API expects
export function cleanEmbed(e: AnnouncementEmbed): AnnouncementEmbed {
  return { ...e, url: e.url || null, authorIconUrl: e.authorIconUrl || null, thumbnailUrl: e.thumbnailUrl || null, imageUrl: e.imageUrl || null, footerIconUrl: e.footerIconUrl || null }
}

// Every field of a Discord embed; `idPrefix` keeps label/input ids unique when several editors share a page
// `uploads`: images can also be sent from the computer (announcements)
export function EmbedFields({ embed: e, onChange, disabled, idPrefix = 'e', uploads = false }: {
  embed: AnnouncementEmbed
  onChange: (patch: Partial<AnnouncementEmbed>) => void
  disabled?: boolean
  idPrefix?: string
  uploads?: boolean
}) {
  const id = (name: string) => `${idPrefix}-${name}`
  return (
    <div className='grid gap-4'>
      <div className='grid gap-4 sm:grid-cols-[1fr_8rem]'>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('title')}>Titre</Label>
          <Input id={id('title')} value={e.title} maxLength={256} disabled={disabled} onChange={(ev) => onChange({ title: ev.target.value })} />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('color')}>Couleur</Label>
          <div className='flex gap-2'>
            <Input id={id('color')} type='color' value={e.color} className='h-9 w-12 p-1' disabled={disabled} onChange={(ev) => onChange({ color: ev.target.value })} />
            <Input value={e.color} maxLength={7} disabled={disabled} onChange={(ev) => onChange({ color: ev.target.value })} aria-label='Code couleur' />
          </div>
        </div>
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor={id('url')}>Lien du titre (facultatif)</Label>
        <Input id={id('url')} value={e.url ?? ''} placeholder='https://…' disabled={disabled} onChange={(ev) => onChange({ url: ev.target.value })} />
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor={id('desc')}>Description <span className='text-muted-foreground'>({e.description.length}/4096)</span></Label>
        <Textarea id={id('desc')} rows={6} maxLength={4096} value={e.description} disabled={disabled} onChange={(ev) => onChange({ description: ev.target.value })} />
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('author')}>Auteur</Label>
          <Input id={id('author')} value={e.authorName} maxLength={256} disabled={disabled} onChange={(ev) => onChange({ authorName: ev.target.value })} placeholder='Équipe Brothers Life' />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('author-icon')}>Icône de l’auteur</Label>
          <ImageInput id={id('author-icon')} value={e.authorIconUrl} uploads={uploads} disabled={disabled} onChange={(v) => onChange({ authorIconUrl: v })} />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('thumb')}>Miniature (en haut à droite)</Label>
          <ImageInput id={id('thumb')} value={e.thumbnailUrl} uploads={uploads} disabled={disabled} onChange={(v) => onChange({ thumbnailUrl: v })} />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('image')}>Grande image</Label>
          <ImageInput id={id('image')} value={e.imageUrl} uploads={uploads} disabled={disabled} onChange={(v) => onChange({ imageUrl: v })} />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('footer')}>Pied de page</Label>
          <Input id={id('footer')} value={e.footerText} maxLength={2048} disabled={disabled} onChange={(ev) => onChange({ footerText: ev.target.value })} />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={id('footer-icon')}>Icône du pied de page</Label>
          <ImageInput id={id('footer-icon')} value={e.footerIconUrl} uploads={uploads} disabled={disabled} onChange={(v) => onChange({ footerIconUrl: v })} />
        </div>
      </div>
      <label className='flex items-center gap-2 text-sm'>
        <Checkbox checked={e.timestamp} onCheckedChange={(v) => onChange({ timestamp: v === true })} disabled={disabled} />
        Afficher la date d’envoi dans le pied de page
      </label>

      <fieldset className='grid gap-2'>
        <legend className='mb-1 text-sm font-medium'>Champs ({e.fields.length}/25)</legend>
        {e.fields.map((f, i) => (
          <div key={i} className='grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1.5fr_auto_auto] sm:items-center'>
            <Input value={f.name} maxLength={256} placeholder='Titre du champ' aria-label={`Titre du champ ${i + 1}`} disabled={disabled} onChange={(ev) => onChange({ fields: e.fields.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)) })} />
            <Input value={f.value} maxLength={1024} placeholder='Contenu' aria-label={`Contenu du champ ${i + 1}`} disabled={disabled} onChange={(ev) => onChange({ fields: e.fields.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)) })} />
            <label className='flex items-center gap-1.5 text-xs'>
              <Checkbox checked={f.inline} disabled={disabled} onCheckedChange={(v) => onChange({ fields: e.fields.map((x, j) => (j === i ? { ...x, inline: v === true } : x)) })} />
              Côte à côte
            </label>
            <Button type='button' size='icon' variant='ghost' aria-label={`Supprimer le champ ${i + 1}`} disabled={disabled} onClick={() => onChange({ fields: e.fields.filter((_, j) => j !== i) })}><X /></Button>
          </div>
        ))}
        {!disabled && e.fields.length < 25 && (
          <Button type='button' variant='outline' size='sm' className='justify-self-start' onClick={() => onChange({ fields: [...e.fields, { name: '', value: '', inline: false }] })}>
            <Plus /> Ajouter un champ
          </Button>
        )}
      </fieldset>
    </div>
  )
}
