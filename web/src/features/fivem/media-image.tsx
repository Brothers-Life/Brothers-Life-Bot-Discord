import { useState } from 'react'
import { Car, Package, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { gameAssetUrl, type MediaConfig } from './media'

export function GameAssetImage({ config, type, name, className }: {
  config: MediaConfig | undefined
  type: 'item' | 'vehicle'
  name: string | null | undefined
  className?: string
}) {
  const src = gameAssetUrl(config, type, name)
  return <MediaThumbnail src={src} alt='' icon={type === 'item' ? Package : Car} className={className} />
}

export function MediaThumbnail({ src, alt, icon: Icon = Package, className }: {
  src: string | null
  alt: string
  icon?: LucideIcon
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40 text-muted-foreground', className)}>
      <Icon className='size-5' aria-hidden />
      {src && !failed && <img src={src} alt={alt} loading='lazy' className='absolute inset-0 size-full object-contain p-1' onError={() => setFailed(true)} />}
    </span>
  )
}
