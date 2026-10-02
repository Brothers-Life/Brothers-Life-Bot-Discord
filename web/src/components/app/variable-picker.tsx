import { useEffect, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Braces, Search } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { normalize } from '@/lib/emoji-data'
import { typeInto } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export type Variable = { key: string; label: string; group?: string }
export type VariableGroup = { title: string; hint?: string; items: Variable[] }

// "{x}" button opening the list of the variables, grouped and searchable; a click inserts one
export function VariablePicker({ groups, onPick, label = 'Variables', disabled }: {
  groups: VariableGroup[]
  onPick: (token: string) => void
  label?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = normalize(query.trim())
  const shown = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((v) => normalize(`${v.key} ${v.label}`).includes(q)) : g.items }))
    .filter((g) => g.items.length)
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        <Button type='button' variant='outline' size='sm' className='h-7 gap-1.5 px-2 text-xs' disabled={disabled}><Braces className='size-3.5' /> {label}</Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-[min(24rem,calc(100vw-1rem))] p-0' onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className='relative border-b p-2'>
          <Search className='pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Chercher une variable' aria-label='Chercher une variable'
            className='h-8 w-full rounded-md bg-muted ps-8 pe-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50' />
        </div>
        <div className='max-h-80 overflow-y-auto p-1'>
          {shown.map((g) => (
            <section key={g.title} className='pb-1'>
              <h3 className='sticky top-0 bg-popover px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>{g.title}</h3>
              {g.hint && <p className='px-2 pb-1 text-xs text-muted-foreground'>{g.hint}</p>}
              {g.items.map((v) => (
                <button key={v.key} type='button' onClick={() => { onPick(`{${v.key}}`); setOpen(false); setQuery('') }}
                  className='flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'>
                  <code className='shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary'>{`{${v.key}}`}</code>
                  <span className='min-w-0 truncate text-muted-foreground'>{v.label}</span>
                </button>
              ))}
            </section>
          ))}
          {!shown.length && <p className='p-3 text-center text-sm text-muted-foreground'>Aucune variable.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// The shared variables (member / server / FiveM) of the bot, plus the editor's own ones.
// A click types the variable into the last text field used inside `container`, else copies it.
export function VariableButton({ scope = 'member', extra = [], container, disabled, label }: {
  scope?: 'member' | 'server'
  extra?: VariableGroup[]
  container: RefObject<HTMLElement | null>
  disabled?: boolean
  label?: string
}) {
  const { data } = useQuery({ queryKey: ['variables', scope], queryFn: () => api<{ groups: VariableGroup[] }>(`/variables?scope=${scope}`), staleTime: 5 * 60_000 })
  const last = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const box = container.current
    if (!box) return
    const onFocus = (e: FocusEvent) => {
      const el = e.target
      if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'url', 'search', ''].includes(el.type))) last.current = el
    }
    box.addEventListener('focusin', onFocus)
    return () => box.removeEventListener('focusin', onFocus)
  }, [container])
  const pick = (token: string) => {
    const field = last.current
    if (field && field.isConnected && !field.disabled) return typeInto(field, token)
    navigator.clipboard?.writeText(token).then(() => toast.success(`${token} copiée : colle-la dans un champ.`), () => toast.error('Clique d’abord dans un champ texte.'))
  }
  return <VariablePicker groups={[...extra, ...(data?.groups ?? [])]} onPick={pick} disabled={disabled} label={label} />
}
