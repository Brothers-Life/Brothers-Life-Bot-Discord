import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Apple, Car, Clock, Flag, Gamepad2, Heart, Lightbulb, Loader2, PawPrint, Search, Smile, Users, X, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { loadEmojis, normalize, searchEmojis, type UnicodeEmoji } from '@/lib/emoji-data'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { GuildIcon } from '@/components/app/ui'

type GuildEmojis = { id: string; name: string; icon: string | null; isMain: boolean; emojis: { id: string; name: string; animated: boolean }[] }
type Item = { value: string; label: string; unicode?: string; url?: string }
type Section = { key: string; title: string; items: Item[]; icon?: LucideIcon; guild?: GuildEmojis }

const GROUPS: { group: number; title: string; icon: LucideIcon }[] = [
  { group: 0, title: 'Smileys et émotions', icon: Smile },
  { group: 1, title: 'Personnes', icon: Users },
  { group: 3, title: 'Nature', icon: PawPrint },
  { group: 4, title: 'Nourriture', icon: Apple },
  { group: 5, title: 'Voyages et lieux', icon: Car },
  { group: 6, title: 'Activités', icon: Gamepad2 },
  { group: 7, title: 'Objets', icon: Lightbulb },
  { group: 8, title: 'Symboles', icon: Heart },
  { group: 9, title: 'Drapeaux', icon: Flag },
]
const TONES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']
const RECENT_KEY = 'brl:emoji-recent'
const TONE_KEY = 'brl:emoji-tone'
const CUSTOM = /^<(a?):(\w{2,32}):(\d{17,20})>$/

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}

const customUrl = (id: string, animated: boolean, size = 48) => `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=${size}`

