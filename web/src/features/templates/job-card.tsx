import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { dateTime, duration } from '@/lib/format'
import { cn } from '@/lib/utils'

export type Report = { created: number; edited: number; deleted: number; memberRoles?: number; warnings: string[]; durationMs: number }
export type Job = { templateName: string; guildId: string; guildName: string; mode: 'reset' | 'repair' | 'restore'; status: 'running' | 'done' | 'failed'; step: string; done: number; total: number; warnings: string[]; startedAt: number; finishedAt: number | null; report: Report | null }

const MODES = { reset: 'Réinitialisation', repair: 'Réparation', restore: 'Restauration' }

// Progress of a template application or of a backup restore (one job at a time for the whole bot)
export function JobCard({ job }: { job: Job }) {
  const [open, setOpen] = useState(false)
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0
  const bar = job.status === 'running' ? 'bg-primary' : job.status === 'done' ? 'bg-success' : 'bg-destructive'
  return (
    <section className={cn('grid gap-3 rounded-xl border p-5', job.status === 'failed' ? 'border-destructive/50 bg-destructive/5' : 'bg-card')} aria-live='polite'>
      <div className='flex flex-wrap items-center gap-2'>
        {job.status === 'running' ? <Loader2 className='size-5 animate-spin text-primary' /> : job.status === 'done' ? <CheckCircle2 className='size-5 text-success' /> : <XCircle className='size-5 text-destructive' />}
        <h2 className='font-semibold'>{MODES[job.mode]} de {job.guildName} · {job.templateName}</h2>
        <span className='ms-auto text-sm tabular-nums text-muted-foreground'>{job.done}/{job.total}</span>
      </div>
      <div className='h-2 overflow-hidden rounded-full bg-muted' role='progressbar' aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label='Avancement'>
        <div className={cn('h-full rounded-full transition-[width] duration-500', bar)} style={{ width: `${job.status === 'running' ? pct : 100}%` }} />
      </div>
      <p className='text-sm text-muted-foreground'>
        {job.status === 'running' ? job.step : job.report ? `${job.report.created} créés · ${job.report.edited} remis comme le modèle · ${job.report.deleted} supprimés${job.report.memberRoles ? ` · ${job.report.memberRoles} rôles de membres rendus` : ''} · en ${duration(job.report.durationMs)} · ${dateTime(job.finishedAt)}` : job.step}
      </p>
      {job.warnings.length > 0 && (
        <div>
          <button type='button' className='flex items-center gap-1.5 text-sm text-warning' aria-expanded={open} onClick={() => setOpen(!open)}>
            <AlertTriangle className='size-4' /> {job.warnings.length} avertissement(s)
          </button>
          {open && <ul className='mt-2 max-h-60 list-disc space-y-0.5 overflow-y-auto ps-5 text-sm text-muted-foreground'>{job.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      )}
    </section>
  )
}
