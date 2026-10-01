import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Search, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLayout } from '@/context/layout-provider'
import { useMe } from '@/hooks/use-me'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { BrandMark } from '@/components/app/brand-mark'
import { homeEntry, navSections, type NavEntry } from './nav'
import { NavUser } from './nav-user'

// Small per-browser preferences (favorites, folded groups): never required, so storage errors are ignored
function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    }
    catch {
      return fallback
    }
  })
  const update = useCallback((next: T) => {
    setValue(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    }
    catch {
      // private window: kept for this visit only
    }
  }, [key])
  return [value, update] as const
}

const isActive = (url: string, pathname: string) => (url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`) || pathname.startsWith(`${url}.`))

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { can } = useMe()
  const { setOpenMobile, state, isMobile } = useSidebar()
  const pathname = useLocation({ select: (l) => l.pathname })
  const [favorites, setFavorites] = useStored<string[]>('nav.favorites', [])
  // Groups opened by hand (the group of the current page is always open)
  const [opened, setOpened] = useStored<string[]>('nav.opened', [])
  const [searching, setSearching] = useState(false)
  const iconsOnly = state === 'collapsed' && !isMobile

  const sections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.permission === null || can(item.permission)) }))
    .filter((section) => section.items.length)
  const all = sections.flatMap((s) => s.items)
  const favoriteItems = favorites.map((url) => all.find((item) => item.url === url)).filter(Boolean) as NavEntry[]
  const toggleFavorite = (url: string) => setFavorites(favorites.includes(url) ? favorites.filter((u) => u !== url) : [...favorites, url])

  // Ctrl+K (or Cmd+K) opens the quick search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching((open) => !open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const entry = (item: NavEntry, { favorite = false } = {}) => (
    <SidebarMenuItem key={`${favorite ? 'fav-' : ''}${item.url}`}>
      <SidebarMenuButton asChild isActive={isActive(item.url, pathname)} tooltip={item.title}>
        <Link to={item.url} onClick={() => setOpenMobile(false)}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {item.url !== '/' && (
        <SidebarMenuAction
          showOnHover={!favorites.includes(item.url)}
          onClick={() => toggleFavorite(item.url)}
          aria-label={favorites.includes(item.url) ? `Retirer ${item.title} des favoris` : `Ajouter ${item.title} aux favoris`}
          aria-pressed={favorites.includes(item.url)}
        >
          <Star className={cn(favorites.includes(item.url) && 'fill-primary text-primary')} />
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  )

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size='lg' asChild className='hover:bg-transparent'>
              <Link to='/' onClick={() => setOpenMobile(false)}>
                <BrandMark className='!size-9 shrink-0' />
                <div className='grid leading-tight'>
                  <span className='truncate font-display text-base font-bold tracking-[0.08em] uppercase'>Brothers Life</span>
                  <span className='truncate text-[0.65rem] font-display tracking-[0.22em] text-primary uppercase dark:text-brand'>Panel du réseau</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setSearching(true)} tooltip='Rechercher (Ctrl K)' className='border bg-sidebar-accent/40 text-muted-foreground'>
              <Search />
              <span className='flex-1 truncate'>Rechercher…</span>
              <kbd className='rounded border bg-background px-1.5 font-mono text-[10px] group-data-[collapsible=icon]:hidden'>Ctrl K</kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {entry(homeEntry)}
          </SidebarMenu>
        </SidebarGroup>

        {favoriteItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className='font-display text-[0.62rem] font-semibold tracking-[0.24em] text-primary uppercase dark:text-brand/75'>Favoris</SidebarGroupLabel>
            <SidebarMenu>{favoriteItems.map((item) => entry(item, { favorite: true }))}</SidebarMenu>
          </SidebarGroup>
        )}

        {sections.map((section) => {
          const current = section.items.some((item) => isActive(item.url, pathname))
          // The group of the current page is always open; icons-only mode shows everything
          const open = iconsOnly || current || opened.includes(section.title)
          return (
            <Collapsible
              key={section.title}
              open={open}
              onOpenChange={(next) => setOpened(next ? [...opened, section.title] : opened.filter((t) => t !== section.title))}
              className='group/collapsible'
            >
              <SidebarGroup className='py-0'>
                <SidebarGroupLabel asChild className='font-display text-[0.62rem] font-semibold tracking-[0.24em] text-primary uppercase hover:bg-sidebar-accent/60 dark:text-brand/75'>
                  <CollapsibleTrigger disabled={current} aria-label={`${open ? 'Replier' : 'Déplier'} ${section.title}`}>
                    <section.icon className='me-2 !size-3.5' />
                    {section.title}
                    {!open && <span className='ms-1.5 rounded-full bg-sidebar-accent px-1.5 text-[0.6rem] tracking-normal text-muted-foreground tabular-nums'>{section.items.length}</span>}
                    <ChevronRight className={cn('ms-auto transition-transform', open && 'rotate-90', current && 'opacity-40')} />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>{section.items.map((item) => entry(item))}</SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          )
        })}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
      <QuickSearch open={searching} onOpenChange={setSearching} sections={sections} favorites={favoriteItems} />
    </Sidebar>
  )
}

function QuickSearch({ open, onOpenChange, sections, favorites }: { open: boolean; onOpenChange: (open: boolean) => void; sections: { title: string; items: NavEntry[] }[]; favorites: NavEntry[] }) {
  const navigate = useNavigate()
  const { setOpenMobile } = useSidebar()
  const go = (url: string) => {
    onOpenChange(false)
    setOpenMobile(false)
    navigate({ to: url })
  }
  const item = (entry: NavEntry, prefix = '') => (
    <CommandItem key={`${prefix}${entry.url}`} value={`${prefix}${entry.title} ${entry.keywords ?? ''}`} onSelect={() => go(entry.url)}>
      <entry.icon />
      <span>{entry.title}</span>
    </CommandItem>
  )
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title='Aller à une page' description='Tape le nom d’une page ou ce que tu cherches à faire'>
      <CommandInput placeholder='Aller à… (sanctions, musique, captcha, embed…)' />
      <CommandList>
        <CommandEmpty>Aucune page ne correspond.</CommandEmpty>
        {favorites.length > 0 && <CommandGroup heading='Favoris'>{favorites.map((entry) => item(entry, 'favori '))}</CommandGroup>}
        <CommandGroup heading='Général'>{item(homeEntry)}</CommandGroup>
        {sections.map((section) => <CommandGroup key={section.title} heading={section.title}>{section.items.map((entry) => item(entry))}</CommandGroup>)}
      </CommandList>
    </CommandDialog>
  )
}
