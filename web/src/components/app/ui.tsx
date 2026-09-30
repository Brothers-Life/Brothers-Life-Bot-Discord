import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

// Page frame: sticky header with the title, then the content
export function Page({
  title,
  description,
  actions,
  children,
  fixed,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  fixed?: boolean
}) {
  return (
    <>
      <Header fixed>
        <h1 className='truncate text-base font-semibold tracking-tight'>{title}</h1>
      </Header>
      <Main fixed={fixed} className='flex flex-col gap-6'>
        {(description || actions) && (
          <div className='flex flex-wrap items-end justify-between gap-4'>
            {description && <p className='max-w-2xl text-sm text-muted-foreground'>{description}</p>}
            {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
          </div>
        )}
        {children}
      </Main>
    </>
  )
}

export function Section({ title, description, actions, children, className }: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      <div className='flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3'>
        <div>
          <h2 className='text-sm font-semibold'>{title}</h2>
          {description && <p className='mt-0.5 text-sm text-muted-foreground'>{description}</p>}
        </div>
        {actions}
      </div>
      <div>{children}</div>
    </section>
  )
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className='flex flex-col items-center gap-2 px-6 py-12 text-center'>
      <p className='font-medium'>{title}</p>
      {children && <div className='max-w-md text-sm text-muted-foreground'>{children}</div>}
    </div>
  )
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/12 text-destructive',
  accent: 'bg-primary/15 text-primary',
}

export function Pill({ tone = 'neutral', children, className, style }: { tone?: Tone; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span style={style} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const color = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', neutral: 'bg-muted-foreground' }[tone]
  return <span aria-hidden className={cn('inline-block size-2 rounded-full', color)} />
}

export function UserAvatar({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  return (
    <Avatar className={cn('size-8 rounded-full', className)}>
      {src && <AvatarImage src={src} alt='' />}
      <AvatarFallback className='text-xs'>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

export function GuildIcon({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3)
  return (
    <Avatar className={cn('size-9 rounded-xl', className)}>
      {src && <AvatarImage src={src} alt='' />}
      <AvatarFallback className='rounded-xl text-xs font-semibold'>{initials}</AvatarFallback>
    </Avatar>
  )
}

export function RankBadge({ name, color, className }: { name: string; color: string | null; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', className)}
      style={color ? { borderColor: `${color}66`, color } : undefined}
    >
      <span aria-hidden className='size-1.5 rounded-full' style={{ background: color ?? 'currentColor' }} />
      {name}
    </span>
  )
}
