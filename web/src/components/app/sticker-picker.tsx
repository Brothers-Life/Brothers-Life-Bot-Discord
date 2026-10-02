import { useState } from 'react'
import { Loader2, Sticker as StickerIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { GuildIcon } from '@/components/app/ui'
import { useServerEmojis, type Sticker } from '@/components/app/emoji-picker'

const LOTTIE = 3

export function stickerUrl(s: Pick<Sticker, 'id' | 'format'>, size = 160) {
  return `https://media.discordapp.net/stickers/${s.id}.${s.format === 4 ? 'gif' : 'png'}?size=${size}`
}

// Picture of a sticker; Lottie stickers (animated vectors) cannot be drawn here, their name is shown
export function StickerImage({ sticker, className }: { sticker: Sticker; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (sticker.format === LOTTIE || broken) {
    return <span className={cn('grid place-items-center rounded-md bg-muted p-1 text-center text-[10px] leading-tight text-muted-foreground', className)}>{sticker.name}</span>
  }
  return <img src={stickerUrl(sticker)} alt={sticker.name} title={sticker.name} loading='lazy' onError={() => setBroken(true)} className={cn('object-contain', className)} />
}

// Up to `max` stickers of the network servers; Discord only sends those of the server where the message goes
export function StickerPicker({ value, onChange, max = 3, disabled, guildId }: {
  value: string[]
  onChange: (ids: string[]) => void
  max?: number
  disabled?: boolean
  guildId?: string
}) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useServerEmojis()
  const guilds = (data?.guilds ?? []).filter((g) => g.stickers?.length)
  const all = guilds.flatMap((g) => g.stickers.map((s) => ({ ...s, guildId: g.id })))
  const chosen = value.map((id) => all.find((s) => s.id === id)).filter((s): s is (typeof all)[number] => Boolean(s))
  const foreign = guildId ? chosen.filter((s) => s.guildId !== guildId) : []
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].slice(0, max))

  return (
    <div className='grid gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        {chosen.map((s) => (
          <span key={s.id} className='relative'>
            <StickerImage sticker={s} className='size-16' />
            {!disabled && (
              <button type='button' aria-label={`Retirer l’autocollant ${s.name}`} onClick={() => toggle(s.id)}
                className='absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-destructive text-white'>
                <X className='size-3' />
              </button>
            )}
          </span>
        ))}
        {!disabled && value.length < max && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type='button' variant='outline' size='sm'><StickerIcon /> Autocollant</Button>
            </PopoverTrigger>
            <PopoverContent align='start' className='max-h-96 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-2'>
              {isLoading && <div className='grid place-items-center p-6 text-muted-foreground'><Loader2 className='size-5 animate-spin' /></div>}
              {!isLoading && !guilds.length && <p className='p-3 text-sm text-muted-foreground'>Aucun autocollant sur les serveurs du réseau.</p>}
              {guilds.map((g) => (
                <section key={g.id} className='pb-2'>
                  <h3 className='flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
                    <GuildIcon src={g.icon} name={g.name} className='size-4 rounded' /> {g.name}
                  </h3>
                  <div className='grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1'>
                    {g.stickers.map((s) => (
                      <button key={s.id} type='button' title={s.description || s.name} aria-label={s.name} aria-pressed={value.includes(s.id)}
                        onClick={() => { toggle(s.id); setOpen(false) }}
                        className={cn('grid aspect-square place-items-center rounded-md p-1 hover:bg-accent', value.includes(s.id) && 'bg-accent ring-2 ring-primary')}>
                        <StickerImage sticker={s} className='size-full' />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {foreign.length > 0 && <p className='text-xs text-warning'>Autocollant d’un autre serveur que celui choisi pour poster : Discord le refusera.</p>}
    </div>
  )
}