// Server emoji image, or its :name: when the image is gone (emoji deleted)
function CustomEmoji({ url, name, className }: { url: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <span title={`:${name}:`} className='max-w-full truncate text-[10px] leading-none text-muted-foreground'>:{name}:</span>
  return <img src={url} alt={`:${name}:`} title={`:${name}:`} loading='lazy' onError={() => setBroken(true)} className={className} />
}

// An emoji value as saved by the bot: unicode, or <:name:id> / <a:name:id> for a server emoji
export function EmojiView({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return null
  const m = CUSTOM.exec(value)
  if (m) return <CustomEmoji url={customUrl(m[3], m[1] === 'a')} name={m[2]} className={cn('inline-block size-[1.2em] object-contain align-[-0.2em]', className)} />
  return <span className={className}>{value}</span>
}

function useServerEmojis(enabled: boolean) {
  return useQuery({ queryKey: ['emojis'], queryFn: () => api<{ guilds: GuildEmojis[] }>('/emojis'), enabled, staleTime: 5 * 60_000 })
}

// Discord-like picker: search, recent emojis, network server emojis, unicode categories, skin tone
export function EmojiPicker({ onSelect, children, allowCustom = true, align = 'start' }: {
  onSelect: (emoji: string) => void
  children: React.ReactNode
  allowCustom?: boolean
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className='w-[min(24rem,calc(100vw-1rem))] p-0' onOpenAutoFocus={(e) => e.preventDefault()}>
        {open && <PickerBody allowCustom={allowCustom} onPick={(v) => { onSelect(v); setOpen(false) }} />}
      </PopoverContent>
    </Popover>
  )
}

function PickerBody({ allowCustom, onPick }: { allowCustom: boolean; onPick: (value: string) => void }) {
  const unicode = useQuery({ queryKey: ['emoji-data'], queryFn: loadEmojis, staleTime: Infinity, gcTime: Infinity })
  const servers = useServerEmojis(allowCustom)
  const [query, setQuery] = useState('')
  const [tone, setTone] = useState(() => stored<number>(TONE_KEY, 0))
  const [toneOpen, setToneOpen] = useState(false)
  const [recent, setRecent] = useState(() => stored<string[]>(RECENT_KEY, []))
  const [hover, setHover] = useState<Item | null>(null)
  const [active, setActive] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { searchRef.current?.focus() }, [])

  const withTone = (e: UnicodeEmoji) => (tone && e.skins?.length === 5 ? e.skins[tone - 1] : e.unicode)
  const guilds = useMemo(() => (allowCustom ? (servers.data?.guilds ?? []).filter((g) => g.emojis.length) : []), [allowCustom, servers.data])

  const byValue = useMemo(() => {
    const map = new Map<string, Item>()
    for (const e of unicode.data ?? []) map.set(e.unicode, { value: e.unicode, label: e.shortcode ? `:${e.shortcode}:` : e.label, unicode: e.unicode })
    for (const g of guilds) for (const e of g.emojis) map.set(`<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`, { value: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`, label: `:${e.name}:`, url: customUrl(e.id, e.animated) })
    return map
  }, [unicode.data, guilds])

  const sections = useMemo<Section[]>(() => {
    const all = unicode.data ?? []
    const customItems = (g: GuildEmojis) => g.emojis.map((e) => byValue.get(`<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)!)
    const toItem = (e: UnicodeEmoji): Item => { const u = withTone(e); return { value: u, label: e.shortcode ? `:${e.shortcode}:` : e.label, unicode: u } }
    const q = normalize(query.trim().replace(/^:|:$/g, ''))
    if (q) {
      const custom = guilds.flatMap((g) => customItems(g).filter((i) => normalize(i.label).includes(q)))
      const found = searchEmojis(all, q).slice(0, 200).map(toItem)
      return [{ key: 'search', title: 'Résultats', items: [...custom, ...found] }]
    }
    const recentItems = recent.map((v) => byValue.get(v) ?? (CUSTOM.test(v) ? null : { value: v, label: v, unicode: v })).filter((i): i is Item => Boolean(i) && (allowCustom || !CUSTOM.test(i!.value)))
    return [
      ...(recentItems.length ? [{ key: 'recent', title: 'Fréquemment utilisés', icon: Clock, items: recentItems }] : []),
      ...guilds.map((g) => ({ key: `g${g.id}`, title: g.name, guild: g, items: customItems(g) })),
      ...GROUPS.map((g) => ({ key: `u${g.group}`, title: g.title, icon: g.icon, items: all.filter((e) => e.group === g.group).map(toItem) })),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unicode.data, guilds, byValue, query, recent, tone, allowCustom])

  const pick = (item: Item) => {
    const next = [item.value, ...recent.filter((v) => v !== item.value)].slice(0, 24)
    store(RECENT_KEY, next)
    setRecent(next)
    onPick(item.value)
  }

  const jump = (key: string) => {
    setQuery('')
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-section='${key}']`)
      if (el && scroller.current) scroller.current.scrollTop = el.offsetTop
    })
  }

  // Highlight the section in view in the side rail
  const onScroll = () => {
    const box = scroller.current
    if (!box) return
    let current = ''
    for (const el of box.querySelectorAll<HTMLElement>('[data-section]')) if (el.offsetTop <= box.scrollTop + 8) current = el.dataset.section ?? ''
    setActive(current)
  }

  const preview = hover ?? null
  return (
    <div className='flex h-[min(26rem,70vh)] flex-col'>
      <div className='flex items-center gap-2 border-b p-2'>
        <div className='relative flex-1'>
          <Search className='pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Trouve l’émoji parfait'
            aria-label='Rechercher un émoji'
            className='h-8 w-full rounded-md bg-muted ps-8 pe-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          />
          {query && <button type='button' aria-label='Effacer la recherche' className='absolute end-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground' onClick={() => setQuery('')}><X className='size-4' /></button>}
        </div>
        <div className='relative'>
          <button type='button' aria-label='Couleur de peau' aria-expanded={toneOpen} className='grid size-8 place-items-center rounded-md text-lg hover:bg-accent' onClick={() => setToneOpen(!toneOpen)}>{TONES[tone]}</button>
          {toneOpen && (
            <div className='absolute end-0 top-9 z-10 grid gap-0.5 rounded-md border bg-popover p-1 shadow-md'>
              {TONES.map((t, i) => (
                <button key={t} type='button' aria-label={i ? `Teinte ${i}` : 'Teinte par défaut'} className={cn('grid size-8 place-items-center rounded text-lg hover:bg-accent', i === tone && 'bg-accent')} onClick={() => { setTone(i); store(TONE_KEY, i); setToneOpen(false) }}>{t}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        {!query && (
          <nav aria-label='Catégories d’émojis' className='flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-e bg-muted/40 py-2'>
            {sections.map((s) => {
              const Icon = s.icon
              return (
                <button key={s.key} type='button' title={s.title} aria-label={s.title} onClick={() => jump(s.key)}
                  className={cn('grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', active === s.key && 'bg-accent text-foreground')}>
                  {s.guild ? <GuildIcon src={s.guild.icon} name={s.guild.name} className='size-6 rounded-lg' /> : Icon && <Icon className='size-4.5' />}
                </button>
              )
            })}
          </nav>
        )}

        <div ref={scroller} onScroll={onScroll} className='relative min-w-0 flex-1 overflow-y-auto px-2 pb-2'>
          {unicode.isLoading && <div className='grid h-full place-items-center text-muted-foreground'><Loader2 className='size-5 animate-spin' /></div>}
          {unicode.isError && <p className='p-4 text-sm text-muted-foreground'>Impossible de charger les émojis.</p>}
          {unicode.data && sections.map((s) => (
            <section key={s.key} data-section={s.key} aria-label={s.title}>
              <h3 className='sticky top-0 z-[1] flex items-center gap-1.5 bg-popover pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
                {s.guild && <GuildIcon src={s.guild.icon} name={s.guild.name} className='size-4 rounded' />}
                <span className='truncate'>{s.title}</span>
              </h3>
              <div className='grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))]'>
                {s.items.map((item) => (
                  <button
                    key={s.key + item.value}
                    type='button'
                    aria-label={item.label}
                    onClick={() => pick(item)}
                    onMouseEnter={() => setHover(item)}
                    onFocus={() => setHover(item)}
                    className='grid aspect-square place-items-center rounded-md text-2xl leading-none hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
                  >
                    {item.url ? <CustomEmoji url={item.url} name={item.label.slice(1, -1)} className='size-7 object-contain' /> : item.unicode}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {unicode.data && query && !sections[0].items.length && <p className='p-4 text-center text-sm text-muted-foreground'>Aucun émoji trouvé.</p>}
        </div>
      </div>

      <div className='flex h-11 shrink-0 items-center gap-2 border-t bg-muted/40 px-3 text-sm'>
        {preview ? (
          <>
            <span className='grid size-7 place-items-center text-2xl'>{preview.url ? <CustomEmoji key={preview.url} url={preview.url} name={preview.label.slice(1, -1)} className='size-7 object-contain' /> : preview.unicode}</span>
            <span className='truncate font-medium'>{preview.label}</span>
          </>
        ) : <span className='text-muted-foreground'>Choisis un émoji</span>}
      </div>
    </div>
  )
}

// Form field: a square button showing the chosen emoji, opening the picker, with a clear button
export function EmojiField({ value, onChange, disabled, label = 'Émoji', placeholder, allowCustom = true, clearable = true, id, className }: {
  value: string | null | undefined
  onChange: (emoji: string) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  allowCustom?: boolean
  clearable?: boolean
  id?: string
  className?: string
}) {
  return (
    <div className={cn('relative inline-flex w-fit', className)}>
      <EmojiPicker onSelect={onChange} allowCustom={allowCustom}>
        <button
          id={id}
          type='button'
          disabled={disabled}
          aria-label={value ? `${label} : ${value}` : label}
          title={label}
          className='grid size-9 place-items-center rounded-md border border-input bg-transparent text-xl shadow-xs transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30'
        >
          {value ? <EmojiView value={value} className='size-6 text-xl' /> : placeholder ? <span className='opacity-40 grayscale'>{placeholder}</span> : <Smile className='size-4 text-muted-foreground' />}
        </button>
      </EmojiPicker>
      {clearable && value && !disabled && (
        <button type='button' aria-label={`Retirer ${label.toLowerCase()}`} onClick={() => onChange('')}
          className='absolute -end-1.5 -top-1.5 grid size-4 place-items-center rounded-full border bg-background text-muted-foreground hover:text-foreground'>
          <X className='size-2.5' />
        </button>
      )}
    </div>
  )
}
