import { AlertTriangle, CheckCircle2, Info, Inbox, OctagonAlert, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
        <span aria-hidden className='h-5 w-[3px] shrink-0 rounded-full bg-brand shadow-[0_0_10px_var(--brand)]' />
        <h1 className='truncate font-display text-lg font-semibold tracking-[0.06em] uppercase'>{title}</h1>
      </Header>
      <Main fixed={fixed} className='page-enter flex flex-col gap-6'>
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

export function EmptyState({ title, children, icon: Icon = Inbox }: { title: string; children?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className='flex flex-col items-center gap-2 px-6 py-12 text-center'>
      <span className='mb-1 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground ring-8 ring-muted/40' aria-hidden><Icon className='size-5' /></span>
      <p className='font-medium'>{title}</p>
      {children && <div className='max-w-md text-sm text-muted-foreground'>{children}</div>}
    </div>
  )
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'
const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/12 text-destructive',
  info: 'bg-info/12 text-info',
  accent: 'bg-primary/15 text-primary',
}

// Colored strip + icon: explains a state (success, warning, error, info) inside a page
const noticeIcons: Record<Exclude<Tone, 'neutral' | 'accent'>, LucideIcon> = { success: CheckCircle2, warning: AlertTriangle, danger: OctagonAlert, info: Info }
export function Notice({ tone = 'info', title, children, className }: { tone?: 'success' | 'warning' | 'danger' | 'info'; title?: string; children?: React.ReactNode; className?: string }) {
  const Icon = noticeIcons[tone]
  const color = { success: 'border-success/40 bg-success/8 [&>svg]:text-success', warning: 'border-warning/40 bg-warning/8 [&>svg]:text-warning', danger: 'border-destructive/40 bg-destructive/8 [&>svg]:text-destructive', info: 'border-info/40 bg-info/8 [&>svg]:text-info' }[tone]
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', color, className)}>
      <Icon className='mt-0.5 size-4 shrink-0' aria-hidden />
      <div className='grid gap-0.5'>
        {title && <p className='font-medium'>{title}</p>}
        {children && <div className='text-muted-foreground'>{children}</div>}
      </div>
    </div>
  )
}

// Summary counters at the top of a page
export type Stat = { label: string; value: React.ReactNode; tone?: Tone; icon?: LucideIcon; hint?: React.ReactNode }
const statTones: Record<Tone, string> = {
  neutral: 'text-foreground [&_.stat-icon]:bg-muted [&_.stat-icon]:text-muted-foreground',
  success: '[&_.stat-icon]:bg-success/12 [&_.stat-icon]:text-success',
  warning: '[&_.stat-icon]:bg-warning/15 [&_.stat-icon]:text-warning',
  danger: '[&_.stat-icon]:bg-destructive/12 [&_.stat-icon]:text-destructive',
  info: '[&_.stat-icon]:bg-info/12 [&_.stat-icon]:text-info',
  accent: '[&_.stat-icon]:bg-primary/15 [&_.stat-icon]:text-primary',
}
export function StatCards({ items, className }: { items: Stat[]; className?: string }) {
  return (
    <div className={cn('stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {items.map(({ label, value, tone = 'neutral', icon: Icon, hint }) => (
        <div key={label} className={cn('flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-brand/40', statTones[tone])}>
          {Icon && <span className='stat-icon grid size-10 shrink-0 place-items-center rounded-lg' aria-hidden><Icon className='size-5' /></span>}
          <div className='min-w-0'>
            <div className='font-display text-2xl leading-tight font-semibold tabular-nums'>{typeof value === 'number' ? <CountUp value={value} /> : value}</div>
            <div className='truncate text-xs text-muted-foreground'>{label}{hint ? <> · {hint}</> : null}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Pill({ tone = 'neutral', children, className, style }: { tone?: Tone; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span style={style} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  const color = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', info: 'bg-info', neutral: 'bg-muted-foreground' }[tone]
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

// A number that rolls up to its value (instant when the user prefers less motion)
export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const start = from.current
    from.current = value
    if (reduce || start === value) {
      setShown(value)
      return
    }
    let frame = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(start + (value - start) * eased))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return <>{shown.toLocaleString('fr-FR')}</>
}
