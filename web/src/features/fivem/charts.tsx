import { ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/app/ui'
import { count } from './format'

export function Chart({ title, children, className }: { title: string; children: React.ReactElement; className?: string }) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <h3 className='mb-3 text-sm font-semibold'>{title}</h3>
      <div className='h-60'><ResponsiveContainer>{children}</ResponsiveContainer></div>
    </div>
  )
}

// A ranked list with a proportional bar behind each line
export function Bars({ rows, format = count, tone = 'bg-primary/20' }: { rows: { key: string; label: React.ReactNode; value: number }[]; format?: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <EmptyState title='Rien pour l’instant' />
  return (
    <ul className='grid gap-1 p-3'>
      {rows.map((r) => (
        <li key={r.key} className='relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm'>
          <span className={cn('absolute inset-y-0 start-0 rounded-md', tone)} style={{ width: `${(r.value / max) * 100}%` }} aria-hidden />
          <span className='relative min-w-0 flex-1 truncate'>{r.label}</span>
          <span className='relative font-medium tabular-nums'>{format(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}

