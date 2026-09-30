import type { Recurrence } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type ScheduleDraft = {
  mode: 'once' | Recurrence['type']
  at: string // datetime-local: first (or only) send; optional for a recurrence
  time: string
  days: number[]
  dayOfMonth: number
  everyHours: number
  endAt: string
  maxRuns: string
}

const DAYS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam'], [0, 'Dim']] as const
const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

export const toLocalInput = (at: number) => new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export function scheduleDraft(r: Recurrence | null, scheduledAt: number | null): ScheduleDraft {
  return {
    mode: r?.type ?? 'once',
    at: scheduledAt ? toLocalInput(scheduledAt) : '',
    time: r?.time ?? '18:00',
    days: r?.days.length ? r.days : [1],
    dayOfMonth: r?.dayOfMonth ?? 1,
    everyHours: r?.everyHours ?? 24,
    endAt: r?.endAt ? toLocalInput(r.endAt) : '',
    maxRuns: r?.maxRuns ? String(r.maxRuns) : '',
  }
}

// Body of POST /announcements/:id/schedule
export function scheduleBody(s: ScheduleDraft) {
  const at = s.at ? new Date(s.at).getTime() : null
  if (s.mode === 'once') return { at, recurrence: null }
  return {
    at,
    recurrence: {
      type: s.mode, time: s.time, days: s.days, dayOfMonth: s.dayOfMonth, everyHours: s.everyHours,
      endAt: s.endAt ? new Date(s.endAt).getTime() : null, maxRuns: s.maxRuns ? Number(s.maxRuns) : null, timeZone: 'Europe/Paris',
    },
  }
}

export function scheduleReady(s: ScheduleDraft) {
  if (s.mode === 'once' || s.mode === 'interval') return Boolean(s.at)
  return s.mode !== 'weekly' || s.days.length > 0
}

// "Tous les lundi et jeudi à 18:00" …
export function describeRecurrence(r: Recurrence) {
  const until = [r.maxRuns ? `${r.maxRuns} envois` : '', r.endAt ? `jusqu’au ${new Date(r.endAt).toLocaleDateString('fr-FR')}` : ''].filter(Boolean).join(', ')
  const base = {
    daily: `Tous les jours à ${r.time}`,
    weekly: `Chaque ${r.days.map((d) => DAY_NAMES[d]).join(', ')} à ${r.time}`,
    monthly: `Le ${r.dayOfMonth} de chaque mois à ${r.time}`,
    interval: `Toutes les ${r.everyHours} h`,
  }[r.type]
  return until ? `${base} (${until})` : base
}

export function ScheduleEditor({ value: s, onChange }: { value: ScheduleDraft; onChange: (s: ScheduleDraft) => void }) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...s, ...patch })
  return (
    <div className='grid gap-4'>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='grid gap-1.5'>
          <Label>Fréquence</Label>
          <Select value={s.mode} onValueChange={(v) => set({ mode: v as ScheduleDraft['mode'] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='once'>Une seule fois</SelectItem>
              <SelectItem value='daily'>Tous les jours</SelectItem>
              <SelectItem value='weekly'>Certains jours de la semaine</SelectItem>
              <SelectItem value='monthly'>Tous les mois</SelectItem>
              <SelectItem value='interval'>Toutes les X heures</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor='sch-at'>{s.mode === 'once' ? 'Date d’envoi' : s.mode === 'interval' ? 'Premier envoi' : 'Premier envoi (facultatif)'}</Label>
          <Input id='sch-at' type='datetime-local' value={s.at} onChange={(e) => set({ at: e.target.value })} />
        </div>
      </div>

      {['daily', 'weekly', 'monthly'].includes(s.mode) && (
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='grid gap-1.5'>
            <Label htmlFor='sch-time'>Heure (heure de Paris)</Label>
            <Input id='sch-time' type='time' value={s.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
          {s.mode === 'monthly' && (
            <div className='grid gap-1.5'>
              <Label htmlFor='sch-dom'>Jour du mois</Label>
              <Input id='sch-dom' type='number' min={1} max={31} value={s.dayOfMonth} onChange={(e) => set({ dayOfMonth: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} />
              <span className='text-xs text-muted-foreground'>Le 31 tombe le dernier jour des mois plus courts.</span>
            </div>
          )}
        </div>
      )}
      {s.mode === 'weekly' && (
        <div className='flex flex-wrap gap-1.5' role='group' aria-label='Jours de la semaine'>
          {DAYS.map(([d, label]) => {
            const on = s.days.includes(d)
            return (
              <button
                key={d} type='button' aria-pressed={on}
                onClick={() => set({ days: on ? s.days.filter((x) => x !== d) : [...s.days, d] })}
                className={cn('h-9 w-12 rounded-md border text-sm transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >{label}</button>
            )
          })}
        </div>
      )}
      {s.mode === 'interval' && (
        <div className='grid gap-1.5 sm:max-w-xs'>
          <Label htmlFor='sch-every'>Toutes les (heures)</Label>
          <Input id='sch-every' type='number' min={1} max={720} value={s.everyHours} onChange={(e) => set({ everyHours: Math.max(1, Math.min(720, Number(e.target.value) || 1)) })} />
        </div>
      )}
      {s.mode !== 'once' && (
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='grid gap-1.5'>
            <Label htmlFor='sch-end'>Arrêter après le (facultatif)</Label>
            <Input id='sch-end' type='datetime-local' value={s.endAt} onChange={(e) => set({ endAt: e.target.value })} />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='sch-max'>…ou après N envois (facultatif)</Label>
            <Input id='sch-max' type='number' min={1} value={s.maxRuns} onChange={(e) => set({ maxRuns: e.target.value })} placeholder='Illimité' />
          </div>
        </div>
      )}
    </div>
  )
}
