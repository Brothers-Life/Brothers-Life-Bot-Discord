import { cn } from '@/lib/utils'

// The server logo (BL at sunset), glowing softly as on the loading screen
export function BrandMark({ className, still = false }: { className?: string; still?: boolean }) {
  return <img src='/brand/logo.png' alt='' width={96} height={96} draggable={false} className={cn('size-8 select-none object-contain', !still && 'logo-breathe', className)} />
}
