import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Download, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { errorMessage, ApiError } from '@/lib/api'
import { EmptyState, Notice, Pill, Section, UserAvatar, type Tone } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { clean, dt, rel, type Value } from './format'
import type { StreamState } from './use-stream'

// A character of the game, linked to its sheet in the panel
export function PlayerLink({ cid, name, className }: { cid?: string | null; name?: string | null; className?: string }) {
  const label = name || cid || '–'
  if (!cid) return <span className={cn('truncate', className)}>{label}</span>
  return (
    <Link to='/telemetry/players/$cid' params={{ cid }} className={cn('inline-flex min-w-0 items-center gap-2 font-medium hover:text-primary hover:underline', className)}>
      <UserAvatar name={label} className='size-6 text-[10px]' />
      <span className='truncate'>{label}</span>
    </Link>
  )
}

// Small group of buttons, one value chosen (period, filter…)
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role='radiogroup' aria-label={label} className='inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5'>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type='button'
          role='radio'
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground', o.value === value && 'bg-background text-foreground shadow-sm')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const LEVEL_TONE: Record<string, Tone> = { error: 'danger', warn: 'warning', info: 'info' }
export function LevelPill({ level }: { level?: string | null }) {
  return <Pill tone={LEVEL_TONE[level ?? ''] ?? 'neutral'}>{level || '?'}</Pill>
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]', className)}>{children}</span>
}

// Relative time with the exact date on hover
export function When({ at }: { at: Value }) {
  return <time title={dt(at)} className='whitespace-nowrap text-muted-foreground'>{rel(at)}</time>
}

/* ---------------------------------- tables ---------------------------------- */

export type Column<T> = {
  key: string
  label: string
  align?: 'end'
  className?: string
  render: (row: T, index: number) => React.ReactNode
  // Text of the cell in the CSV export (left out of the export when absent)
  csv?: (row: T) => Value | boolean
}

