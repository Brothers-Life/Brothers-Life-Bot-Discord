import { useEffect, useRef, type ComponentProps, type RefObject } from 'react'
import { Bold, Code, Code2, EyeOff, Heading1, Italic, Link2, List, Quote, Strikethrough, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Field = HTMLInputElement | HTMLTextAreaElement
type Kind = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'code' | 'codeblock' | 'quote' | 'heading' | 'list' | 'link'

const WRAP: Partial<Record<Kind, [string, string]>> = {
  bold: ['**', '**'], italic: ['*', '*'], underline: ['__', '__'], strike: ['~~', '~~'], spoiler: ['||', '||'], code: ['`', '`'],
}
const LINE_PREFIX: Partial<Record<Kind, string>> = { quote: '> ', heading: '# ', list: '- ' }

// Replaces [from, to) of the field by `text` and selects [selStart, selEnd) (offsets inside the new text).
// execCommand keeps the browser's undo history; the native setter is the fallback. Both fire the React onChange.
function replaceRange(field: Field, from: number, to: number, text: string, selStart: number, selEnd: number) {
  field.focus()
  field.setSelectionRange(from, to)
  if (!document.execCommand('insertText', false, text)) {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, field.value.slice(0, from) + text + field.value.slice(to))
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  field.setSelectionRange(from + selStart, from + selEnd)
}

function applyFormat(field: Field, kind: Kind) {
  const value = field.value
  const start = field.selectionStart ?? value.length
  const end = field.selectionEnd ?? start
  const sel = value.slice(start, end)
  const wrap = WRAP[kind]
  if (wrap) {
    const [a, b] = wrap
    // already wrapped just outside the selection: remove the markers
    if (sel && value.slice(start - a.length, start) === a && value.slice(end, end + b.length) === b) {
      return replaceRange(field, start - a.length, end + b.length, sel, 0, sel.length)
    }
    return replaceRange(field, start, end, a + sel + b, a.length, a.length + sel.length)
  }
  if (kind === 'codeblock') {
    const text = '```\n' + sel + '\n```'
    return replaceRange(field, start, end, text, 4, 4 + sel.length)
  }
  if (kind === 'link') {
    const label = sel || 'texte'
    const text = `[${label}](https://)`
    // select the address, ready to be pasted over
    return replaceRange(field, start, end, text, label.length + 3, text.length - 1)
  }
  const prefix = LINE_PREFIX[kind]
  if (prefix) {
    // every line touched by the selection; a second click removes the prefix
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const nl = value.indexOf('\n', end)
    const lineEnd = nl === -1 ? value.length : nl
    const lines = value.slice(lineStart, lineEnd).split('\n')
    const all = lines.every((l) => l.startsWith(prefix))
    const text = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join('\n')
    return replaceRange(field, lineStart, lineEnd, text, 0, text.length)
  }
}

const SHORTCUTS: Record<string, Kind> = { b: 'bold', i: 'italic', u: 'underline' }

const BUTTONS: { kind: Kind; label: string; icon: typeof Bold; hint?: string }[] = [
  { kind: 'bold', label: 'Gras', icon: Bold, hint: 'Ctrl+B' },
  { kind: 'italic', label: 'Italique', icon: Italic, hint: 'Ctrl+I' },
  { kind: 'underline', label: 'Souligné', icon: Underline, hint: 'Ctrl+U' },
  { kind: 'strike', label: 'Barré', icon: Strikethrough },
  { kind: 'spoiler', label: 'Spoiler (texte caché)', icon: EyeOff },
  { kind: 'code', label: 'Code', icon: Code },
  { kind: 'codeblock', label: 'Bloc de code', icon: Code2 },
  { kind: 'quote', label: 'Citation', icon: Quote },
  { kind: 'heading', label: 'Titre', icon: Heading1 },
  { kind: 'list', label: 'Liste', icon: List },
  { kind: 'link', label: 'Lien masqué', icon: Link2 },
]

const isMdField = (el: EventTarget | null): el is Field =>
  (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.dataset.md !== undefined

// Discord formatting buttons. They act on the last text field marked `data-md` focused inside `container`
// (the same idea as VariableButton); Ctrl+B / Ctrl+I / Ctrl+U work in those fields too.
export function MarkdownToolbar({ container, disabled }: { container: RefObject<HTMLElement | null>; disabled?: boolean }) {
  const last = useRef<Field | null>(null)
  useEffect(() => {
    const box = container.current
    if (!box) return
    const onFocus = (e: FocusEvent) => { if (isMdField(e.target)) last.current = e.target }
    const onKey = (e: KeyboardEvent) => {
      const kind = SHORTCUTS[e.key.toLowerCase()]
      if (!kind || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !isMdField(e.target) || e.target.disabled) return
      e.preventDefault()
      applyFormat(e.target, kind)
    }
    box.addEventListener('focusin', onFocus)
    box.addEventListener('keydown', onKey)
    return () => { box.removeEventListener('focusin', onFocus); box.removeEventListener('keydown', onKey) }
  }, [container])
  const act = (kind: Kind) => {
    const field = last.current
    if (field && field.isConnected && !field.disabled) applyFormat(field, kind)
    else (container.current?.querySelector<Field>('[data-md]:not(:disabled)'))?.focus()
  }
  return (
    <div role='toolbar' aria-label='Mise en forme Discord' className='flex flex-wrap gap-0.5'>
      {BUTTONS.map(({ kind, label, icon: Icon, hint }) => (
        <Tooltip key={kind}>
          <TooltipTrigger asChild>
            {/* mousedown is cancelled so the field keeps its focus and selection */}
            <Button type='button' variant='ghost' size='icon' className='size-7' disabled={disabled} aria-label={label}
              onMouseDown={(e) => e.preventDefault()} onClick={() => act(kind)}>
              <Icon className='size-3.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{hint ? `${label} (${hint})` : label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

// Textarea with its own formatting toolbar above it
export function MarkdownTextarea({ disabled, ...props }: ComponentProps<typeof Textarea>) {
  const box = useRef<HTMLDivElement>(null)
  return (
    <div ref={box} className='grid gap-1'>
      <MarkdownToolbar container={box} disabled={disabled} />
      <Textarea data-md='' disabled={disabled} {...props} />
    </div>
  )
}
