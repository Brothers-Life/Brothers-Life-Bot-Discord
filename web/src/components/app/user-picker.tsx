import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/app/ui'
import { Input } from '@/components/ui/input'

export type PickedUser = {
  id: string
  username: string
  globalName: string | null
  nickname?: string | null
  avatar: string | null
  guilds?: string[]
}

const ID = /^\d{17,20}$/

function displayName(u: PickedUser) {
  return u.nickname || u.globalName || u.username
}

function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

// Member field: type a name (or paste an ID), pick from the suggestions of every network server
export function UserPicker({
  value,
  onChange,
  placeholder = 'Pseudo ou ID Discord',
  id,
  className,
  autoFocus,
}: {
  value: string
  onChange: (userId: string, user: PickedUser | null) => void
  placeholder?: string
  id?: string
  className?: string
  autoFocus?: boolean
}) {
  const listId = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState<PickedUser | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const query = useDebounced(text.trim())

  const search = useQuery({
    queryKey: ['people-search', query],
    queryFn: () => api<PickedUser[]>(`/people/search?q=${encodeURIComponent(query)}`),
    enabled: open && (query.length >= 2 || ID.test(query)),
    staleTime: 30_000,
  })
  const results = search.data ?? []

  // A value set from outside (e.g. ?user= in the URL): show who it is
  const external = useQuery({
    queryKey: ['people-search', value],
    queryFn: () => api<PickedUser[]>(`/people/search?q=${value}`),
    enabled: ID.test(value) && picked?.id !== value,
    staleTime: 60_000,
  })
  const shown = picked?.id === value ? picked : external.data?.[0] ?? null

  const choose = (user: PickedUser) => {
    setPicked(user)
    setText('')
    setOpen(false)
    onChange(user.id, user)
  }

  const clear = () => {
    setPicked(null)
    setText('')
    onChange('', null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  if (value && shown) {
    return (
      <div className={cn('flex h-9 items-center gap-2 rounded-md border bg-transparent px-2 text-sm', className)}>
        <UserAvatar src={shown.avatar} name={displayName(shown)} className='size-6' />
        <span className='truncate font-medium'>{displayName(shown)}</span>
        <span className='truncate text-xs text-muted-foreground'>@{shown.username}</span>
        <button type='button' onClick={clear} aria-label='Changer de membre' className='ms-auto rounded p-0.5 text-muted-foreground hover:text-foreground'>
          <X className='size-4' />
        </button>
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
      <Input
        ref={inputRef}
        id={id}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className='ps-8'
        role='combobox'
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete='list'
        autoComplete='off'
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
          if (value) onChange('', null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]) }
        }}
      />
      {open && query.length >= 2 && (
        <ul id={listId} role='listbox' className='absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md'>
          {search.isFetching && !results.length && <li className='px-2 py-1.5 text-sm text-muted-foreground'>Recherche…</li>}
          {!search.isFetching && !results.length && <li className='px-2 py-1.5 text-sm text-muted-foreground'>Personne trouvé sur les serveurs du réseau.</li>}
          {results.map((user, index) => (
            <li
              key={user.id}
              role='option'
              aria-selected={index === active}
              onMouseDown={(e) => { e.preventDefault(); choose(user) }}
              onMouseEnter={() => setActive(index)}
              className='flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm aria-selected:bg-accent'
            >
              <UserAvatar src={user.avatar} name={displayName(user)} className='size-7' />
              <div className='min-w-0 flex-1'>
                <div className='truncate font-medium'>{displayName(user)} <span className='font-normal text-muted-foreground'>@{user.username}</span></div>
                {user.guilds && user.guilds.length > 0 && <div className='truncate text-xs text-muted-foreground'>{user.guilds.join(', ')}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
