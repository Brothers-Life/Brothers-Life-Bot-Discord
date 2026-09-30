import type { Channel, Role } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const NONE = '__none__'

function roleColor(color: string) {
  return color === '#000000' ? 'var(--muted-foreground)' : color
}

// Several Discord roles, in a popover with checkboxes
export function RolesPicker({ roles, value, onChange, disabled, placeholder = 'Aucun rôle', label }: {
  roles: Role[]
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  placeholder?: string
  label: string
}) {
  const names = value.map((id) => roles.find((r) => r.id === id)?.name ?? 'rôle supprimé')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type='button' variant='outline' className='h-auto min-h-9 w-full justify-start whitespace-normal text-start font-normal' disabled={disabled} aria-label={label}>
          {names.length ? names.map((n) => `@${n}`).join(', ') : <span className='text-muted-foreground'>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='max-h-72 w-72 overflow-y-auto p-1'>
        {roles.map((role) => (
          <label key={role.id} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent'>
            <Checkbox
              checked={value.includes(role.id)}
              onCheckedChange={() => onChange(value.includes(role.id) ? value.filter((r) => r !== role.id) : [...value, role.id])}
            />
            <span aria-hidden className='size-2 shrink-0 rounded-full' style={{ background: roleColor(role.color) }} />
            <span className='truncate'>{role.name}</span>
          </label>
        ))}
        {!roles.length && <p className='p-2 text-sm text-muted-foreground'>Aucun rôle sur ce serveur.</p>}
      </PopoverContent>
    </Popover>
  )
}

// One text channel (or none)
export function ChannelSelect({ channels, value, onChange, disabled, noneLabel = 'Aucun', label }: {
  channels: Channel[]
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  noneLabel?: string
  label: string
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {channels.map((c) => (
          <SelectItem key={c.id} value={c.id} disabled={c.canSend === false}>#{c.name}{c.parent ? ` · ${c.parent}` : ''}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// One Discord category (or none)
export function CategorySelect({ categories, value, onChange, disabled, noneLabel = 'Aucune', label }: {
  categories: { id: string; name: string }[]
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  noneLabel?: string
  label: string
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