function csvCell(value: Value | boolean) {
  let text = value === null || value === undefined ? '' : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function exportCsv<T>(name: string, columns: Column<T>[], rows: T[]) {
  const cols = columns.filter((c) => c.csv)
  if (!rows.length) {
    toast.warning('Rien à exporter : le tableau est vide.')
    return
  }
  const lines = [cols.map((c) => csvCell(c.label)).join(';'), ...rows.map((r) => cols.map((c) => csvCell(c.csv!(r))).join(';'))]
  const blob = new Blob([`${String.fromCharCode(0xfeff)}${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function ExportButton<T>({ name, columns, rows }: { name: string; columns: Column<T>[]; rows: T[] }) {
  return (
    <Button variant='ghost' size='sm' onClick={() => exportCsv(name, columns, rows)} aria-label='Exporter en CSV' title='Exporter en CSV'>
      <Download /> CSV
    </Button>
  )
}

export function DataTable<T>({ columns, rows, empty = 'Rien pour le moment.', minWidth = '40rem', rowKey, onRowClick, rowClassName }: {
  columns: Column<T>[]
  rows: T[]
  empty?: string
  minWidth?: string
  rowKey?: (row: T, index: number) => string | number
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
}) {
  if (!rows.length) return <EmptyState title={empty} />
  return (
    // relative: screen-reader-only labels (absolute) stay inside the scrolling box
    <div className='relative overflow-x-auto'>
      <table className='w-full text-sm' style={{ minWidth }}>
        <thead>
          <tr className='border-b text-xs text-muted-foreground'>
            {columns.map((c) => <th key={c.key} className={cn('px-3 py-2 font-medium first:ps-4 last:pe-4', c.align === 'end' ? 'text-end' : 'text-start')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className='divide-y'>
          {rows.map((r, i) => (
            <tr
              key={rowKey ? rowKey(r, i) : i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn(onRowClick && 'cursor-pointer hover:bg-accent/40', rowClassName?.(r))}
            >
              {columns.map((c) => <td key={c.key} className={cn('px-3 py-2 align-top first:ps-4 last:pe-4', c.align === 'end' && 'text-end tabular-nums', c.className)}>{c.render(r, i)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A titled table with its CSV export
export function TableSection<T>({ title, description, exportName, columns, rows, empty, minWidth, actions, rowKey, onRowClick, rowClassName, className, maxHeight }: {
  title: string
  description?: React.ReactNode
  exportName?: string
  columns: Column<T>[]
  rows: T[] | undefined
  empty?: string
  minWidth?: string
  actions?: React.ReactNode
  rowKey?: (row: T, index: number) => string | number
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  className?: string
  maxHeight?: string
}) {
  return (
    <Section
      title={title}
      description={description}
      className={className}
      actions={(actions || exportName) && (
        <div className='flex flex-wrap items-center gap-2'>
          {actions}
          {exportName && rows && <ExportButton name={exportName} columns={columns} rows={rows} />}
        </div>
      )}
    >
      {!rows ? <Skeleton className='m-4 h-32' /> : (
        <div className={cn(maxHeight && 'overflow-y-auto')} style={maxHeight ? { maxHeight } : undefined}>
          <DataTable columns={columns} rows={rows} empty={empty} minWidth={minWidth} rowKey={rowKey} onRowClick={onRowClick} rowClassName={rowClassName} />
        </div>
      )}
    </Section>
  )
}

/* ----------------------------------- misc ----------------------------------- */

export function QueryError({ error }: { error: unknown }) {
  const forbidden = error instanceof ApiError && error.status === 403
  return (
    <Notice tone='warning' title={forbidden ? 'Accès refusé' : 'Données indisponibles'}>
      {forbidden ? 'Ton rang ne te permet pas de voir cette partie de la télémétrie.' : errorMessage(error)}
    </Notice>
  )
}

// Death screenshots (sent by the game as links): opened in a dialog
export function Screenshot({ url, caption, children, className }: { url: string; caption?: string; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type='button' onClick={() => setOpen(true)} className={cn('inline-flex items-center gap-1 text-primary hover:underline', className)} title='Voir la capture'>
        {children ?? <><ImageIcon className='size-4' /> <span className='sr-only'>Voir la capture</span></>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-4xl'>
          <DialogHeader>
            <DialogTitle>Capture</DialogTitle>
            {caption && <DialogDescription>{caption}</DialogDescription>}
          </DialogHeader>
          <img src={url} alt={caption ?? 'Capture'} className='max-h-[70vh] w-full rounded-md object-contain' referrerPolicy='no-referrer' />
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ConsoleLine({ line }: { line: unknown }) {
  return <span className='font-mono text-xs break-all whitespace-pre-wrap'>{clean(line)}</span>
}

// Words of a search highlighted in a text
export function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className='rounded bg-primary/25 text-foreground'>{p}</mark> : p))}</>
}

// Ranked list with proportional bars
export function RankList({ rows, empty = 'Pas encore de données.' }: { rows: { key: string; label: React.ReactNode; value: number; display?: string }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <EmptyState title={empty} />
  return (
    <ul className='grid gap-1 p-3'>
      {rows.map((r) => (
        <li key={r.key} className='relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm'>
          <span className='absolute inset-y-0 start-0 rounded-md bg-primary/15' style={{ width: `${(r.value / max) * 100}%` }} aria-hidden />
          <span className='relative min-w-0 flex-1 truncate'>{r.label}</span>
          <span className='relative font-medium tabular-nums'>{r.display ?? r.value.toLocaleString('fr-FR')}</span>
        </li>
      ))}
    </ul>
  )
}

// State of the live feed
export function StreamPill({ state }: { state: StreamState }) {
  return (
    <Pill tone={state === 'on' ? 'success' : state === 'off' ? 'danger' : 'warning'}>
      <span className={cn('size-1.5 rounded-full bg-current', state === 'on' && 'live-dot')} aria-hidden />
      {state === 'on' ? 'en direct' : state === 'off' ? 'indisponible' : 'connexion…'}
    </Pill>
  )
}

