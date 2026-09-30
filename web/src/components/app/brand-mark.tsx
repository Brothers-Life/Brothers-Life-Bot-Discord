import { cn } from '@/lib/utils'

// Staff badge: a shield with a check, in the brass accent
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 32 32' aria-hidden className={cn('text-primary', className)}>
      <rect width='32' height='32' rx='8' className='fill-sidebar-accent' />
      <path
        d='M16 5l9 3.5v7.2c0 5.4-3.8 9.6-9 11.3-5.2-1.7-9-5.9-9-11.3V8.5z'
        fill='none'
        stroke='currentColor'
        strokeWidth='2.2'
        strokeLinejoin='round'
      />
      <path d='M12 16.2l3 3 5.2-6' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}
