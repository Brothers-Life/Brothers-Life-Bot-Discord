import { useState } from 'react'
import { Check, Pipette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// Discord's own role palette, plus the Brothers Life amber
const PALETTE = [
  '#ff9628', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6',
  '#d6a249', '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22', '#607d8b',
  '#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#ffffff', '#99aab5', '#2c2f33', '#23272a', '#000000',
]
const RECENT_KEY = 'brl:color-recent'
const HEX = /^#[0-9a-f]{6}$/i

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] }
}

// Any color: palette, recent ones, hex code or the system picker
export function ColorPicker({ value, onChange, disabled, label = 'Couleur', id, className }: {
  value: string
  onChange: (hex: string) => void
  disabled?: boolean
  label?: string
  id?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [recent, setRecent] = useState(readRecent)
  const current = HEX.test(value) ? value.toLowerCase() : '#000000'

  const pick = (hex: string, close = true) => {
    const clean = hex.toLowerCase()
    onChange(clean)
    setDraft(clean)
    const next = [clean, ...recent.filter((c) => c !== clean)].slice(0, 10)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    if (close) setOpen(false)
  }

  const swatch = (hex: string) => (
    <button key={hex} type='button' title={hex} aria-label={hex} onClick={() => pick(hex)}
      className='relative size-6 rounded-md border border-black/20 shadow-xs transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      style={{ background: hex }}>
      {hex === current && <Check className='absolute inset-0 m-auto size-3.5 text-white mix-blend-difference' />}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(value) }}>
      <PopoverTrigger asChild>
        <button id={id} type='button' disabled={disabled} aria-label={`${label} : ${current}`}
          className={cn('flex h-9 w-full min-w-24 items-center gap-2 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30', className)}>
          <span className='size-5 shrink-0 rounded border border-black/20' style={{ background: current }} />
          <span className='font-mono text-xs uppercase'>{current}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='grid w-64 gap-3 p-3'>
        <div className='grid grid-cols-10 gap-1'>{PALETTE.map(swatch)}</div>
        {recent.length > 0 && (
          <div className='grid gap-1'>
            <span className='text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>Récentes</span>
            <div className='flex flex-wrap gap-1'>{recent.map(swatch)}</div>
          </div>
        )}
        <div className='flex items-center gap-2'>
          <label className='relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-md border border-input hover:bg-accent' title='Couleur libre'>
            <Pipette className='size-4' />
            <input type='color' value={current} aria-label='Couleur libre' className='absolute inset-0 cursor-pointer opacity-0'
              onChange={(e) => pick(e.target.value, false)} />
          </label>
          <input value={draft} maxLength={7} aria-label='Code hexadécimal' spellCheck={false}
            className='h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
            onChange={(e) => {
              const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
              setDraft(v)
              if (HEX.test(v)) onChange(v.toLowerCase())
            }}
            onBlur={() => HEX.test(draft) && pick(draft, false)} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger'
// The only button colors Discord allows, drawn as Discord draws them
const BUTTONS: { value: ButtonStyle; label: string; color: string }[] = [
  { value: 'primary', label: 'Bleu', color: '#5865f2' },
  { value: 'secondary', label: 'Gris', color: '#4e5058' },
  { value: 'success', label: 'Vert', color: '#248046' },
  { value: 'danger', label: 'Rouge', color: '#da373c' },
]

export function ButtonStylePicker({ value, onChange, disabled, label = 'Couleur du bouton', text }: {
  value: ButtonStyle
  onChange: (style: ButtonStyle) => void
  disabled?: boolean
  label?: string
  text?: string
}) {
  return (
    <div role='radiogroup' aria-label={label} className='flex flex-wrap gap-1.5'>
      {BUTTONS.map((b) => (
        <button key={b.value} type='button' role='radio' aria-label={b.label} aria-checked={value === b.value} disabled={disabled} title={`${b.label} (Discord n’autorise que ces 4 couleurs de bouton)`}
          onClick={() => onChange(b.value)}
          className={cn('h-8 rounded-[3px] px-3 text-sm font-medium text-white transition disabled:opacity-50',
            value === b.value ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'opacity-60 hover:opacity-100')}
          style={{ background: b.color }}>
          {text || b.label}
        </button>
      ))}
    </div>
  )
}
