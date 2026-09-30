import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Occurrence = { id: number; name: string; at: number; color: string; recurring: boolean }
const DAY = 86_400_000
const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

// Monday 00:00 (browser time) of the week containing `d`
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// Upcoming sends by month or week, recurring announcements included
export function AnnouncementsCalendar() {
  const [view, setView] = useState<'month' | 'week'>('month')
  const [cursor, setCursor] = useState(() => new Date())
  const first = view === 'month' ? startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)) : startOfWeek(cursor)
  const days = Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  const from = days[0].getTime()
  const to = days.at(-1)!.getTime() + DAY - 1
  const { data } = useQuery({ queryKey: ['announcement-calendar', from, to], queryFn: () => api<Occurrence[]>(`/announcements/calendar?from=${from}&to=${to}`) })
  const move = (n: number) => setCursor(view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() + n, 1) : new Date(cursor.getTime() + n * 7 * DAY))
  const today = new Date()
  const title = view === 'month'
    ? cursor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : `Semaine du ${days[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`

  return (
    <div className='grid gap-3 p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button size='icon' variant='outline' aria-label='Précédent' onClick={() => move(-1)}><ChevronLeft /></Button>
        <Button size='icon' variant='outline' aria-label='Suivant' onClick={() => move(1)}><ChevronRight /></Button>
        <Button size='sm' variant='ghost' onClick={() => setCursor(new Date())}>Aujourd’hui</Button>
        <h3 className='flex-1 text-base font-semibold first-letter:uppercase'>{title}</h3>
        <div className='flex rounded-md border p-0.5' role='group' aria-label='Vue'>
          {(['month', 'week'] as const).map((v) => (
            <button key={v} type='button' aria-pressed={view === v} onClick={() => setView(v)} className={cn('rounded px-3 py-1 text-sm transition-colors', view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
              {v === 'month' ? 'Mois' : 'Semaine'}
            </button>
          ))}
        </div>
      </div>
      {!data ? <Skeleton className='h-96' /> : (
        <div className='overflow-x-auto'>
          <div className='grid min-w-[42rem] grid-cols-7 overflow-hidden rounded-md border'>
            {WEEKDAYS.map((d) => <div key={d} className='border-b bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground'>{d}</div>)}
            {days.map((day) => {
              const items = data.filter((o) => sameDay(new Date(o.at), day))
              const outside = view === 'month' && day.getMonth() !== cursor.getMonth()
              return (
                <div key={day.getTime()} className={cn('grid content-start gap-1 border-e border-b p-1.5 [&:nth-child(7n)]:border-e-0', view === 'month' ? 'min-h-24' : 'min-h-64', outside && 'bg-muted/20 text-muted-foreground')}>
                  <span className={cn('grid size-6 place-items-center rounded-full text-xs', sameDay(day, today) && 'bg-primary font-semibold text-primary-foreground')}>{day.getDate()}</span>
                  {items.slice(0, view === 'month' ? 3 : 20).map((o) => (
                    <Link
                      key={`${o.id}-${o.at}`} to='/announcements/$id' params={{ id: String(o.id) }}
                      className='flex min-w-0 items-center gap-1 rounded border-s-2 bg-accent/50 px-1.5 py-0.5 text-xs transition-colors hover:bg-accent'
                      style={{ borderColor: o.color }}
                      title={`${o.name} · ${new Date(o.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                    >
                      <span className='tabular-nums text-muted-foreground'>{new Date(o.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className='truncate'>{o.name}</span>
                      {o.recurring && <Repeat className='size-3 shrink-0 text-muted-foreground' aria-label='récurrente' />}
                    </Link>
                  ))}
                  {view === 'month' && items.length > 3 && <span className='px-1 text-xs text-muted-foreground'>+{items.length - 3} autres</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
