import { useRef, useState } from 'react'
import { ImageUp, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { imageUrl, uploadImage } from '@/features/uploads/upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Picks an image on the computer and sends it to the panel; gives back "upload:<id>"
export function UploadButton({ onUploaded, label = 'Envoyer une image', iconOnly = false, disabled }: {
  onUploaded: (src: string) => void
  label?: string
  iconOnly?: boolean
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <input
        ref={input} type='file' accept='image/png,image/jpeg,image/webp,image/gif' className='hidden'
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            onUploaded(await uploadImage(file))
            toast.success('Image envoyée')
          }
          catch (error) {
            toast.error(error instanceof Error ? error.message : 'Envoi impossible')
          }
          finally {
            setBusy(false)
          }
        }}
      />
      <Button type='button' size={iconOnly ? 'icon' : 'sm'} variant='outline' onClick={() => input.current?.click()} disabled={busy || disabled} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
        {busy ? <Loader2 className='animate-spin' /> : iconOnly ? <ImageUp /> : <Upload />}{!iconOnly && ` ${label}`}
      </Button>
    </>
  )
}

// Image field: an https address, or an image sent from the computer (shown as a small preview)
export function ImageInput({ id, value, onChange, disabled, uploads = true, className }: {
  id?: string
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  uploads?: boolean
  className?: string
}) {
  const uploaded = value?.startsWith('upload:')
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {value && <img src={imageUrl(value) ?? undefined} alt='' className='size-9 shrink-0 rounded border object-cover' />}
      {uploaded
        ? <span id={id} className='flex h-9 min-w-0 flex-1 items-center truncate rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground'>Image envoyée</span>
        : <Input id={id} value={value ?? ''} placeholder='https://…' disabled={disabled} onChange={(ev) => onChange(ev.target.value || null)} className='min-w-0 flex-1' />}
      {uploads && !disabled && <UploadButton iconOnly onUploaded={onChange} label='Envoyer une image depuis l’ordinateur' />}
      {value && !disabled && <Button type='button' size='icon' variant='ghost' aria-label='Retirer l’image' onClick={() => onChange(null)}><X /></Button>}
    </div>
  )
}
